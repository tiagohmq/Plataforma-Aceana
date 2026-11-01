/** Conferência automática antes do envio (F8.2): proposta × contrato × deal. Meta: zero divergências. */
export function checkConsistency(x: {
  proposal: { id: string; valueCents: number; installmentsCents: number[]; days: number };
  contract: { proposalId: string; valueCents: number; installmentsCents: number[]; days: number };
  deal: { valueCents: number | undefined };
}): { ok: boolean; divergences: string[] } {
  const d: string[] = [];
  if (x.contract.proposalId !== x.proposal.id) d.push('ID da proposta');
  if (x.contract.valueCents !== x.proposal.valueCents) d.push('valor (proposta × contrato)');
  if (x.deal.valueCents !== x.proposal.valueCents) d.push('valor (proposta × Pipedrive)');
  if (JSON.stringify(x.contract.installmentsCents) !== JSON.stringify(x.proposal.installmentsCents)) d.push('parcelas');
  if (x.contract.days !== x.proposal.days) d.push('prazo');
  return { ok: d.length === 0, divergences: d };
}
