import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';

/** Banco em memória já migrado. */
export async function freshDb(): Promise<Db> {
  const db = await openDb();
  await migrate(db);
  return db;
}
