import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';

export type Db = PGlite;

/** Abre o banco. Sem dataDir, fica em memória (testes). */
export async function openDb(opts: { dataDir?: string } = {}): Promise<Db> {
  const db = opts.dataDir ? new PGlite(opts.dataDir) : new PGlite();
  await db.waitReady;
  return db;
}

export const newId = (): string => randomUUID();
