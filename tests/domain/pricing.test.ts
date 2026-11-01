import { describe, it, expect } from 'vitest';
import { computeMargins } from '../../src/domain/pricing.ts';
import { toCents, fromCents } from '../../src/domain/money.ts';
import { PARAMETER_SEEDS } from '../../src/db/seeds/parameters.ts';

const base = PARAMETER_SEEDS[1].values;
const at = (hourCost: number) => ({ ...base, hourCost });
const m = (V: number, C: number, days: number, members: number, hourCost = 23.45) =>
  computeMargins({ valueCents: toCents(V), externalCostsCents: toCents(C), days, members }, at(hourCost));
const pct = (x: number | null) => (x === null ? null : x * 100);

// Golden tests da spec §7 / contexto §9.4: [h=24,2884, h=23,45]
describe.each([
  { h: 24.2884, i: 0 },
  { h: 23.45, i: 1 },
])('golden com custo da hora $h', ({ h, i }) => {
  it('Projeto padrão', () => {
    const r = m(15000, 0, 60, 3, h);
    expect(fromCents(r.floorCents)).toBe(13500);
    expect(fromCents(r.contributionCents)).toBeCloseTo([9878.09, 10029.0][i], 2);
    expect(pct(r.contributionPct)!).toBeCloseTo([65.9, 66.9][i], 1);
    expect(pct(r.totalResultPct)!).toBeCloseTo([50.1, 51.1][i], 1);
    expect(r.light).toBe('verde');
    expect(r.requiresException).toBe(false);
  });

  it('Russa', () => {
    const r = m(9346.69, 360, 27, 3, h);
    expect(fromCents(r.floorCents)).toBe(6075);
    expect(pct(r.contributionPct)!).toBeCloseTo([70.1, 70.8][i], 1);
    expect(pct(r.totalResultPct)!).toBeCloseTo([54.3, 55.1][i], 1);
  });

  it('Brutos e Regis (abaixo do piso)', () => {
    const r = m(12000, 0, 81, 3, h);
    expect(fromCents(r.floorCents)).toBe(18225);
    expect(r.alerts).toContain('BELOW_FLOOR');
    expect(r.requiresException).toBe(true);
    expect(pct(r.contributionPct)!).toBeCloseTo([45.8, 47.5][i], 1);
    expect(pct(r.totalResultPct)!).toBeCloseTo([30.05, 31.75][i], 1);
  });
});

describe('golden só com 23,45', () => {
  it('Piso 20×3 é verde', () => {
    const r = m(4500, 0, 20, 3);
    expect(fromCents(r.floorCents)).toBe(4500);
    expect(r.light).toBe('verde');
    expect(pct(r.contributionPct)!).toBeCloseTo(63.7, 1);
    expect(pct(r.totalResultPct)!).toBeCloseTo(48.0, 1);
    expect(r.alerts).not.toContain('BELOW_FLOOR');
  });
});

describe('bordas', () => {
  it('V = 0 não divide por zero', () => {
    const r = m(0, 0, 10, 2);
    expect(r.contributionPct).toBeNull();
    expect(r.totalResultPct).toBeNull();
    expect(r.light).toBe('vermelho');
    expect(r.requiresException).toBe(true);
  });

  it('custos externos: 15% exato sem alerta, 1 centavo acima com alerta', () => {
    expect(m(10000, 1500, 10, 1).alerts).not.toContain('EXTERNAL_COST');
    expect(m(10000, 1500.01, 10, 1).alerts).toContain('EXTERNAL_COST');
  });

  // V = 10.000, d = 10, m = 1, h = 23,45: contribuição = 9.265,50 − C
  it('contribuição exatamente 55% é verde', () => {
    const r = m(10000, 3765.5, 10, 1);
    expect(r.contributionPct).toBe(0.55);
    expect(r.light).toBe('verde');
  });
  it('contribuição exatamente 30% é amarelo e não exige exceção', () => {
    const r = m(10000, 6265.5, 10, 1);
    expect(r.contributionPct).toBe(0.3);
    expect(r.light).toBe('amarelo');
    expect(r.requiresException).toBe(false);
  });
  it('contribuição 29,99% é vermelho e exige exceção', () => {
    const r = m(10000, 6266.5, 10, 1);
    expect(r.light).toBe('vermelho');
    expect(r.requiresException).toBe(true);
  });
});
