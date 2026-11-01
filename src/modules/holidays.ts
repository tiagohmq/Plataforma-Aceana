import type { Db } from '../db/client.ts';
import { HOLIDAY_SEEDS } from '../db/seeds/holidays.ts';

export async function seedHolidays(db: Db): Promise<void> {
  for (const h of HOLIDAY_SEEDS) {
    await db.query('insert into holidays (day, scope, name, source) values ($1,$2,$3,$4) on conflict (day) do nothing',
      [h.day, h.scope, h.name, 'semente, validar na Administração']);
  }
}

export async function getHolidays(db: Pick<Db, 'query'>): Promise<Set<string>> {
  const r = await db.query<{ day: string }>("select to_char(day, 'YYYY-MM-DD') as day from holidays");
  return new Set(r.rows.map(x => x.day));
}
