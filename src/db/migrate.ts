import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from './client.ts';

const DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

/** Aplica, em ordem, os arquivos .sql ainda não registrados em schema_migrations. */
export async function migrate(db: Db): Promise<void> {
  await db.exec('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).rows.map(r => r.name));
  for (const file of readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    await db.transaction(async tx => {
      await tx.exec(readFileSync(DIR + file, 'utf8'));
      await tx.query('insert into schema_migrations(name) values ($1)', [file]);
    });
  }
}
