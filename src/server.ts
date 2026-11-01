import { openDb } from './db/client.ts';
import { migrate } from './db/migrate.ts';
import { seedAll } from './db/seed.ts';
import { buildApp, secretsFromEnv } from './http/app.ts';
import { createConnectors } from './connectors/index.ts';
import { startWorker, recoverRunningJobs } from './jobs/worker.ts';
import { PipedriveMock } from './connectors/pipedrive/mock.ts';
import { rehydratePipedriveMock } from './connectors/pipedrive/rehydrate.ts';

const secrets = secretsFromEnv();
if (!secrets.contractKey || secrets.contractKey.length !== 32) {
  console.error('CONTRACT_KEY ausente ou inválida no .env (precisa de 32 bytes em base64). Veja o .env.example.');
  process.exit(1);
}

const db = await openDb({ dataDir: process.env.DATA_DIR ?? './data' });
await migrate(db);
await seedAll(db);
const connectors = createConnectors();
await recoverRunningJobs(db);
if (connectors.pipedrive instanceof PipedriveMock) await rehydratePipedriveMock(db, connectors.pipedrive);
const app = await buildApp({ db, connectors, secrets, demo: process.env.DEMO_MODE === "1" });
startWorker(db, connectors);
const port = Number(process.env.PORT ?? 3333);
await app.listen({ port, host: '127.0.0.1' });
console.log(`Plataforma ACEANA em http://localhost:${port}`);
