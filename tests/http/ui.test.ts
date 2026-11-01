import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../src/db/client.ts';
import { createConnectors, type Connectors } from '../../src/connectors/index.ts';
import type { MondayMock } from '../../src/connectors/monday/mock.ts';
import { runDueJobs } from '../../src/jobs/worker.ts';
import { freshDb } from '../helpers.ts';
import { seedAll } from '../../src/db/seed.ts';
import { buildApp } from '../../src/http/app.ts';
import { TEST_SECRETS } from '../app-helper.ts';
import { api, as, versionBody, FORM } from '../fixtures.ts';

let app: FastifyInstance;
let db: Db;
let connectors: Connectors;
beforeEach(async () => {
  db = await freshDb();
  await seedAll(db);
  connectors = createConnectors({});
  app = await buildApp({ db, connectors, secrets: TEST_SECRETS, demo: true });
});
const later = (min: number) => new Date(Date.now() + min * 60000);

describe('front', () => {
  it('GET / serve o v14 ligado na API', async () => {
    const r = await app.inject({ method: 'GET', url: '/' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.body).toContain('<title>');
    expect(r.body).toContain('<script src="/app.js"></script>');
  });

  it('bootstrap traz usuários, parâmetros e propostas com estado de fluxo', async () => {
    const a = api(app);
    const p = (await a.importDeal()).json();
    await a.newVersion(p.id, 1);
    await a.approve(p.id, 2, 'larissa');
    const b = (await app.inject({ method: 'GET', url: '/api/ui/bootstrap', headers: as('larissa') })).json();
    expect(b.me.role).toBe('GN');
    expect(b.users.length).toBeGreaterThan(3);
    expect(b.params.values.hourCost).toBe(23.45);
    const ui = b.proposals[0];
    expect(ui.id).toBe(p.id);
    expect(ui.flow.approval.status).toBe('ok');
    expect(ui.flow.sent).toBe(false);
    expect(ui.currentVersion.result.margins.light).toBe('verde');
  });

  it('bootstrap do GP sem parâmetros nem margem', async () => {
    await api(app).importDeal();
    const b = (await app.inject({ method: 'GET', url: '/api/ui/bootstrap', headers: as('clara') })).json();
    expect(b.params).toBeNull();
    expect(JSON.stringify(b.proposals)).not.toMatch(/contribution|floorCents/);
  });

  it('margens trazem cada parcela do cálculo (o front não recalcula)', async () => {
    const a = api(app);
    const p = (await a.importDeal()).json();
    const v = (await a.newVersion(p.id, 1)).json().currentVersion.result.margins;
    expect(v.taxCents + v.salesTimeCents + v.backofficeCents + v.hoursCostCents).toBeGreaterThan(0);
    expect(v.cashCents).toBe(1500000 - v.taxCents);
  });
});

describe('rotas de demonstração', () => {
  async function toEnvelope(): Promise<string> {
    const a = api(app);
    const p = (await a.importDeal()).json();
    await a.newVersion(p.id, 1);
    await a.approve(p.id, 2, 'larissa');
    await a.send(p.id);
    await a.newVersion(p.id, 2, versionBody({ soldCents: 1500000 }));
    await a.approve(p.id, 3, 'larissa');
    const f = (await app.inject({ method: 'POST', url: `/api/proposals/${p.id}/contract-form`, headers: as('larissa') })).json();
    await app.inject({ method: 'POST', url: `/api/forms/${f.url.split('/').pop()}`, payload: FORM });
    await runDueJobs(db, connectors, later(1));
    const c = (await app.inject({ method: 'POST', url: `/api/proposals/${p.id}/contract`, headers: as('larissa'), payload: { exclusoes: ['x'], reunioes: 4 } })).json();
    await app.inject({ method: 'POST', url: `/api/contracts/${c.id}/approvals`, headers: as('larissa'), payload: { decision: 'APROVADA' } });
    await app.inject({ method: 'POST', url: `/api/contracts/${c.id}/envelope`, headers: as('larissa'), payload: { envelopeId: 'env-ui' } });
    return p.id;
  }

  it('simular assinatura do cliente gera ganho e projeto', async () => {
    const id = await toEnvelope();
    const r = await app.inject({ method: 'POST', url: '/api/demo/simulate-sign', headers: as('larissa'), payload: { proposalId: id, signer: 'client' } });
    expect(r.statusCode).toBe(200);
    for (let i = 1; i <= 3; i++) await runDueJobs(db, connectors, later(i + 1));
    expect((connectors.monday as MondayMock).items.size).toBe(1);
    const b = (await app.inject({ method: 'GET', url: '/api/ui/bootstrap', headers: as('larissa') })).json();
    expect(b.proposals[0].flow.projectCreated).toBe(true);
    expect(b.proposals[0].flow.signatures).toBe(1);
  });

  it('forçar falha do Monday e reprocessar', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/demo/fail-next', headers: as('admin'), payload: { connector: 'monday' } });
    expect(r.statusCode).toBe(200);
    expect((connectors.monday as MondayMock).failNext).toBe(1);
  });

  it('sem modo demo as rotas não existem', async () => {
    const app2 = await buildApp({ db, connectors, secrets: TEST_SECRETS });
    expect((await app2.inject({ method: 'POST', url: '/api/demo/fail-next', headers: as('admin'), payload: { connector: 'monday' } })).statusCode).toBe(404);
  });
});
