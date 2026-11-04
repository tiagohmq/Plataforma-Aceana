import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db/client.ts';
import { parsePricingSheet } from '../src/domain/pricing-sheet.ts';
import { testApp } from './app-helper.ts';
import { api, as } from './fixtures.ts';
import { buildPricingSheet } from './sheet-fixture.ts';

describe('leitura da planilha de precificação', () => {
  it('lê projeto, etapas, atividades, multiplicadores e custos', async () => {
    const s = await parsePricingSheet(await buildPricingSheet());
    expect(s.solutionName).toBe('Plano de Negócios');
    expect(s.project).toBe('Plano de Negócios – Clínica Exemplo');
    expect(s.managers).toBe(1);
    expect(s.stages.map(x => [x.name, x.consultants, x.days, x.activities.length])).toEqual([
      ['Start · Ambientação', 2, 4, 2], ['Imersão e Análise · Pesquisa', 3, 6, 2],
    ]);
    expect(s.stages[0].activities[0]).toEqual({ name: 'Estudos Iniciais', description: 'O que entrega: base de conhecimento do segmento.', days: 3, dod: 'Documento consolidado.' });
    expect(s.pricing).toEqual({ size: 'EPP', payment: 'BOLETO', channel: 'INBOUND', modality: 'HIBRIDO', discount: 'NENHUM', outsourcing: 'MEJ' });
    expect(s.externalCostsCents).toBe(996000);
    expect(s.sheetPriceCents).toBe(1254960);
    expect(s.diagnosis.objetivo).toBe('Decidir com base em dados se e como abrir a clínica.');
  });

  it('avisa quando a soma das atividades não bate com os dias da etapa', async () => {
    const s = await parsePricingSheet(await buildPricingSheet({ stageDays: 7 }));
    expect(s.warnings.some(w => w.includes('Start · Ambientação') && w.includes('7'))).toBe(true);
  });

  it('avisa #REF! no preço da planilha', async () => {
    const s = await parsePricingSheet(await buildPricingSheet({ withRef: true }));
    expect(s.warnings.some(w => w.includes('#REF!'))).toBe(true);
  });

  it('arquivo que não é planilha de precificação → erro claro', async () => {
    await expect(parsePricingSheet(Buffer.from('não sou xlsx'))).rejects.toThrow(/planilha/);
  });
});

describe('importação na proposta', () => {
  let app: FastifyInstance;
  let db: Db;
  beforeEach(async () => ({ app, db } = await testApp()));
  const upload = async (id: string, file: Buffer, expected = 1, user = 'larissa') =>
    app.inject({ method: 'POST', url: `/api/proposals/${id}/import-spreadsheet`, headers: as(user), payload: { fileBase64: file.toString('base64'), expectedCurrentNumber: expected } });

  it('cria versão com as atividades da planilha e preço do motor', async () => {
    const p = (await api(app).importDeal()).json();
    const r = await upload(p.id, await buildPricingSheet());
    expect(r.statusCode, r.body).toBe(201);
    const v = r.json().proposal.currentVersion;
    expect(v.number).toBe(2);
    expect(v.input.source).toBe('planilha');
    expect(v.input.scope.solutionCode).toBe('SOL-013');
    expect(v.input.scope.stages.map((s: { name: string; group: string; days: number; consultants: number }) => [s.group, s.name, s.days, s.consultants])).toEqual([
      ['Start · Ambientação', 'Estudos Iniciais', 3, 2], ['Start · Ambientação', 'Reunião de Onboarding', 1, 2],
      ['Imersão e Análise · Pesquisa', 'Relatório de Mercado', 4, 3], ['Imersão e Análise · Pesquisa', 'Reunião Parcial de Validação 1', 2, 3],
    ]);
    expect(v.input.externalCostsCents).toBe(996000);
    expect(v.input.pricing.outsourcing).toBe('MEJ');
    expect(v.result.days).toBe(10);
    expect(v.result.calculated.finalCents).toBeGreaterThan(0);
    expect(r.json().sheetPriceCents).toBe(1254960);
  });

  it('dores e objetivo viram o diagnóstico, sem dados pessoais', async () => {
    const p = (await api(app).importDeal()).json();
    await upload(p.id, await buildPricingSheet());
    const d = (await app.inject({ method: 'GET', url: `/api/proposals/${p.id}/diagnosis`, headers: as('larissa') })).json();
    expect(d.model).toMatch(/planilha/);
    expect(d.itens.map((i: { tipo: string }) => i.tipo)).toEqual(['DOR', 'OBJETIVO', 'OBJETIVO']);
    expect(d.solucoes[0].codigo).toBe('SOL-013');
    const dump = JSON.stringify((await db.query('select * from transcripts')).rows);
    expect(dump).not.toContain('529.982.247-25');
    expect(dump).not.toContain('dona@exemplo.com');
  });

  it('solução fora do catálogo → 409', async () => {
    const p = (await api(app).importDeal()).json();
    const r = await upload(p.id, await buildPricingSheet({ solution: 'Consultoria Mágica' }));
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('SOLUCAO_FORA_DO_CATALOGO');
  });

  it('mais de um gerente vira 1 com aviso', async () => {
    const p = (await api(app).importDeal()).json();
    const r = await upload(p.id, await buildPricingSheet({ managers: 2 }));
    expect(r.json().proposal.currentVersion.input.managers).toBe(1);
    expect(r.json().warnings.some((w: string) => w.includes('gerente'))).toBe(true);
  });

  it('GP não importa; versão desatualizada → 409', async () => {
    const p = (await api(app).importDeal()).json();
    const f = await buildPricingSheet();
    expect((await upload(p.id, f, 1, 'clara')).statusCode).toBe(403);
    expect((await upload(p.id, f, 5)).json().codigo).toBe('VERSAO_DESATUALIZADA');
  });
});
