import type { DiagnosisAI } from './interface.ts';

/**
 * Análise sem IA (decisão de 02/11: ainda não há chave da Anthropic). Mesmo contrato da IA, então passa pela mesma trava.
 * - Itens: frases do cliente com marcas de dor, objetivo ou restrição; o texto e o trecho são a própria frase.
 * - Soluções: nome da solução do catálogo ou um dos sinônimos abaixo citado na transcrição ou na pré-auditoria.
 * Os sinônimos são HIPÓTESE do time; ajustar aqui conforme o uso.
 */
const SYNONYMS: Record<string, string[]> = {
  'SOL-004': ['concorrente', 'concorrentes', 'concorrencia'],
  'SOL-005': ['valuation', 'quanto vale a empresa'],
  'SOL-006': ['bpo', 'terceirizar o financeiro'],
  'SOL-007': ['contratar', 'contratacao', 'recrutamento', 'selecao', 'vaga', 'vagas'],
  'SOL-010': ['planejamento estrategico', 'estrategia', 'metas da empresa'],
  'SOL-011': ['processo', 'processos', 'procedimento', 'passo a passo'],
  'SOL-013': ['plano de negocio', 'plano de negocios', 'abrir uma filial', 'novo negocio'],
  'SOL-015': ['pesquisa de mercado', 'publico-alvo', 'publico alvo', 'perfil do cliente'],
  'SOL-016': ['experiencia do cliente', 'atendimento ao cliente'],
  'SOL-017': ['fluxo de caixa', 'caixa', 'financeiro', 'quanto sobra', 'contas a pagar', 'dre', 'controle financeiro'],
  'SOL-018': ['custo', 'custos', 'gastos'],
  'SOL-019': ['preco', 'precos', 'precificar', 'precificacao', 'margem'],
  'SOL-020': ['comercial', 'vendas', 'vendedor', 'vendedores', 'funil', 'prospeccao'],
  'SOL-021': ['marketing', 'instagram', 'redes sociais', 'divulgacao', 'marca'],
  'SOL-022': ['planejamento comercial', 'meta de vendas', 'metas de vendas'],
  'SOL-023': ['estoque'],
  'SOL-024': ['tempo de producao', 'cronoanalise', 'produtividade'],
  'SOL-025': ['cargos', 'carreira', 'salario', 'salarios'],
  'SOL-026': ['viabilidade', 'vale a pena investir'],
  'SOL-027': ['retrabalho', 'gargalo', 'gargalos', 'otimizar'],
  'SOL-028': ['sistema', 'software', 'erp'],
  'SOL-031': ['pos-venda', 'pos venda', 'retencao', 'cancelamento', 'churn'],
};

const KINDS: { tipo: 'RESTRICAO' | 'DOR' | 'OBJETIVO'; re: RegExp }[] = [
  { tipo: 'RESTRICAO', re: /\b(nao (pode|podemos|da para)|so (temos|tenho)|pouco tempo|sem tempo|sem equipe|orcamento (curto|apertado|limitado)|limite)\b/ },
  { tipo: 'DOR', re: /\b(nao (sei|sabemos|temos|tenho|consigo|conseguimos|funciona)|falta|problema|dificuldade|perd(a|emos|endo)|desorganizad[oa]|bagunca|ninguem sabe|no olho)\b/ },
  { tipo: 'OBJETIVO', re: /\b(quero|queremos|preciso|precisamos|gostaria|objetivo|meta|melhorar|organizar|aumentar|crescer|estruturar)\b/ },
];

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const has = (text: string, term: string) => new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text);

/** Frases literais (sem o rótulo de quem fala). Se a transcrição marca "Cliente:", usa só as falas do cliente. */
function sentences(transcript: string): string[] {
  const lines = transcript.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const client = lines.filter(l => /^cliente\s*:/i.test(l));
  return (client.length ? client : lines)
    .map(l => l.replace(/^[^:]{1,30}:\s*/, ''))
    .flatMap(l => l.split(/(?<=[.!?])\s+/))
    .map(s => s.trim())
    .filter(s => s.length >= 8);
}

export function keywordDiagnosis(): DiagnosisAI {
  return async input => {
    const pool = [...sentences(input.transcript), ...(input.preAudit ? sentences(input.preAudit) : [])];

    const itens = pool.flatMap(s => {
      const k = KINDS.find(x => x.re.test(plain(s)));
      return k ? [{ tipo: k.tipo, texto: s, trecho: s }] : [];
    }).slice(0, 10);

    const scored = input.catalog.map(c => {
      const terms = [plain(c.name), ...(SYNONYMS[c.code] ?? [])];
      const hits = terms.filter(t => pool.some(s => has(plain(s), t)));
      const first = pool.find(s => hits.some(t => has(plain(s), t)));
      return { c, hits, first };
    }).filter(x => x.hits.length && x.first)
      .sort((a, b) => b.hits.length - a.hits.length)
      .slice(0, 3);

    const solucoes = scored.map(x => ({ codigo: x.c.code, motivo: `Citado na conversa: ${x.hits.slice(0, 4).join(', ')}`, trecho: x.first! }));
    const resumo = itens.length || solucoes.length
      ? `Análise por palavras-chave (sem IA): ${itens.length} pontos do cliente e ${solucoes.length} soluções citadas. Revise antes de usar.`
      : 'Análise por palavras-chave (sem IA): nada reconhecido. Preencha o diagnóstico manualmente.';
    return { model: 'sem IA (palavras-chave)', output: { resumo, itens, solucoes } };
  };
}
