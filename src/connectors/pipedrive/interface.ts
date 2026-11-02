export interface Deal {
  id: string;
  title: string;
  org: string;
  contact: string;
  contactEmail?: string;
  services: string[]; // "Serviço(s) demandado(s)"
  front?: string;
  stage: string;
  value?: number; // em centavos
  status?: 'open' | 'won' | 'lost';
  wonAt?: string;
  pipeline?: string;
  details?: { preAudit?: string; urgency?: string; budget?: string; needsApproval?: string };
}

/** Campos que a plataforma grava no deal (decisão de 31/10: etapa, valor, link, validade, margem, semáforo, aprovação, assinatura). */
export interface DealUpdate {
  stage?: string;
  valueCents?: number;
  proposalLink?: string;
  validUntil?: string;
  approvalStatus?: string;
  signatureStatus?: string;
  proposalId?: string;
}

export interface PipedriveConnector {
  getDeal(dealId: string): Promise<Deal>;
  listDeals(stage?: string): Promise<Deal[]>;
  updateDeal(dealId: string, fields: DealUpdate): Promise<void>;
  markWon(dealId: string, wonAt: string): Promise<void>;
}
