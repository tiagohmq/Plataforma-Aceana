import type { MondayConnector } from './interface.ts';

/** Esqueleto: create_item via GraphQL com Idempotency-Key (vale 30 min) e conta de serviço da A.C.E. */
export class MondayReal implements MondayConnector {
  async createProject(): Promise<never> { throw new Error('conector real não configurado: Monday'); }
}
