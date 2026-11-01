import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db/client.ts';
import { freshDb } from './helpers.ts';
import { buildApp } from '../src/http/app.ts';
import { seedAll } from '../src/db/seed.ts';
import { createConnectors, type Connectors } from '../src/connectors/index.ts';

export const TEST_SECRETS = {
  clicksignHmac: 'segredo-de-teste',
  contractKey: Buffer.alloc(32, 7),
};

/** App com banco em memória, todas as sementes e conectores mock. */
export async function testApp(opts: { now?: () => Date; connectors?: Connectors } = {}): Promise<{ app: FastifyInstance; db: Db }> {
  const db = await freshDb();
  await seedAll(db);
  const app = await buildApp({ db, now: opts.now, connectors: opts.connectors ?? createConnectors({}), secrets: TEST_SECRETS, testRoutes: true });
  return { app, db };
}
