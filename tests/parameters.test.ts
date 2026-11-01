import { describe, it, expect, beforeAll } from 'vitest';
import type { Db } from '../src/db/client.ts';
import { freshDb } from './helpers.ts';
import { seedParameters, getActiveParams, getParams, publishParams } from '../src/modules/parameters.ts';
import { ParamsSchema } from '../src/domain/params-schema.ts';

let db: Db;
beforeAll(async () => {
  db = await freshDb();
  await seedParameters(db);
});

describe('parâmetros', () => {
  it('semente cria v1 e v2, v2 ativa', async () => {
    const active = await getActiveParams(db);
    expect(active.version).toBe(2);
    expect(active.values.hourCost).toBe(23.45);
    expect(active.values.backoffice).toBe(0.05764);
    expect(active.values.hoursPerConsultantDay).toBe(2.997948718);
    const v1 = await db.query<{ id: string }>('select id from parameter_versions where version = 1');
    const p1 = await getParams(db, v1.rows[0].id);
    expect(p1.hourCost).toBe(24.2884);
    expect(p1.hoursPerConsultantDay).toBe(2.915897436);
  });

  it('semear de novo não duplica', async () => {
    await seedParameters(db);
    const r = await db.query<{ n: number }>('select count(*)::int as n from parameter_versions');
    expect(r.rows[0].n).toBe(2);
  });

  it('publicar cria v3 e não altera v2', async () => {
    const v2 = await getActiveParams(db);
    const out = await publishParams(db, 'dp1', { ...v2.values, hourCost: 25 });
    expect(out.version).toBe(3);
    expect((await getActiveParams(db)).values.hourCost).toBe(25);
    expect(await getParams(db, v2.id)).toEqual(v2.values);
    const a = await db.query<{ n: number }>("select count(*)::int as n from audit_events where action = 'params.publish'");
    expect(a.rows[0].n).toBe(1);
  });

  it('schema rejeita valor inválido', async () => {
    const v = (await getActiveParams(db)).values;
    expect(() => ParamsSchema.parse({ ...v, greenMin: 1.5 })).toThrow();
  });
});
