import { it, expect } from 'vitest';
import { toClientView } from '../../src/domain/client-view.ts';
import { computeVersion, VersionInputSchema } from '../../src/modules/proposals.ts';
import { PARAMETER_SEEDS } from '../../src/db/seeds/parameters.ts';
import { versionBody } from '../fixtures.ts';

const FORBIDDEN = /contribution|margin|floor|externalCost|light|alert|param|hourCost|requiresException|calculated|cash|totalResult/i;

function keysDeep(o: unknown, acc: string[] = []): string[] {
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { acc.push(k); keysDeep(v, acc); }
  return acc;
}

it('visão do cliente não carrega margem, custo, piso nem parâmetros', () => {
  const input = VersionInputSchema.parse(versionBody({ externalCostsCents: 50000 }));
  const result = computeVersion(input, PARAMETER_SEEDS[1].values);
  const view = toClientView({
    proposalId: 'PROP_X', client: 'Cliente Teste', contact: 'Fulano', solutionName: 'Estruturação Financeira',
    input, result, validUntil: '2026-11-16',
  });
  expect(keysDeep(view).filter(k => FORBIDDEN.test(k))).toEqual([]);
  expect(JSON.stringify(view)).not.toMatch(FORBIDDEN);
  expect(view.valueCents).toBe(1500000);
  expect(view.installmentsCents).toEqual([500000, 500000, 500000]);
  expect(view.stages).toEqual([{ name: 'Start', days: 10 }, { name: 'Imersão', days: 50 }]);
});
