import { newId, type Db } from '../db/client.ts';

export interface AuditEntry {
  actorId: string | null;
  entity: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
}

type Queryable = Pick<Db, 'query'>;

/** Registra um evento de auditoria. A tabela só aceita inserção. */
export async function recordAudit(db: Queryable, e: AuditEntry): Promise<void> {
  await db.query(
    'insert into audit_events (id, actor_id, entity, entity_id, action, before, after) values ($1,$2,$3,$4,$5,$6,$7)',
    [newId(), e.actorId, e.entity, e.entityId, e.action, e.before === undefined ? null : JSON.stringify(e.before), e.after === undefined ? null : JSON.stringify(e.after)],
  );
}
