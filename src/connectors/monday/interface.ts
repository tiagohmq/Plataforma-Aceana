/** Colunas do board "Status de Projetos | ACEANO v2" que a passagem preenche (dicionário §6; mapeamento final PENDENTE). */
export interface ProjectInput {
  dealId: string;
  name: string;
  valueCents: number;
  days: number;
  allocated: number; // consultores, sem o GP
  front: string;
  wonAt: string;
  handoffUrl: string;
}

export interface MondayConnector {
  /** Cria o item com status "Fechado e não iniciado". Não há upsert no Monday: a unicidade vem de external_links. */
  createProject(input: ProjectInput): Promise<{ itemId: string }>;
}
