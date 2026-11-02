/** Entrada já sem dados pessoais. O catálogo limita o que a IA pode sugerir. */
export interface DiagnosisInput {
  transcript: string;
  preAudit?: string;
  catalog: { code: string; name: string; front: string }[];
}

/** Assistente de diagnóstico (M10). Devolve a saída bruta; a trava (domain/ai-guard) decide o que vale. */
export type DiagnosisAI = (input: DiagnosisInput) => Promise<{ model: string; output: unknown }>;
