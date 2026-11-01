import type { DriveConnector } from './interface.ts';

/** Esqueleto: Google Drive API com conta de serviço da A.C.E. (documentação ainda não conferida). */
export class DriveReal implements DriveConnector {
  async ensureClientFolder(): Promise<never> { throw new Error('conector real não configurado: Drive'); }
}
