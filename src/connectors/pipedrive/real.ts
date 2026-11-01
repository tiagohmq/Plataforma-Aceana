import type { PipedriveConnector } from './interface.ts';

/** Esqueleto do conector real (API v2 + webhooks). Implementar com token somente leitura/escrita do deal. */
export class PipedriveReal implements PipedriveConnector {
  private fail(): never { throw new Error('conector real não configurado: Pipedrive'); }
  async getDeal(): Promise<never> { this.fail(); }
  async listDeals(): Promise<never> { this.fail(); }
  async updateDeal(): Promise<never> { this.fail(); }
  async markWon(): Promise<never> { this.fail(); }
}
