import { it, expect } from 'vitest';
import { maxInstallments, splitInstallments } from '../../src/domain/installments.ts';
import { PARAMETER_SEEDS } from '../../src/db/seeds/parameters.ts';

const p = PARAMETER_SEEDS[1].values;

it('máximo de parcelas = teto(dias ÷ 20) + 1', () => {
  expect(maxInstallments(27, p)).toBe(3);
  expect(maxInstallments(20, p)).toBe(2);
  expect(maxInstallments(21, p)).toBe(3);
  expect(maxInstallments(0, p)).toBe(1);
});

it('sobra do arredondamento vai para a última parcela', () => {
  expect(splitInstallments(800000, 3)).toEqual([266666, 266666, 266668]);
  for (const [t, n] of [[934669, 3], [100, 7], [1, 1]]) {
    expect(splitInstallments(t, n).reduce((a, b) => a + b, 0)).toBe(t);
  }
});
