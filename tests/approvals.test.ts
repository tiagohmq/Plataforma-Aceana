import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db/client.ts';
import { testApp } from './app-helper.ts';
import { api, as, versionBody } from './fixtures.ts';

let app: FastifyInstance;
let db: Db;
let a: ReturnType<typeof api>;
beforeEach(async () => { ({ app, db } = await testApp()); a = api(app); });

const jobs = async () => (await db.query<{ n: number }>("select count(*)::int as n from jobs where type = 'pipedrive.updateDeal'")).rows[0].n;

/** Proposta na versão 2 (dentro da regra, ou abaixo do piso com exception=true). */
async function ready(exception = false): Promise<string> {
  const p = (await a.importDeal()).json();
  const body = exception ? versionBody({ presentedCents: 500000 }) : versionBody();
  const r = await a.newVersion(p.id, 1, body);
  expect(r.statusCode).toBe(201);
  return p.id;
}

describe('aprovações e envio', () => {
  it('enviar sem aprovação → 409', async () => {
    const id = await ready();
    const r = await a.send(id);
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('APROVACAO_PENDENTE');
  });

  it('GN aprova dentro da regra e envia; job criado', async () => {
    const id = await ready();
    expect((await a.approve(id, 2, 'larissa')).statusCode).toBe(201);
    const s = await a.send(id);
    expect(s.statusCode).toBe(200);
    expect(s.json().status).toBe('ENVIADA');
    expect(s.json().validUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await jobs()).toBe(1);
  });

  it('aprovar versão que não é a atual → 409', async () => {
    const id = await ready();
    expect((await a.approve(id, 1, 'larissa')).json().codigo).toBe('VERSAO_DESATUALIZADA');
  });

  it('nova versão depois de aprovar zera a aprovação', async () => {
    const id = await ready();
    await a.approve(id, 2, 'larissa');
    await a.newVersion(id, 2, versionBody({ scope: { solutionCode: 'SOL-017', stages: [{ name: 'Start', days: 11, consultants: 2 }, { name: 'Imersão', days: 50, consultants: 2 }] } }));
    expect((await a.send(id)).statusCode).toBe(409);
  });

  it('recusa não libera envio', async () => {
    const id = await ready();
    await a.approve(id, 2, 'larissa', 'RECUSADA');
    expect((await a.send(id)).statusCode).toBe(409);
  });

  it('GN não aprova exceção', async () => {
    const id = await ready(true);
    expect((await a.approve(id, 2, 'larissa')).statusCode).toBe(403);
  });

  it('quem pediu a exceção não aprova; outro DP aprova', async () => {
    const id = await ready(true);
    expect((await a.requestException(id, 2, 'dp')).statusCode).toBe(201);
    expect((await a.approve(id, 2, 'dp')).statusCode).toBe(403);
    expect((await a.approve(id, 2, 'dp2')).statusCode).toBe(201);
    expect((await a.send(id)).statusCode).toBe(200);
  });

  it('aprovação de preço comum não vale para exceção', async () => {
    const id = await ready(true);
    // DP tem price.approve, mas a versão exige exceção: a aprovação registrada é de exceção
    expect((await a.approve(id, 2, 'dp')).statusCode).toBe(201);
    expect((await a.send(id)).statusCode).toBe(200);
  });

  it('enviar duas vezes cria um job só', async () => {
    const id = await ready();
    await a.approve(id, 2, 'larissa');
    await a.send(id);
    expect((await a.send(id)).statusCode).toBe(200);
    expect(await jobs()).toBe(1);
  });

  it('visão pública do cliente só depois do envio e sem margem', async () => {
    const id = await ready();
    expect((await app.inject({ method: 'GET', url: `/api/public/proposals/${id}` })).statusCode).toBe(404);
    await a.approve(id, 2, 'larissa');
    const sent = (await a.send(id)).json();
    const r = await app.inject({ method: 'GET', url: sent.publicUrl });
    expect(r.statusCode).toBe(200);
    expect(r.json().valueCents).toBe(1500000);
    expect(JSON.stringify(r.json())).not.toMatch(/contribution|margin|floor|[Cc]ost(?!s?Cents)|light|alert|param|hourCost/);
  });

  it('auditoria registra aprovação e envio', async () => {
    const id = await ready();
    await a.approve(id, 2, 'larissa');
    await a.send(id);
    const r = await db.query<{ action: string }>('select action from audit_events where entity_id = $1 order by created_at', [id]);
    expect(r.rows.map(x => x.action)).toEqual(expect.arrayContaining(['approval.decide', 'proposal.send']));
  });

  it('GP não envia', async () => {
    const id = await ready();
    await a.approve(id, 2, 'larissa');
    expect((await app.inject({ method: 'POST', url: `/api/proposals/${id}/send`, headers: as('clara') })).statusCode).toBe(403);
  });
});
