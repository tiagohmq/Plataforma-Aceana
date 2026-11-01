import { newId, type Db } from '../db/client.ts';
import { PARAMETER_SEEDS } from '../db/seeds/parameters.ts';
import { ParamsSchema, type Params } from '../domain/params-schema.ts';
import { recordAudit } from './audit.ts';

export interface ParamsVersion { id: string; version: number; values: Params }

/** Grava as versões semente que ainda não existem. */
export async function seedParameters(db: Db): Promise<void> {
  for (const s of PARAMETER_SEEDS) {
    const exists = await db.query('select 1 from parameter_versions where version = $1', [s.version]);
    if (exists.rows.length) continue;
    await db.query('insert into parameter_versions (id, version, values, origin) values ($1,$2,$3,$4)',
      [newId(), s.version, JSON.stringify(ParamsSchema.parse(s.values)), s.origin]);
  }
}

/** Versão vigente = a de maior número. */
export async function getActiveParams(db: Pick<Db, 'query'>): Promise<ParamsVersion> {
  const r = await db.query<{ id: string; version: number; values: Params }>(
    'select id, version, values from parameter_versions order by version desc limit 1');
  if (!r.rows.length) throw new Error('nenhuma versão de parâmetros cadastrada');
  return r.rows[0];
}

export async function getParams(db: Pick<Db, 'query'>, id: string): Promise<Params> {
  const r = await db.query<{ values: Params }>('select values from parameter_versions where id = $1', [id]);
  if (!r.rows.length) throw new Error(`versão de parâmetros não encontrada: ${id}`);
  return r.rows[0].values;
}

/** Publica uma nova versão; as anteriores ficam intactas. */
export async function publishParams(db: Db, actorId: string, values: Params): Promise<{ id: string; version: number }> {
  const parsed = ParamsSchema.parse(values);
  return db.transaction(async tx => {
    const cur = await tx.query<{ v: number }>('select coalesce(max(version), 0)::int as v from parameter_versions');
    const version = cur.rows[0].v + 1;
    const id = newId();
    await tx.query('insert into parameter_versions (id, version, values, author_id, origin) values ($1,$2,$3,$4,$5)',
      [id, version, JSON.stringify(parsed), actorId, 'publicação na plataforma']);
    await recordAudit(tx, { actorId, entity: 'parameter_versions', entityId: id, action: 'params.publish', after: { version } });
    return { id, version };
  });
}
