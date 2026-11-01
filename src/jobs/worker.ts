import { newId, type Db } from '../db/client.ts';
import type { Connectors } from '../connectors/index.ts';
import { HANDLERS } from './handlers.ts';

export const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 5000;

/** Processa os jobs pendentes vencidos. Falha: tenta de novo com espera 2^tentativas × 5 s; após 5, fica "failed". */
export async function runDueJobs(db: Db, connectors: Connectors, now: Date = new Date()): Promise<number> {
  const due = await db.query<{ id: string; type: string; payload: unknown; attempts: number }>(
    "select id, type, payload, attempts from jobs where status = 'pending' and next_at <= $1 order by created_at", [now.toISOString()]);
  for (const j of due.rows) {
    const claimed = await db.query("update jobs set status = 'running', updated_at = now() where id = $1 and status = 'pending' returning id", [j.id]);
    if (!claimed.rows.length) continue;
    const started = Date.now();
    const connector = j.type.split('.')[0];
    try {
      const h = HANDLERS[j.type];
      if (!h) throw new Error(`tipo de job desconhecido: ${j.type}`);
      await h(db, connectors, j.payload);
      await db.query("update jobs set status = 'done', last_error = null, updated_at = now() where id = $1", [j.id]);
      await db.query('insert into connector_runs (id, job_id, connector, event, ok, duration_ms) values ($1,$2,$3,$4,true,$5)', [newId(), j.id, connector, j.type, Date.now() - started]);
    } catch (e) {
      const attempts = j.attempts + 1;
      const msg = String((e as Error).message).slice(0, 500);
      const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
      const next = new Date(now.getTime() + 2 ** attempts * BACKOFF_BASE_MS).toISOString();
      await db.query('update jobs set status = $2, attempts = $3, next_at = $4, last_error = $5, updated_at = now() where id = $1', [j.id, status, attempts, next, msg]);
      await db.query('insert into connector_runs (id, job_id, connector, event, ok, error, duration_ms) values ($1,$2,$3,$4,false,$5,$6)', [newId(), j.id, connector, j.type, msg, Date.now() - started]);
    }
  }
  return due.rows.length;
}

/** Roda a fila em segundo plano. Devolve a função que para o worker. */
export function startWorker(db: Db, connectors: Connectors, intervalMs = 1000): () => void {
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await runDueJobs(db, connectors); } catch (e) { console.error('worker:', (e as Error).message); } finally { busy = false; }
  }, intervalMs);
  return () => clearInterval(t);
}

/** Reprocesso com um clique (só Administração, checado na rota). */
export async function retryJob(db: Db, jobId: string): Promise<boolean> {
  const r = await db.query("update jobs set status = 'pending', next_at = now(), attempts = 0, updated_at = now() where id = $1 and status in ('failed','pending','running') returning id", [jobId]);
  return r.rows.length > 0;
}

/** Na partida: job que estava em execução quando o processo caiu volta para a fila (a idempotência evita duplicar). */
export async function recoverRunningJobs(db: Db): Promise<number> {
  const r = await db.query("update jobs set status = 'pending', next_at = now(), updated_at = now() where status = 'running' returning id");
  return r.rows.length;
}
