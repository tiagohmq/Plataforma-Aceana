import type { Db } from './client.ts';
import { USER_SEEDS } from './seeds/users.ts';
import { seedParameters } from '../modules/parameters.ts';
import { seedCatalog } from '../modules/catalog.ts';
import { seedHolidays } from '../modules/holidays.ts';

/** Sementes idempotentes: pode rodar a cada inicialização. */
export async function seedAll(db: Db): Promise<void> {
  for (const u of USER_SEEDS) {
    await db.query('insert into users (id, name, email, role) values ($1,$2,$3,$4) on conflict (id) do nothing', [u.id, u.name, u.email, u.role]);
  }
  await seedParameters(db);
  await seedCatalog(db);
  await seedHolidays(db);
}
