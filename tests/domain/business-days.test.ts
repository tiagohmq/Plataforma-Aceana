import { it, expect } from 'vitest';
import { addBusinessDays } from '../../src/domain/business-days.ts';

it('sexta + 1 dia útil = segunda', () => {
  expect(addBusinessDays('2026-11-13', 1, new Set())).toBe('2026-11-16');
});

it('pula feriado', () => {
  expect(addBusinessDays('2026-11-19', 1, new Set(['2026-11-20']))).toBe('2026-11-23');
});

it('n = 0 devolve a própria data', () => {
  expect(addBusinessDays('2026-11-14', 0, new Set())).toBe('2026-11-14');
});
