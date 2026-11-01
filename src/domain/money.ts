// Dinheiro sempre em centavos inteiros. Arredonda uma vez, meio para cima.
export const toCents = (reais: number): number => Math.round(reais * 100);
export const fromCents = (cents: number): number => cents / 100;
/** Centavos × fator, arredondado. */
export const mulCents = (cents: number, factor: number): number => Math.round(cents * factor);
