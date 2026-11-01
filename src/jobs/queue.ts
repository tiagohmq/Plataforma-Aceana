import { newId, type Db } from '../db/client.ts';

export interface JobInput { type: string; payload: object; idempotencyKey: string }

/** Enfileira uma chamada externa. Mesma chave de idempotência = mesmo job (não duplica). */
export async function enqueueJob(db: Pick<Db, 'query'>, j: JobInput): Promise<{ id: string; created: boolean }> {
  const id = newId();
  const ins = await db.query<{ id: string }>(
    'insert into jobs (id, type, payload, idempotency_key) values ($1,$2,$3,$4) on conflict (idempotency_key) do nothing returning id',
    [id, j.type, JSON.stringify(j.payload), j.idempotencyKey]);
  if (ins.rows.length) return { id, created: true };
  const cur = await db.query<{ id: string }>('select id from jobs where idempotency_key = $1', [j.idempotencyKey]);
  return { id: cur.rows[0].id, created: false };
}
