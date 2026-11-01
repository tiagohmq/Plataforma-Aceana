import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db/client.ts';
import { createConnectors, type Connectors } from '../src/connectors/index.ts';
import type { PipedriveMock } from '../src/connectors/pipedrive/mock.ts';
import { runDueJobs } from '../src/jobs/worker.ts';
import { testApp } from './app-helper.ts';
import { api, as, versionBody } from './fixtures.ts';

let app: FastifyInstance;
let db: Db;
let connectors: Connectors;
let clock = new Date('2026-11-03T12:00:00Z');
let a: ReturnType<typeof api>;

beforeEach(async () => {
  clock = new Date('2026-11-03T12:00:00Z');
  connectors = createConnectors({});
  ({ app, db } = await testApp({ connectors, now: () => clock }));
  a = api(app);
});

export const FORM = {
  razaoSocial: 'Mercearia Sol Nascente Ltda', cnpjCpf: '11.222.333/0001-81', endereco: 'Rua do Exemplo, 100, Recife/PE', cep: '50030-230',
  representanteNome: 'Rita Alencar', nacionalidade: 'brasileira', profissao: 'empresária',
  emailSignatario: 'rita@solnascente.exemplo.com', emailFinanceiro: 'financeiro@solnascente.exemplo.com',
  representanteCpf: '529.982.247-25', representanteRg: '1234567', orgaoEmissor: 'SDS/PE', estadoCivil: 'casada', enderecoRepresentante: 'Rua Pessoal, 1, Recife/PE',
};
const later = (min: number) => new Date(clock.getTime() + min * 60000);

/** Proposta enviada, vendida (v3 aprovada) e com link do formulário. */
async function soldWithForm(): Promise<{ id: string; token: string }> {
  const p = (await a.importDeal()).json();
  await a.newVersion(p.id, 1);
  await a.approve(p.id, 2, 'larissa');
  await a.send(p.id);
  await a.newVersion(p.id, 2, versionBody({ soldCents: 1500000 }));
  await a.approve(p.id, 3, 'larissa');
  const f = await app.inject({ method: 'POST', url: `/api/proposals/${p.id}/contract-form`, headers: as('larissa') });
  expect(f.statusCode).toBe(201);
  const token = f.json().url.split('/').pop();
  return { id: p.id, token };
}

const fillForm = (token: string, body: object = FORM) => app.inject({ method: 'POST', url: `/api/forms/${token}`, payload: body });
const generate = (id: string) => app.inject({ method: 'POST', url: `/api/proposals/${id}/contract`, headers: as('larissa'), payload: { exclusoes: ['Implantação de software'], reunioes: 6 } });

describe('formulário do cliente', () => {
  it('formulário sem venda aprovada → 409', async () => {
    const p = (await a.importDeal()).json();
    const r = await app.inject({ method: 'POST', url: `/api/proposals/${p.id}/contract-form`, headers: as('larissa') });
    expect(r.statusCode).toBe(409);
  });

  it('GET do formulário não mostra preço', async () => {
    const { token } = await soldWithForm();
    const r = await app.inject({ method: 'GET', url: `/api/forms/${token}` });
    expect(r.statusCode).toBe(200);
    expect(JSON.stringify(r.json())).not.toMatch(/Cents|valor|price/i);
  });

  it('uso único: segundo envio → 410', async () => {
    const { token } = await soldWithForm();
    expect((await fillForm(token)).statusCode).toBe(200);
    expect((await fillForm(token)).statusCode).toBe(410);
  });

  it('expirado → 410', async () => {
    const { token } = await soldWithForm();
    clock = new Date(clock.getTime() + 73 * 3600000);
    expect((await fillForm(token)).statusCode).toBe(410);
  });

  it('CPF inválido → 400 e o link continua valendo', async () => {
    const { token } = await soldWithForm();
    expect((await fillForm(token, { ...FORM, representanteCpf: '111.111.111-11' })).statusCode).toBe(400);
    expect((await fillForm(token)).statusCode).toBe(200);
  });

  it('banco guarda dados pessoais cifrados', async () => {
    const { token } = await soldWithForm();
    await fillForm(token);
    const dump = JSON.stringify((await db.query('select * from contract_personal')).rows) + JSON.stringify((await db.query('select * from contract_data')).rows);
    expect(dump).not.toContain('529.982.247-25');
    expect(dump).not.toContain('52998224725');
    expect(dump).not.toContain('1234567');
  });
});

describe('contrato', () => {
  async function filled() {
    const s = await soldWithForm();
    await fillForm(s.token);
    await runDueJobs(db, connectors, later(1)); // sincroniza valor vendido no deal
    return s.id;
  }

  it('gera contrato sem campo vazio e conferido com o deal', async () => {
    const id = await filled();
    const r = await generate(id);
    expect(r.statusCode).toBe(201);
    const c = r.json();
    expect(c.content.quadroResumo.clausula22).toBe(id);
    expect(c.content.quadroResumo.valorTotal).toBe('R$ 15.000,00');
    expect(c.content.anexoII.reunioes).toBe('6');
    expect(JSON.stringify(c)).not.toContain('529.982.247-25');
  });

  it('valor do deal diferente → 409 DIVERGENCIA', async () => {
    const id = await filled();
    (connectors.pipedrive as PipedriveMock).deals.get('2018')!.value = 1400000;
    const r = await generate(id);
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('DIVERGENCIA');
  });

  it('sem formulário preenchido → 409 CAMPO_VAZIO', async () => {
    const s = await soldWithForm();
    await runDueJobs(db, connectors, later(1));
    const r = await generate(s.id);
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toMatch(/^CAMPO_VAZIO/);
  });

  it('envelope só depois de aprovar o contrato', async () => {
    const id = await filled();
    const c = (await generate(id)).json();
    const env = () => app.inject({ method: 'POST', url: `/api/contracts/${c.id}/envelope`, headers: as('larissa'), payload: { envelopeId: 'env-9' } });
    expect((await env()).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/api/contracts/${c.id}/approvals`, headers: as('clara'), payload: { decision: 'APROVADA' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/contracts/${c.id}/approvals`, headers: as('larissa'), payload: { decision: 'APROVADA' } })).statusCode).toBe(201);
    expect((await env()).statusCode).toBe(200);
    const link = await db.query("select external_id from external_links where deal_id = '2018' and system = 'clicksign'");
    expect(link.rows).toEqual([{ external_id: 'env-9' }]);
  });

  it('dados pessoais: GP não lê; GN lê e fica auditado sem o valor', async () => {
    const id = await filled();
    const c = (await generate(id)).json();
    expect((await app.inject({ method: 'GET', url: `/api/contracts/${c.id}/personal`, headers: as('clara') })).statusCode).toBe(403);
    const r = await app.inject({ method: 'GET', url: `/api/contracts/${c.id}/personal`, headers: as('larissa') });
    expect(r.statusCode).toBe(200);
    expect(r.json().representanteCpf).toBe('529.982.247-25');
    const au = await db.query<{ after: unknown }>("select after from audit_events where action = 'personal.read'");
    expect(au.rows).toHaveLength(1);
    expect(JSON.stringify(au.rows)).not.toContain('529');
  });
});
