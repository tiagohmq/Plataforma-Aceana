import { describe, it, expect } from 'vitest';
import { keywordDiagnosis } from '../src/connectors/ai/keywords.ts';
import { guardDiagnosis, type Diagnosis } from '../src/domain/ai-guard.ts';
import { CATALOG_FIXTURE } from './catalog-fixture.ts';

const TRANSCRIPT = `Consultor: Como funciona o financeiro hoje?
Cliente: Eu não sei quanto sobra no fim do mês, o caixa é uma bagunça.
Cliente: Quero organizar o fluxo de caixa e entender meus custos.
Consultor: E o preço dos produtos?
Cliente: A gente define o preço no olho, não temos margem calculada.
Cliente: Não podemos parar a loja para treinamento.
Cliente: Pagamos uns 2 mil por mês de aluguel.`;

const run = async (transcript = TRANSCRIPT, preAudit?: string) => {
  const ai = keywordDiagnosis();
  const out = await ai({ transcript, preAudit, catalog: CATALOG_FIXTURE });
  return { out, g: guardDiagnosis(out.output, transcript + '\n' + (preAudit ?? ''), CATALOG_FIXTURE.map(c => c.code)) };
};

describe('análise sem IA (palavras-chave)', () => {
  it('sugere soluções do catálogo pelo que foi dito, com trecho literal', async () => {
    const { out, g } = await run();
    expect(out.model).toMatch(/sem IA/);
    const codes = g.accepted.solucoes.map(s => s.codigo);
    expect(codes[0]).toBe('SOL-017');
    expect(codes).toContain('SOL-019');
    for (const s of g.accepted.solucoes) expect(TRANSCRIPT).toContain(s.trecho);
  });

  it('classifica dores, objetivos e restrições pelas frases do cliente', async () => {
    const { g } = await run();
    const by = (t: string) => g.accepted.itens.filter(i => i.tipo === t).map(i => i.texto);
    expect(by('DOR').some(t => t.includes('não sei quanto sobra'))).toBe(true);
    expect(by('OBJETIVO').some(t => t.includes('organizar o fluxo de caixa'))).toBe(true);
    expect(by('RESTRICAO').some(t => t.includes('Não podemos parar'))).toBe(true);
  });

  it('frase com valor em dinheiro é barrada pela trava, não vira item', async () => {
    const { g } = await run();
    expect(g.accepted.itens.some(i => i.texto.includes('2 mil'))).toBe(false);
  });

  it('usa a pré-auditoria do Pipedrive como fonte também', async () => {
    const { g } = await run('Cliente: tudo certo por aqui.', 'Lead quer estruturar o setor comercial e aumentar as vendas.');
    expect(g.accepted.solucoes.map(s => s.codigo)).toContain('SOL-020');
  });

  it('nada reconhecível → listas vazias, sem inventar', async () => {
    const { g } = await run('Consultor: bom dia. Cliente: bom dia.');
    expect(g.accepted.itens).toEqual([]);
    expect(g.accepted.solucoes).toEqual([]);
  });

  it('saída tem o formato do diagnóstico', async () => {
    const { out } = await run();
    const d = out.output as Diagnosis;
    expect(typeof d.resumo).toBe('string');
    expect(Array.isArray(d.itens) && Array.isArray(d.solucoes)).toBe(true);
  });
});
