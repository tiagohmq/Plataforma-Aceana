import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db/client.ts';
import { createConnectors, type Connectors } from '../src/connectors/index.ts';
import type { MondayMock } from '../src/connectors/monday/mock.ts';
import { runDueJobs } from '../src/jobs/worker.ts';
import { verifyClicksignHmac } from '../src/domain/hmac.ts';
import { testApp, TEST_SECRETS } from './app-helper.ts';
import { api, as } from './fixtures.ts';

let app: FastifyInstance;
let db: Db;
let connectors: Connectors;
const later = (min: number) => new Date(Date.now() + min * 60000);

beforeEach(async () => {
  connectors = createConnectors({});
  ({ app, db } = await testApp({ connectors }));
});

/** Proposta com contrato e envelope (a Task 9 cria pelo fluxo; aqui inserimos direto). */
async function withEnvelope(): Promise<string> {
  const p = (await api(app).importDeal()).json();
  const v = await db.query<{ id: string }>('select id from proposal_versions where proposal_id = $1', [p.id]);
  await db.query("insert into contracts (id, proposal_id, proposal_version_id, content, content_hash) values ('c1', $1, $2, $3, 'h')",
    [p.id, v.rows[0].id, JSON.stringify({ signers: { client: { email: 'rita@solnascente.exemplo.com' }, ace: { email: 'dir@exemplo.ace' }, witness: { email: 'mkt@exemplo.ace' } } })]);
  await db.query("insert into contract_status (contract_id, status, envelope_id) values ('c1', 'APROVADO', 'env-123')");
  return p.id;
}

const signBody = (email: string) => JSON.stringify({ event: { name: 'sign', occurred_at: '2026-11-05T14:00:00Z' }, envelope: { id: 'env-123' }, signer: { email } });
const post = (body: string, secret = TEST_SECRETS.clicksignHmac) =>
  app.inject({
    method: 'POST', url: '/api/webhooks/clicksign', payload: body,
    headers: { 'content-type': 'application/json', 'content-hmac': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` },
  });

describe('webhook Clicksign', () => {
  it('verifyClicksignHmac confere sobre o corpo bruto', () => {
    const body = Buffer.from('{"a":1}');
    const sig = 'sha256=' + createHmac('sha256', 's').update(body).digest('hex');
    expect(verifyClicksignHmac(body, sig, 's')).toBe(true);
    expect(verifyClicksignHmac(body, sig, 'outro')).toBe(false);
    expect(verifyClicksignHmac(body, undefined, 's')).toBe(false);
  });

  it('HMAC errado → 401', async () => {
    await withEnvelope();
    expect((await post(signBody('rita@solnascente.exemplo.com'), 'segredo-errado')).statusCode).toBe(401);
  });

  it('assinatura do cliente duas vezes → um ganho e um projeto', async () => {
    const id = await withEnvelope();
    expect((await post(signBody('rita@solnascente.exemplo.com'))).statusCode).toBe(200);
    expect((await post(signBody('rita@solnascente.exemplo.com'))).statusCode).toBe(200);
    for (let i = 1; i <= 3; i++) await runDueJobs(db, connectors, later(i));
    expect((await connectors.pipedrive.getDeal('2018')).status).toBe('won');
    expect((connectors.monday as MondayMock).items.size).toBe(1);
    const h = await app.inject({ method: 'GET', url: `/api/proposals/${id}/handoff`, headers: as('clara') });
    expect(h.statusCode).toBe(200);
    expect(h.json().mondayItemId).toBeTruthy();
    expect(JSON.stringify(h.json())).not.toMatch(/contribution|floorCents/);
  });

  it('assinatura da testemunha não marca ganho', async () => {
    await withEnvelope();
    await post(signBody('mkt@exemplo.ace'));
    for (let i = 1; i <= 3; i++) await runDueJobs(db, connectors, later(i));
    expect((await connectors.pipedrive.getDeal('2018')).status).toBe('open');
    expect((connectors.monday as MondayMock).items.size).toBe(0);
  });

  it('nenhum CPF em jobs nem em execuções', async () => {
    await withEnvelope();
    await post(JSON.stringify({ event: { name: 'sign' }, envelope: { id: 'env-123' }, signer: { email: 'rita@solnascente.exemplo.com', documentation: '529.982.247-25' } }));
    for (let i = 1; i <= 3; i++) await runDueJobs(db, connectors, later(i));
    // Só campos com conteúdo: IDs aleatórios (UUID) às vezes têm 11 dígitos seguidos e dariam falso positivo.
    const dump = JSON.stringify((await db.query('select payload, last_error from jobs')).rows) + JSON.stringify((await db.query('select event, error from connector_runs')).rows);
    expect(dump).toContain('rita@solnascente');
    expect(dump).not.toMatch(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/);
  });
});
