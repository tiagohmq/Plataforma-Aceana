import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db/client.ts';
import { testApp } from './app-helper.ts';
import { computeMargins } from '../src/domain/pricing.ts';
import { getActiveParams } from '../src/modules/parameters.ts';
import { as, versionBody, api } from './fixtures.ts';

let app: FastifyInstance;
let db: Db;
beforeEach(async () => ({ app, db } = await testApp()));

const { importDeal, newVersion } = { importDeal: (d?: string, u?: string) => api(app).importDeal(d, u), newVersion: (id: string, e: number, b: object = versionBody(), u?: string) => api(app).newVersion(id, e, b, u) };

describe('propostas', () => {
  it('importar duas vezes devolve a mesma proposta', async () => {
    const a = await importDeal();
    const b = await importDeal();
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.json().id).toBe(a.json().id);
    expect(a.json().id).toMatch(/^PROP_\d{4}-\d{2}_MerceariaSolNascente$/);
    expect(a.json().currentVersion.number).toBe(1);
  });

  it('GP não importa deal', async () => {
    expect((await importDeal('2018', 'clara')).statusCode).toBe(403);
  });

  it('nova versão recalcula no servidor e grava as versões usadas', async () => {
    const p = (await importDeal()).json();
    const r = await newVersion(p.id, 1);
    expect(r.statusCode).toBe(201);
    const v = r.json().currentVersion;
    expect(v.number).toBe(2);
    expect(v.result.days).toBe(60);
    expect(v.result.members).toBe(3);
    const params = (await getActiveParams(db)).values;
    const expected = computeMargins({ valueCents: 1500000, externalCostsCents: 0, days: 60, members: 3 }, params);
    expect(v.result.margins).toEqual(expected);
    expect(v.parameterVersionId).toBe((await getActiveParams(db)).id);
    expect(v.catalogVersionId).toBeTruthy();
    expect(v.result.installmentsCents).toEqual([500000, 500000, 500000]);
  });

  it('sem preço apresentado usa o preço calculado', async () => {
    const p = (await importDeal()).json();
    const body = versionBody();
    delete (body as Record<string, unknown>).presentedCents;
    const v = (await newVersion(p.id, 1, body)).json().currentVersion;
    expect(v.result.valueCents).toBe(v.result.calculated.finalCents);
  });

  it('valor vendido passa a ser a base da margem', async () => {
    const p = (await importDeal()).json();
    const v = (await newVersion(p.id, 1, versionBody({ soldCents: 1200000 }))).json().currentVersion;
    expect(v.result.valueCents).toBe(1200000);
  });

  it('versão concorrente → 409', async () => {
    const p = (await importDeal()).json();
    expect((await newVersion(p.id, 1)).statusCode).toBe(201);
    const second = await newVersion(p.id, 1);
    expect(second.statusCode).toBe(409);
    expect(second.json().codigo).toBe('VERSAO_DESATUALIZADA');
  });

  it.each([
    ['dias fracionados', { scope: { solutionCode: 'SOL-017', stages: [{ name: 'Start', days: 2.5, consultants: 2 }] } }],
    ['zero consultores', { scope: { solutionCode: 'SOL-017', stages: [{ name: 'Start', days: 10, consultants: 0 }] } }],
    ['valor negativo', { presentedCents: -1 }],
  ])('entrada inválida (%s) → 400', async (_n, over) => {
    const p = (await importDeal()).json();
    expect((await newVersion(p.id, 1, versionBody(over))).statusCode).toBe(400);
  });

  it('parcelas acima do máximo → 409', async () => {
    const p = (await importDeal()).json();
    const r = await newVersion(p.id, 1, versionBody({ installments: 9 }));
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('PARCELAS_ACIMA_DO_MAXIMO');
  });

  it('GP não vê margem nem piso', async () => {
    const p = (await importDeal()).json();
    await newVersion(p.id, 1);
    const r = await app.inject({ method: 'GET', url: `/api/proposals/${p.id}`, headers: as('clara') });
    expect(r.statusCode).toBe(200);
    expect(JSON.stringify(r.json())).not.toMatch(/contribution|floorCents|totalResult/);
  });

  it('proposta antiga mantém os parâmetros da época', async () => {
    const p = (await importDeal()).json();
    const before = (await newVersion(p.id, 1)).json().currentVersion;
    const cur = (await app.inject({ method: 'GET', url: '/api/params/active', headers: as('dp') })).json();
    await app.inject({ method: 'POST', url: '/api/params', headers: as('dp'), payload: { ...cur.values, hourCost: 40 } });
    const again = (await app.inject({ method: 'GET', url: `/api/proposals/${p.id}/versions/2`, headers: as('larissa') })).json();
    expect(again.result.margins).toEqual(before.result.margins);
    expect(again.parameterVersionId).toBe(before.parameterVersionId);
  });

  it('lista propostas', async () => {
    await importDeal('2018');
    await importDeal('2019');
    const r = await app.inject({ method: 'GET', url: '/api/proposals', headers: as('larissa') });
    expect(r.json()).toHaveLength(2);
  });
});
