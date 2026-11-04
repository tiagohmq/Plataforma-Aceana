import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db/client.ts';
import { PipedriveReal } from '../src/connectors/pipedrive/real.ts';
import type { PipedriveMock } from '../src/connectors/pipedrive/mock.ts';
import { createConnectors, type Connectors } from '../src/connectors/index.ts';
import { runDueJobs } from '../src/jobs/worker.ts';
import { testApp } from './app-helper.ts';
import { api, versionBody } from './fixtures.ts';

const FIELDS = [
  { key: 'v'.repeat(40), name: 'Valor aprovado', field_type: 'monetary' },
  { key: 'p'.repeat(40), name: 'Parcelas aprovadas', field_type: 'varchar' },
  { key: 'x'.repeat(40), name: 'Pré-auditoria', field_type: 'text' },
];

function fake(fields = FIELDS) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const fn = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    const u = new URL(url);
    const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ success: true, data }) });
    if (u.pathname.endsWith('/dealFields')) return ok(fields);
    if (u.pathname.endsWith('/stages')) return ok([]);
    if (u.pathname.endsWith('/pipelines')) return ok([]);
    if (/\/deals\/\d+$/.test(u.pathname) && (init.method ?? 'GET') === 'GET') return ok({ id: 9736, title: 'Negócio', stage_id: 1, pipeline_id: 1, org_name: 'Baterias Exemplo' });
    return ok({ id: 1 });
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

describe('gravação restrita no Pipedrive real', () => {
  const approved = { valueCents: 1500000, installments: 3, installmentsCents: [500000, 500000, 500000], validUntil: '2026-11-20' };

  it('grava só valor aprovado, parcelas e validade', async () => {
    const f = fake();
    const pd = new PipedriveReal({ token: 'TOKEN', writeApproved: true, fetch: f.fn });
    await pd.writeApproved('9736', { ...approved, expectedOrg: 'Baterias Exemplo' });
    const put = f.calls.filter(c => c.method === 'PUT');
    expect(put).toHaveLength(1);
    expect(put[0].url).toBe('https://api.pipedrive.com/v1/deals/9736');
    expect(put[0].url).not.toContain('TOKEN');
    expect(put[0].headers['x-api-token']).toBe('TOKEN');
    expect(JSON.parse(put[0].body!)).toEqual({ ['v'.repeat(40)]: 15000, ['p'.repeat(40)]: '3x de R$ 5.000,00', expected_close_date: '2026-11-20' });
  });

  it('recusa gravar se o negócio no Pipedrive é de outra organização', async () => {
    const f = fake();
    const pd = new PipedriveReal({ token: 't', writeApproved: true, fetch: f.fn });
    await expect(pd.writeApproved('9736', { ...approved, expectedOrg: 'Mercearia Sol Nascente' })).rejects.toThrow(/outra organização/);
    expect(f.calls.filter(c => c.method === 'PUT')).toEqual([]);
  });

  it('sem validade, não mexe na data de fechamento', async () => {
    const f = fake();
    await new PipedriveReal({ token: 't', writeApproved: true, fetch: f.fn }).writeApproved('1', { ...approved, validUntil: undefined });
    expect(JSON.parse(f.calls.find(c => c.method === 'PUT')!.body!)).not.toHaveProperty('expected_close_date');
  });

  it('campo inexistente → erro claro pedindo a um admin para criar', async () => {
    const f = fake([FIELDS[2]]);
    await expect(new PipedriveReal({ token: 't', writeApproved: true, fetch: f.fn }).writeApproved('1', approved)).rejects.toThrow(/"Valor aprovado".*admin/);
    expect(f.calls.filter(c => c.method === 'PUT')).toEqual([]);
  });

  it('com a gravação desligada, nada é enviado', async () => {
    const f = fake();
    const pd = new PipedriveReal({ token: 't', fetch: f.fn });
    await pd.writeApproved('1', approved);
    expect(f.calls.filter(c => c.method !== 'GET')).toEqual([]);
    expect(pd.skippedWrites.map(w => w.op)).toEqual(['writeApproved']);
  });

  it('demais gravações continuam desligadas mesmo com a liberação', async () => {
    const f = fake();
    const pd = new PipedriveReal({ token: 't', writeApproved: true, fetch: f.fn });
    await pd.updateDeal('1', { stage: 'Proposta apresentada', valueCents: 1 });
    await pd.markWon('1', '2026-11-05');
    expect(f.calls.filter(c => c.method !== 'GET')).toEqual([]);
  });
});

describe('aprovação e envio gravam no negócio', () => {
  let app: FastifyInstance;
  let db: Db;
  let connectors: Connectors;
  beforeEach(async () => { connectors = createConnectors({}); ({ app, db } = await testApp({ connectors })); });
  const later = () => new Date(Date.now() + 60000);

  it('aprovar grava valor e parcelas; enviar grava a validade', async () => {
    const a = api(app);
    const p = (await a.importDeal()).json();
    await a.newVersion(p.id, 1, versionBody());
    await a.approve(p.id, 2, 'larissa');
    await runDueJobs(db, connectors, later());
    const mock = connectors.pipedrive as PipedriveMock;
    expect(mock.approvedWrites.at(-1)).toMatchObject({ dealId: '2018', valueCents: 1500000, installments: 3 });
    await a.send(p.id);
    await runDueJobs(db, connectors, new Date(Date.now() + 120000));
    expect(mock.approvedWrites.at(-1)!.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('recusa não grava nada', async () => {
    const a = api(app);
    const p = (await a.importDeal()).json();
    await a.newVersion(p.id, 1, versionBody());
    await a.approve(p.id, 2, 'larissa', 'RECUSADA');
    await runDueJobs(db, connectors, later());
    expect((connectors.pipedrive as PipedriveMock).approvedWrites).toEqual([]);
  });
});
