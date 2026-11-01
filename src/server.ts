import { openDb } from './db/client.ts';
import { migrate } from './db/migrate.ts';
import { seedAll } from './db/seed.ts';
import { buildApp } from './http/app.ts';

const db = await openDb({ dataDir: process.env.DATA_DIR ?? './data' });
await migrate(db);
await seedAll(db);
const app = await buildApp({ db });
const port = Number(process.env.PORT ?? 3333);
await app.listen({ port, host: '127.0.0.1' });
console.log(`Plataforma ACEANA em http://localhost:${port}`);
