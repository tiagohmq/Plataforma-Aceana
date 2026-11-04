import type { ApprovedTerms, Deal, DealUpdate, PipedriveConnector } from './interface.ts';
import { NotFoundError } from '../../http/errors.ts';

// Deals fictícios do protótipo v14, na etapa "Diagnóstico realizado".
const SEED: Deal[] = [
  { id: '2018', title: 'Mercearia Sol Nascente', org: 'Mercearia Sol Nascente', contact: 'Rita Alencar', contactEmail: 'rita@solnascente.exemplo.com', services: ['Estruturação Financeira'], front: 'Financeiro', stage: 'Diagnóstico realizado', value: 900000, status: 'open' },
  { id: '2019', title: 'Academia Corpo em Forma', org: 'Academia Corpo em Forma', contact: 'Marcos Dias', contactEmail: 'marcos@corpoemforma.exemplo.com', services: ['Estruturação comercial'], front: 'Marketing e Vendas', stage: 'Diagnóstico realizado', value: 1400000, status: 'open' },
  { id: '2020', title: 'Doceria Casa Doce', org: 'Doceria Casa Doce', contact: 'Elisa Prado', contactEmail: 'elisa@casadoce.exemplo.com', services: ['Plano de Marketing'], front: 'Marketing e Vendas', stage: 'Diagnóstico realizado', value: 620000, status: 'open' },
];

/** Pipedrive simulado: estado em memória por instância; failNext força falhas para testar a fila. */
export class PipedriveMock implements PipedriveConnector {
  deals = new Map(SEED.map(d => [d.id, { ...d }]));
  updates: { dealId: string; fields: DealUpdate }[] = [];
  failNext = 0;

  private maybeFail(): void {
    if (this.failNext > 0) { this.failNext--; throw new Error('Pipedrive simulado: falha forçada'); }
  }
  async getDeal(dealId: string): Promise<Deal> {
    const d = this.deals.get(dealId);
    if (!d) throw new NotFoundError(`Deal ${dealId} não encontrado no Pipedrive.`);
    return { ...d };
  }
  async listDeals(stage?: string): Promise<Deal[]> {
    return [...this.deals.values()].filter(d => !stage || d.stage === stage).map(d => ({ ...d }));
  }
  async updateDeal(dealId: string, fields: DealUpdate): Promise<void> {
    this.maybeFail();
    const d = await this.getDeal(dealId);
    this.deals.set(dealId, { ...d, ...(fields.stage ? { stage: fields.stage } : {}), ...(fields.valueCents ? { value: fields.valueCents } : {}) });
    this.updates.push({ dealId, fields });
  }
  approvedWrites: ({ dealId: string } & ApprovedTerms)[] = [];
  async writeApproved(dealId: string, terms: ApprovedTerms): Promise<void> {
    this.maybeFail();
    await this.getDeal(dealId);
    this.approvedWrites.push({ dealId, ...terms });
  }
  async markWon(dealId: string, wonAt: string): Promise<void> {
    this.maybeFail();
    const d = await this.getDeal(dealId);
    this.deals.set(dealId, { ...d, status: 'won', wonAt, stage: 'Ganho' });
  }
}
