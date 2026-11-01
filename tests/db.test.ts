import { describe, it, expect, beforeEach } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { recordAudit } from '../src/modules/audit.ts';

const IMMUTABLE = [
  'parameter_versions', 'catalog_versions', 'solutions', 'solution_stages', 'proposal_versions',
  'approvals', 'contracts', 'connector_runs', 'audit_events',
];

let db: Db;
beforeEach(async () => {
  db = await openDb();
  await migrate(db);
});

describe('banco', () => {
  it('migrate é idempotente', async () => {
    await migrate(db);
    const r = await db.query<{ n: number }>('select count(*)::int as n from schema_migrations');
    const files = readdirSync(fileURLToPath(new URL('../src/db/migrations/', import.meta.url))).filter(f => f.endsWith('.sql'));
    expect(r.rows[0].n).toBe(files.length);
  });

  it('audit_events é imutável', async () => {
    await recordAudit(db, { actorId: 'u1', entity: 'teste', entityId: '1', action: 'criar', after: { a: 1 } });
    const r = await db.query<{ n: number }>('select count(*)::int as n from audit_events');
    expect(r.rows[0].n).toBe(1);
    await expect(db.query("update audit_events set action = 'x'")).rejects.toThrow(/imutável/);
    await expect(db.query('delete from audit_events')).rejects.toThrow(/imutável/);
  });

  it('toda tabela imutável tem trigger', async () => {
    for (const t of IMMUTABLE) {
      const r = await db.query<{ n: number }>(
        `select count(*)::int as n from pg_trigger where tgrelid = '${t}'::regclass and not tgisinternal`,
      );
      expect(r.rows[0].n, t).toBeGreaterThanOrEqual(1);
    }
  });
});
