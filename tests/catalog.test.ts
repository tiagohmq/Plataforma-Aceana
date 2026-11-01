import { it, expect, beforeAll } from 'vitest';
import type { Db } from '../src/db/client.ts';
import { freshDb } from './helpers.ts';
import { seedCatalog, getActiveCatalog } from '../src/modules/catalog.ts';
import { seedHolidays, getHolidays } from '../src/modules/holidays.ts';

let db: Db;
beforeAll(async () => {
  db = await freshDb();
  await seedCatalog(db);
  await seedHolidays(db);
});

it('catálogo semente tem 31 soluções com dias não validados', async () => {
  const c = await getActiveCatalog(db);
  expect(c.version).toBe(1);
  expect(c.solutions).toHaveLength(31);
  expect(c.solutions[0].code).toBe('SOL-001');
  expect(c.solutions[30].code).toBe('SOL-031');
  expect(c.solutions.every(s => s.stages.every(st => st.daysValidated === false))).toBe(true);
  const fin = c.solutions.find(s => s.code === 'SOL-017')!;
  expect(fin.stages.map(s => s.days)).toEqual([7, 38, 74]);
  expect(fin.complexity).toBe(3);
});

it('semear de novo não duplica', async () => {
  await seedCatalog(db);
  const r = await db.query<{ n: number }>('select count(*)::int as n from catalog_versions');
  expect(r.rows[0].n).toBe(1);
});

it('feriados semente incluem nacionais e Recife', async () => {
  const h = await getHolidays(db);
  expect(h.has('2026-11-20')).toBe(true);
  expect(h.has('2026-12-25')).toBe(true);
  expect(h.has('2026-07-16')).toBe(true);
});
