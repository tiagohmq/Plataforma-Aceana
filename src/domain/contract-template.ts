import { BusinessError } from '../http/errors.ts';

export interface ContractData {
  proposalId: string;
  solution: string;
  stages: { name: string; days: number }[];
  totalDays: number;
  valueCents: number;
  installmentsCents: number[];
  paymentMethod: string;
  client: { razaoSocial: string; cnpjCpf: string; endereco: string; cep: string; representanteNome: string; emailSignatario: string; emailFinanceiro: string } | null;
  ace: { signatory: string; signatoryTitle: string; witness: string };
  exclusoes: string[];
  reunioes: number;
  place: string;
  date: string; // YYYY-MM-DD
}

const brl = (cents: number): string =>
  'R$ ' + (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PAYMENT: Record<string, string> = { CARTAO: 'Cartão', BOLETO: 'Boleto', A_VISTA: 'À vista (PIX ou transferência)' };

/**
 * Preenche só as variáveis do Quadro Resumo (Anexo I) e do Anexo II; o corpo jurídico é fixo e não passa por aqui.
 * Campo vazio é bloqueio (F8.1). Dados pessoais do representante não entram no conteúdo gerado.
 */
export function renderContract(d: ContractData) {
  if (!d.client) throw new BusinessError('CAMPO_VAZIO:contratante', 'O cliente ainda não preencheu o formulário do contrato.');
  const quadroResumo: Record<string, string> = {
    contratante: d.client.razaoSocial,
    cnpjCpf: d.client.cnpjCpf,
    endereco: d.client.endereco,
    cep: d.client.cep,
    representante: d.client.representanteNome,
    emailSignatario: d.client.emailSignatario,
    emailFinanceiro: d.client.emailFinanceiro,
    signatarioAce: `${d.ace.signatory} (${d.ace.signatoryTitle})`,
    objeto: d.solution,
    prazoPorEtapa: d.stages.map(s => `${s.name}: ${s.days} dias úteis`).join('; '),
    prazoTotal: `${d.totalDays} dias úteis`,
    valorTotal: brl(d.valueCents),
    parcelas: d.installmentsCents.map((c, i) => `${i + 1}ª ${brl(c)}`).join('; '),
    formaPagamento: PAYMENT[d.paymentMethod] ?? d.paymentMethod,
    inicio: 'Até 4 dias úteis após a assinatura',
    clausula22: d.proposalId,
    encerramento: `${d.place}, ${d.date.split('-').reverse().join('/')}`,
    testemunhas: d.ace.witness,
  };
  const anexoII = {
    objeto: d.solution,
    entregaveis: d.stages.map(s => s.name).join('; '),
    etapas: d.stages.map(s => `${s.name} (${s.days} dias úteis)`).join('; '),
    exclusoes: d.exclusoes.join('; '),
    reunioes: String(d.reunioes),
  };
  for (const [k, v] of [...Object.entries(quadroResumo), ...Object.entries(anexoII)]) {
    if (!v || !String(v).trim()) throw new BusinessError(`CAMPO_VAZIO:${k}`, `Campo do contrato vazio: ${k}.`);
  }
  return { quadroResumo, anexoII };
}
