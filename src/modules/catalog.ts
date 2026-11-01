import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { newId, type Db } from '../db/client.ts';

export interface Solution {
  code: string;
  name: string;
  front: string;
  complexity: number;
  stages: { name: string; days: number; daysValidated: boolean }[];
}
export interface Catalog { id: string; version: number; solutions: Solution[] }

const SEED = fileURLToPath(new URL('../db/seeds/catalog-v0.json', import.meta.url));

/** Carrega o catálogo semente como versão 1, se ainda não houver catálogo. Dias ficam "não validados" (D4). */
export async function seedCatalog(db: Db): Promise<void> {
  const exists = await db.query('select 1 from catalog_versions limit 1');
  if (exists.rows.length) return;
  const rows: { code: string; name: string; front: string; complexity: number; stages: { name: string; days: number }[] }[] =
    JSON.parse(readFileSync(SEED, 'utf8'));
  await db.transaction(async tx => {
    const cv = newId();
    await tx.query('insert into catalog_versions (id, version, origin) values ($1, 1, $2)', [cv, '05_Catalogo_Semente_v0.xlsx']);
    for (const s of rows) {
      const sid = newId();
      await tx.query('insert into solutions (id, catalog_version_id, code, name, front, complexity) values ($1,$2,$3,$4,$5,$6)',
        [sid, cv, s.code, s.name, s.front, s.complexity]);
      for (const [pos, st] of s.stages.entries()) {
        await tx.query('insert into solution_stages (id, solution_id, position, name, days, days_validated) values ($1,$2,$3,$4,$5,false)',
          [newId(), sid, pos, st.name, st.days]);
      }
    }
  });
}

export async function getCatalog(db: Pick<Db, 'query'>, id: string): Promise<Catalog> {
  const cv = await db.query<{ id: string; version: number }>('select id, version from catalog_versions where id = $1', [id]);
  if (!cv.rows.length) throw new Error(`catálogo não encontrado: ${id}`);
  const sols = await db.query<{ id: string; code: string; name: string; front: string; complexity: number }>(
    'select id, code, name, front, complexity from solutions where catalog_version_id = $1 order by code', [id]);
  const stages = await db.query<{ solution_id: string; name: string; days: number; days_validated: boolean }>(
    `select st.solution_id, st.name, st.days, st.days_validated from solution_stages st
     join solutions s on s.id = st.solution_id where s.catalog_version_id = $1 order by st.position`, [id]);
  return {
    ...cv.rows[0],
    solutions: sols.rows.map(s => ({
      code: s.code, name: s.name, front: s.front, complexity: s.complexity,
      stages: stages.rows.filter(st => st.solution_id === s.id).map(st => ({ name: st.name, days: st.days, daysValidated: st.days_validated })),
    })),
  };
}

export async function getActiveCatalog(db: Pick<Db, 'query'>): Promise<Catalog> {
  const r = await db.query<{ id: string }>('select id from catalog_versions order by version desc limit 1');
  if (!r.rows.length) throw new Error('nenhum catálogo cadastrado');
  return getCatalog(db, r.rows[0].id);
}
