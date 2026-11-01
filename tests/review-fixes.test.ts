import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db/client.ts';
import { createConnectors, type Connectors } from '../src/connectors/index.ts';
import type { PipedriveMock } from '../src/connectors/pipedrive/mock.ts';
import type { MondayMock } from '../src/connectors/monday/mock.ts';
import { enqueueJob } from '../src/jobs/queue.ts';
import { runDueJobs, recoverRunningJobs } from '../src/jobs/worker.ts';
import { rehydratePipedriveMock } from '../src/connectors/pipedrive/rehydrate.ts';
import { testApp, TEST_SECRETS } from './app-helper.ts';
import { api, as, versionBody, FORM } from './fixtures.ts';

let app: FastifyInstance;
let db: Db;
let connectors: Connectors;
let a: ReturnType<typeof api>;
const later = (min: number) => new Date(Date.now() + min * 60000);

beforeEach(async () => {
  connectors = createConnectors({});
  ({ app, db } = await testApp({ connectors }));
  a = api(app);
});

/** Proposta vendida (v3 aprovada) com formulário preenchido e valor sincronizado no deal. */
async function sold(form: object = FORM): Promise<string> {
  const p = (await a.importDeal()).json();
  await a.newVersion(p.id, 1);
  await a.approve(p.id, 2, 'larissa');
  await a.send(p.id);
  await a.newVersion(p.id, 2, versionBody({ soldCents: 1500000 }));
  await a.approve(p.id, 3, 'larissa');
  const f = (await app.inject({ method: 'POST', url: `/api/proposals/${p.id}/contract-form`, headers: as('larissa') })).json();
  const r = await app.inject({ method: 'POST', url: `/api/forms/${f.url.split('/').pop()}`, payload: form });
  expect(r.statusCode, r.body).toBe(200);
  await runDueJobs(db, connectors, later(1));
  return p.id;
}
const generate = (id: string) => app.inject({ method: 'POST', url: `/api/proposals/${id}/contract`, headers: as('larissa'), payload: { exclusoes: ['x'], reunioes: 4 } });
const approveC = (cid: string, decision = 'APROVADA', user = 'larissa') => app.inject({ method: 'POST', url: `/api/contracts/${cid}/approvals`, headers: as(user), payload: { decision } });
const envelope = (cid: string) => app.inject({ method: 'POST', url: `/api/contracts/${cid}/envelope`, headers: as('larissa'), payload: { envelopeId: 'env-r' } });
const webhook = (name: string, email: string) => {
  const body = JSON.stringify({ event: { name }, envelope: { id: 'env-r' }, signer: { email } });
  return app.inject({ method: 'POST', url: '/api/webhooks/clicksign', payload: body, headers: { 'content-type': 'application/json', 'content-hmac': 'sha256=' + createHmac('sha256', TEST_SECRETS.clicksignHmac).update(body).digest('hex') } });
};
const contractStatus = async () => (await db.query<{ status: string }>('select status from contract_status')).rows[0].status;

describe('correções da revisão final', () => {
  it('I1: job em running volta para pending ao reiniciar e pode ser reprocessado', async () => {
    const { id } = await enqueueJob(db, { type: 'pipedrive.markWon', idempotencyKey: 'won:2018', payload: { dealId: '2018', wonAt: '2026-11-05' } });
    await db.query("update jobs set status = 'running' where id = $1", [id]);
    expect((await app.inject({ method: 'POST', url: `/api/jobs/${id}/retry`, headers: as('admin') })).statusCode).toBe(200);
    await db.query("update jobs set status = 'running' where id = $1", [id]);
    await recoverRunningJobs(db);
    expect(await runDueJobs(db, connectors, later(1))).toBe(1);
    expect((await connectors.pipedrive.getDeal('2018')).status).toBe('won');
  });

  it('I2: mock do Pipedrive reaplica as gravações já feitas depois de reiniciar', async () => {
    const id = await sold();
    const fresh = createConnectors({});
    await rehydratePipedriveMock(db, fresh.pipedrive as PipedriveMock);
    expect((await fresh.pipedrive.getDeal('2018')).value).toBe(1500000);
    expect((await fresh.pipedrive.getDeal('2018')).stage).toBe('Proposta apresentada');
    expect(id).toBeTruthy();
  });

  it('I4: contrato de versão antiga não é aprovado nem recebe envelope', async () => {
    const id = await sold();
    const c = (await generate(id)).json();
    await a.newVersion(id, 3, versionBody({ soldCents: 1400000 }));
    const r = await approveC(c.id);
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('CONTRATO_DESATUALIZADO');
  });

  it('I4: envelope exige contrato da versão atual', async () => {
    const id = await sold();
    const c = (await generate(id)).json();
    expect((await approveC(c.id)).statusCode).toBe(201);
    await a.newVersion(id, 3, versionBody({ soldCents: 1400000 }));
    expect((await envelope(c.id)).json().codigo).toBe('CONTRATO_DESATUALIZADO');
  });

  it('I5: contrato só é decidido enquanto aguarda aprovação', async () => {
    const id = await sold();
    const c = (await generate(id)).json();
    await approveC(c.id);
    await envelope(c.id);
    const r = await approveC(c.id, 'RECUSADA');
    expect(r.statusCode).toBe(409);
    expect(await contractStatus()).toBe('ENVIADO_CLICKSIGN');
  });

  it('I6: assinatura da testemunha depois do cliente não faz a situação regredir', async () => {
    const id = await sold();
    const c = (await generate(id)).json();
    await approveC(c.id);
    await envelope(c.id);
    await webhook('sign', FORM.emailSignatario);
    await runDueJobs(db, connectors, later(2));
    await webhook('sign', 'mkt@exemplo.ace');
    await runDueJobs(db, connectors, later(3));
    expect(await contractStatus()).toBe('ASSINADO_CLIENTE');
  });

  it('I6: contrato cancelado não vira ganho', async () => {
    const id = await sold();
    const c = (await generate(id)).json();
    await approveC(c.id);
    await envelope(c.id);
    await webhook('cancel', 'x@y.com');
    await runDueJobs(db, connectors, later(2));
    await webhook('sign', FORM.emailSignatario);
    for (let i = 3; i < 6; i++) await runDueJobs(db, connectors, later(i));
    expect(await contractStatus()).toBe('CANCELADO');
    expect((await connectors.pipedrive.getDeal('2018')).status).toBe('open');
    expect((connectors.monday as MondayMock).items.size).toBe(0);
  });

  it('I7: dados do contratante só para quem vê dados pessoais; CPF de pessoa física cifrado', async () => {
    await sold({ ...FORM, cnpjCpf: '529.982.247-25' });
    const dump = JSON.stringify((await db.query('select data from contract_data')).rows);
    expect(dump).not.toMatch(/529\.?982\.?247-?25/);
    const gp = (await app.inject({ method: 'GET', url: '/api/ui/bootstrap', headers: as('clara') })).json();
    expect(gp.proposals[0].flow.formData).toBeNull();
    const gn = (await app.inject({ method: 'GET', url: '/api/ui/bootstrap', headers: as('larissa') })).json();
    expect(gn.proposals[0].flow.formData.razaoSocial).toBe(FORM.razaoSocial);
  });

  it('I7: contrato de pessoa física sai com o CPF completo', async () => {
    const id = await sold({ ...FORM, cnpjCpf: '529.982.247-25' });
    const c = (await generate(id)).json();
    expect(c.content.quadroResumo.cnpjCpf).toBe('529.982.247-25');
  });

  it('I8: link público usa token aleatório, não o id da proposta', async () => {
    const p = (await a.importDeal()).json();
    await a.newVersion(p.id, 1);
    await a.approve(p.id, 2, 'larissa');
    const s = (await a.send(p.id)).json();
    expect((await app.inject({ method: 'GET', url: `/api/public/proposals/${p.id}` })).statusCode).toBe(404);
    expect(s.publicUrl).toMatch(/^\/api\/public\/proposals\/[A-Za-z0-9_-]{30,}$/);
    expect((await app.inject({ method: 'GET', url: s.publicUrl })).statusCode).toBe(200);
  });

  it('I8: dois deals da mesma organização no mesmo mês têm ids diferentes', async () => {
    const mock = connectors.pipedrive as PipedriveMock;
    mock.deals.set('3000', { ...mock.deals.get('2018')!, id: '3000', services: ['Plano de Marketing'] });
    const x = await a.importDeal('2018');
    const y = await a.importDeal('3000');
    expect(y.statusCode).toBe(201);
    expect(y.json().id).not.toBe(x.json().id);
  });

  it('I9: multiplicador desconhecido → 400', async () => {
    const p = (await a.importDeal()).json();
    const body = versionBody();
    const r = await a.newVersion(p.id, 1, { ...body, pricing: { ...body.pricing, size: 'XYZ' } });
    expect(r.statusCode).toBe(400);
  });
});
