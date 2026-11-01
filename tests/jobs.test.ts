import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db/client.ts';
import { openDb } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { createConnectors, type Connectors } from '../src/connectors/index.ts';
import type { MondayMock } from '../src/connectors/monday/mock.ts';
import { enqueueJob } from '../src/jobs/queue.ts';
import { runDueJobs } from '../src/jobs/worker.ts';
import { testApp } from './app-helper.ts';
import { as } from './fixtures.ts';

let app: FastifyInstance;
let db: Db;
let connectors: Connectors;
const later = (min: number) => new Date(Date.now() + min * 60000);

beforeEach(async () => {
  connectors = createConnectors({});
  ({ app, db } = await testApp({ connectors }));
});

const mondayJob = (dealId = '2018') => enqueueJob(db, {
  type: 'monday.createProject', idempotencyKey: `monday:${dealId}`,
  payload: { dealId, name: 'Mercearia Sol Nascente', valueCents: 1500000, days: 60, allocated: 2, front: 'Financeiro', wonAt: '2026-11-05', handoffUrl: '/x' },
});

describe('fila', () => {
  it('job bem-sucedido fica done e registra execução', async () => {
    await mondayJob();
    expect(await runDueJobs(db, connectors, later(1))).toBe(1);
    const j = await db.query<{ status: string }>('select status from jobs');
    expect(j.rows[0].status).toBe('done');
    const runs = await db.query<{ ok: boolean }>('select ok from connector_runs');
    expect(runs.rows).toEqual([{ ok: true }]);
    expect((connectors.monday as MondayMock).items.size).toBe(1);
  });

  it('falha volta para pending com backoff e depois conclui sem duplicar', async () => {
    (connectors.monday as MondayMock).failNext = 1;
    await mondayJob();
    await runDueJobs(db, connectors, later(1));
    const j1 = await db.query<{ status: string; attempts: number }>('select status, attempts from jobs');
    expect(j1.rows[0]).toEqual({ status: 'pending', attempts: 1 });
    await runDueJobs(db, connectors, later(10));
    expect((await db.query<{ status: string }>('select status from jobs')).rows[0].status).toBe('done');
    expect((connectors.monday as MondayMock).items.size).toBe(1);
  });

  it('após 5 falhas fica failed; reprocesso pelo admin conclui', async () => {
    (connectors.monday as MondayMock).failNext = 5;
    const { id } = await mondayJob();
    for (let i = 1; i <= 5; i++) await runDueJobs(db, connectors, later(i * 60));
    expect((await db.query<{ status: string }>('select status from jobs')).rows[0].status).toBe('failed');
    const gn = await app.inject({ method: 'POST', url: `/api/jobs/${id}/retry`, headers: as('larissa') });
    expect(gn.statusCode).toBe(403);
    const adm = await app.inject({ method: 'POST', url: `/api/jobs/${id}/retry`, headers: as('admin') });
    expect(adm.statusCode).toBe(200);
    await runDueJobs(db, connectors, later(600));
    expect((await db.query<{ status: string }>('select status from jobs')).rows[0].status).toBe('done');
    expect((connectors.monday as MondayMock).items.size).toBe(1);
  });

  it('projeto já criado para o deal não é criado de novo', async () => {
    await mondayJob('2018');
    await runDueJobs(db, connectors, later(1));
    await enqueueJob(db, { type: 'monday.createProject', idempotencyKey: 'monday:2018:outra-chave', payload: { dealId: '2018', name: 'x', valueCents: 1, days: 1, allocated: 1, front: 'x', wonAt: '2026-11-05', handoffUrl: '/x' } });
    await runDueJobs(db, connectors, later(2));
    expect((connectors.monday as MondayMock).items.size).toBe(1);
  });

  it('jobs pendentes sobrevivem a reiniciar o servidor', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aceana-'));
    const d1 = await openDb({ dataDir: dir });
    await migrate(d1);
    await enqueueJob(d1, { type: 'pipedrive.markWon', idempotencyKey: 'won:2018', payload: { dealId: '2018', wonAt: '2026-11-05' } });
    await d1.close();
    const d2 = await openDb({ dataDir: dir });
    const c = createConnectors({});
    expect(await runDueJobs(d2, c, later(1))).toBe(1);
    expect((await c.pipedrive.getDeal('2018')).status).toBe('won');
    await d2.close();
  });

  it('lista de jobs só para admin', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/jobs', headers: as('larissa') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/jobs', headers: as('admin') })).statusCode).toBe(200);
  });
});
