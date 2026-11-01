import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db/client.ts';
import { freshDb } from './helpers.ts';
import { buildApp } from '../src/http/app.ts';
import { seedAll } from '../src/db/seed.ts';

/** App com banco em memória e todas as sementes. */
export async function testApp(opts: { now?: () => Date } = {}): Promise<{ app: FastifyInstance; db: Db }> {
  const db = await freshDb();
  await seedAll(db);
  const app = await buildApp({ db, now: opts.now, testRoutes: true });
  return { app, db };
}
