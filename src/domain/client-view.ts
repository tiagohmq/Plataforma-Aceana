import type { VersionInput, VersionResult } from '../modules/proposals.ts';

export interface ClientProposal {
  proposalId: string;
  client: string;
  contact: string | null;
  solution: string;
  stages: { name: string; days: number }[];
  extras: { name: string; days: number }[];
  totalDays: number;
  valueCents: number;
  installments: number;
  installmentsCents: number[];
  validUntil: string | null;
}

/**
 * Filtro de saída da proposta para o cliente: monta um objeto novo só com o que pode sair.
 * Margem, custos, piso, preço calculado e parâmetros nunca entram (spec §8, item 4).
 */
export function toClientView(src: {
  proposalId: string; client: string; contact: string | null; solutionName: string;
  input: VersionInput; result: VersionResult; validUntil: string | null;
}): ClientProposal {
  return {
    proposalId: src.proposalId,
    client: src.client,
    contact: src.contact,
    solution: src.solutionName,
    stages: src.input.scope.stages.map(s => ({ name: s.name, days: s.days })),
    extras: src.input.scope.extra.map(e => ({ name: e.name, days: e.days })),
    totalDays: src.result.days,
    valueCents: src.result.valueCents,
    installments: src.result.installments,
    installmentsCents: [...src.result.installmentsCents],
    validUntil: src.validUntil,
  };
}
