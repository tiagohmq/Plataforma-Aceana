export interface DriveConnector {
  /** Cria (ou devolve) a pasta do cliente. Estrutura de pastas: HIPÓTESE (F9.4). */
  ensureClientFolder(dealId: string, clientName: string): Promise<{ folderId: string; url: string }>;
}
