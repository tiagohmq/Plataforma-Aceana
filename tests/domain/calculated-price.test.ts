import { it, expect } from 'vitest';
import { computeCalculatedPrice, type CalcInput } from '../../src/domain/calculated-price.ts';
import { PARAMETER_SEEDS } from '../../src/db/seeds/parameters.ts';

// Parâmetros da época da planilha Russa (aba Ferramenta: Q24, Q25, Q28)
const russaParams = { ...PARAMETER_SEEDS[0].values, hourCost: 24.28835131, hoursPerConsultantDay: 2.915897436, hoursPerManagerDay: 5.033333333 };

const russa: CalcInput = {
  stages: [{ days: 3, consultants: 2 }, { days: 14, consultants: 2 }, { days: 10, consultants: 2 }],
  complexity: 3, capacity: 0.7684, size: 'EPP', payment: 'BOLETO', channel: 'OUTBOUND',
  modality: 'REMOTO', discount: 'NENHUM', outsourcing: 'NENHUMA', externalCostsCents: 36000,
};

it('Russa reproduz a planilha', () => {
  const r = computeCalculatedPrice(russa, russaParams);
  expect(Math.abs(r.minimumCents - 925830)).toBeLessThanOrEqual(1);
  expect(Math.abs(r.adjustedCents - 846961)).toBeLessThanOrEqual(1);
  expect(Math.abs(r.finalCents - 934669)).toBeLessThanOrEqual(1);
});

it('5 ou mais consultores usam 1,20 sem ISS no fator', () => {
  const r = computeCalculatedPrice({ ...russa, stages: [{ days: 10, consultants: 6 }] }, russaParams);
  const f = r.memory.find(x => x.label.startsWith('consultores'));
  expect(f?.factor).toBe(1.2);
  expect(r.memory.filter(x => x.label === 'ISS')).toHaveLength(1);
});

it('todas as etapas entram na soma', () => {
  const one = computeCalculatedPrice({ ...russa, stages: [{ days: 1, consultants: 1 }] }, russaParams).minimumCents;
  const eight = computeCalculatedPrice({ ...russa, stages: Array.from({ length: 8 }, () => ({ days: 1, consultants: 1 })) }, russaParams).minimumCents;
  expect(Math.abs(eight - one * 8)).toBeLessThanOrEqual(8);
});

it('esperado e máximo saem do mínimo', () => {
  const r = computeCalculatedPrice(russa, russaParams);
  expect(r.expectedCents).toBe(Math.round(r.minimumCents * russaParams.expectedFactor));
  expect(r.maxCents).toBe(Math.round(r.minimumCents * russaParams.maxFactor));
});

it('complexidade sem multiplicador é erro', () => {
  expect(() => computeCalculatedPrice({ ...russa, complexity: 0 as 1 }, russaParams)).toThrow(/complexidade/);
});
