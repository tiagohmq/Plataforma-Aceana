import { z } from 'zod';

/** Formato que a IA devolve para o diagnóstico (F2.3 e F2.4). */
export const DiagnosisSchema = z.object({
  resumo: z.string(),
  itens: z.array(z.object({
    tipo: z.enum(['DOR', 'OBJETIVO', 'RESTRICAO']),
    texto: z.string(),
    trecho: z.string(),
  })),
  solucoes: z.array(z.object({
    codigo: z.string(),
    motivo: z.string(),
    trecho: z.string(),
  })),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

// A IA não define preço, desconto, prazo nem cláusula (M10): saída com isso é descartada e registrada.
const FORBIDDEN: { re: RegExp; motivo: string }[] = [
  { re: /R\$\s*\d|\b\d[\d.,]*\s*(mil|reais|k)\b|\breais\b/i, motivo: 'valor monetário' },
  { re: /\b\d+\s*(dias?|semanas?|meses|m[eê]s|anos?)\b/i, motivo: 'prazo' },
  { re: /\bdesconto\b/i, motivo: 'desconto' },
  { re: /\bcl[aá]usula/i, motivo: 'cláusula' },
];

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[“”"'‘’«»]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

export interface GuardResult {
  accepted: Diagnosis;
  discarded: { tipo: 'item' | 'solucao'; texto: string; motivo: string }[];
}

/** Valida a resposta da IA: formato, trecho de origem real, solução do catálogo e nada de preço/prazo/cláusula. */
export function guardDiagnosis(raw: unknown, transcript: string, catalogCodes: string[]): GuardResult {
  const parsed = DiagnosisSchema.safeParse(raw);
  if (!parsed.success) throw new Error('A resposta da IA veio fora do formato esperado.');
  const src = plain(transcript);
  const discarded: GuardResult['discarded'] = [];
  const forbidden = (s: string) => FORBIDDEN.find(f => f.re.test(s))?.motivo;
  const hasSource = (trecho: string) => !!plain(trecho) && src.includes(plain(trecho));

  const itens = parsed.data.itens.filter(i => {
    const bad = forbidden(i.texto);
    if (bad) { discarded.push({ tipo: 'item', texto: i.texto, motivo: `contém ${bad}` }); return false; }
    if (!hasSource(i.trecho)) { discarded.push({ tipo: 'item', texto: i.texto, motivo: 'trecho de origem não encontrado na transcrição' }); return false; }
    return true;
  });
  const solucoes = parsed.data.solucoes.filter(s => {
    if (!catalogCodes.includes(s.codigo)) { discarded.push({ tipo: 'solucao', texto: s.codigo, motivo: 'solução fora do catálogo' }); return false; }
    const bad = forbidden(s.motivo);
    if (bad) { discarded.push({ tipo: 'solucao', texto: s.codigo, motivo: `contém ${bad}` }); return false; }
    if (!hasSource(s.trecho)) { discarded.push({ tipo: 'solucao', texto: s.codigo, motivo: 'trecho de origem não encontrado na transcrição' }); return false; }
    return true;
  });
  const resumo = forbidden(parsed.data.resumo) ? '' : parsed.data.resumo;
  if (!resumo && parsed.data.resumo) discarded.push({ tipo: 'item', texto: 'resumo', motivo: 'contém valor, prazo ou cláusula' });
  return { accepted: { resumo, itens, solucoes }, discarded };
}
