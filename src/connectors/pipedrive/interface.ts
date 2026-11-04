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

/** O que foi aprovado na plataforma e vai para o negócio (decisão de 04/11: só estes campos são gravados). */
export interface ApprovedTerms {
  valueCents: number;
  installments: number;
  installmentsCents: number[];
  expectedOrg?: string; // trava: só grava se o negócio ainda é desta organização
  validUntil?: string; // vai na "Data de fechamento esperada" (dicionário de dados)
}

export interface PipedriveConnector {
  writeApproved(dealId: string, terms: ApprovedTerms): Promise<void>;
  getDeal(dealId: string): Promise<Deal>;
  listDeals(stage?: string): Promise<Deal[]>;
  updateDeal(dealId: string, fields: DealUpdate): Promise<void>;
  markWon(dealId: string, wonAt: string): Promise<void>;
}
