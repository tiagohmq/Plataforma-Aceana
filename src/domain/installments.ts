import type { Params } from './params-schema.ts';

/** Máximo de parcelas = teto(dias ÷ divisor) + 1 (hipótese da planilha Disalp). */
export const maxInstallments = (days: number, p: Params): number =>
  Math.ceil(days / p.maxInstallmentsDivisor) + 1;

/** Divide em n parcelas iguais em centavos; a sobra do arredondamento vai para a última. */
export function splitInstallments(totalCents: number, n: number): number[] {
  const each = Math.floor(totalCents / n);
  const parts = Array.from({ length: n }, () => each);
  parts[n - 1] += totalCents - each * n;
  return parts;
}
