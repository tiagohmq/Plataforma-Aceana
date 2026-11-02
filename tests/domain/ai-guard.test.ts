import { describe, it, expect } from 'vitest';
import { redactPersonalData } from '../../src/domain/redact.ts';
import { guardDiagnosis } from '../../src/domain/ai-guard.ts';

describe('remoção de dados pessoais antes da IA', () => {
  it('remove CPF, CNPJ, RG, e-mail e telefone', () => {
    const t = 'Meu CPF é 529.982.247-25, RG 1234567, CNPJ 11.222.333/0001-81, e-mail rita@empresa.com, fone (81) 99876-5432 ou 81998765432.';
    const r = redactPersonalData(t);
    for (const s of ['529.982.247-25', '1234567', '11.222.333/0001-81', 'rita@empresa.com', '99876-5432', '81998765432']) expect(r).not.toContain(s);
    expect(r).toContain('[removido]');
    expect(r).toContain('Meu CPF é');
  });

  it('mantém o resto do texto', () => {
    expect(redactPersonalData('O caixa está desorganizado desde 2024.')).toBe('O caixa está desorganizado desde 2024.');
  });
});

describe('trava da saída da IA (M10)', () => {
  const transcript = 'Cliente: não sei quanto sobra no fim do mês. Quero organizar o fluxo de caixa. Não tenho sistema.';
  const catalog = ['SOL-017', 'SOL-020'];

  it('aceita itens com trecho real e soluções do catálogo', () => {
    const g = guardDiagnosis({
      resumo: 'Empresa sem controle de caixa.',
      itens: [{ tipo: 'DOR', texto: 'Não sabe o resultado do mês', trecho: 'não sei quanto sobra no fim do mês' }],
      solucoes: [{ codigo: 'SOL-017', motivo: 'Organizar o fluxo de caixa', trecho: 'Quero organizar o fluxo de caixa' }],
    }, transcript, catalog);
    expect(g.accepted.itens).toHaveLength(1);
    expect(g.accepted.solucoes.map(s => s.codigo)).toEqual(['SOL-017']);
    expect(g.discarded).toEqual([]);
  });

  it('descarta solução fora do catálogo', () => {
    const g = guardDiagnosis({ resumo: '', itens: [], solucoes: [{ codigo: 'SOL-999', motivo: 'x', trecho: 'Não tenho sistema' }] }, transcript, catalog);
    expect(g.accepted.solucoes).toEqual([]);
    expect(g.discarded[0].motivo).toMatch(/catálogo/);
  });

  it('descarta item cujo trecho não está na transcrição', () => {
    const g = guardDiagnosis({ resumo: '', itens: [{ tipo: 'OBJETIVO', texto: 'Crescer 50%', trecho: 'queremos dobrar' }], solucoes: [] }, transcript, catalog);
    expect(g.accepted.itens).toEqual([]);
    expect(g.discarded[0].motivo).toMatch(/trecho/);
  });

  it.each([
    ['valor em reais', 'Proposta de R$ 15.000'],
    ['valor por extenso', 'Custaria uns 10 mil reais'],
    ['prazo', 'Entregar em 30 dias'],
    ['desconto', 'Dar 10% de desconto'],
    ['cláusula', 'Incluir cláusula de multa'],
  ])('descarta saída com %s', (_n, texto) => {
    const g = guardDiagnosis({ resumo: '', itens: [{ tipo: 'OBJETIVO', texto, trecho: 'Quero organizar o fluxo de caixa' }], solucoes: [] }, transcript, catalog);
    expect(g.accepted.itens).toEqual([]);
    expect(g.discarded).toHaveLength(1);
  });

  it('trecho comparado sem diferença de espaços, maiúsculas e aspas', () => {
    const g = guardDiagnosis({ resumo: '', itens: [{ tipo: 'DOR', texto: 'Sem sistema', trecho: '“não   tenho SISTEMA”' }], solucoes: [] }, transcript, catalog);
    expect(g.accepted.itens).toHaveLength(1);
  });
});
