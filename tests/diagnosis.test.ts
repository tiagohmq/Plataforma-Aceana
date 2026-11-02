import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db/client.ts';
import { freshDb } from './helpers.ts';
import { seedAll } from '../src/db/seed.ts';
import { buildApp } from '../src/http/app.ts';
import { createConnectors } from '../src/connectors/index.ts';
import type { DiagnosisAI, DiagnosisInput } from '../src/connectors/ai/interface.ts';
import { claudeDiagnosis } from '../src/connectors/ai/claude.ts';
import { TEST_SECRETS } from './app-helper.ts';
import { api, as } from './fixtures.ts';

const TRANSCRIPT = 'Consultor: como está hoje?\nCliente: não sei quanto sobra no fim do mês. Meu CPF é 529.982.247-25.\nCliente: quero organizar o fluxo de caixa e a precificação.';

let app: FastifyInstance;
let db: Db;
let seen: DiagnosisInput[];
const fakeAI: DiagnosisAI = async input => {
  seen.push(input);
  return {
    model: 'falso',
    output: {
      resumo: 'Mercearia sem controle de caixa.',
      itens: [
        { tipo: 'DOR', texto: 'Não sabe o resultado do mês', trecho: 'não sei quanto sobra no fim do mês' },
        { tipo: 'OBJETIVO', texto: 'Cobrar R$ 5.000', trecho: 'quero organizar o fluxo de caixa' },
      ],
      solucoes: [
        { codigo: 'SOL-017', motivo: 'Organizar caixa', trecho: 'quero organizar o fluxo de caixa' },
        { codigo: 'SOL-999', motivo: 'Inventada', trecho: 'precificação' },
      ],
    },
  };
};

async function setup(ai?: DiagnosisAI) {
  db = await freshDb();
  await seedAll(db);
  seen = [];
  app = await buildApp({ db, connectors: createConnectors({}), secrets: TEST_SECRETS, ai });
}

describe('diagnóstico a partir da transcrição', () => {
  beforeEach(async () => setup(fakeAI));

  it('analisa, remove dados pessoais antes da IA e aplica a trava', async () => {
    const p = (await api(app).importDeal()).json();
    const r = await app.inject({ method: 'POST', url: `/api/proposals/${p.id}/diagnosis`, headers: as('larissa'), payload: { transcript: TRANSCRIPT } });
    expect(r.statusCode, r.body).toBe(201);
    const d = r.json();
    expect(seen[0].transcript).not.toContain('529.982.247-25');
    expect(seen[0].catalog.some(c => c.code === 'SOL-017')).toBe(true);
    expect(d.itens.map((i: { texto: string }) => i.texto)).toEqual(['Não sabe o resultado do mês']);
    expect(d.solucoes.map((s: { codigo: string; nome: string }) => [s.codigo, s.nome])).toEqual([['SOL-017', 'Estruturação Financeira']]);
    expect(d.descartados).toHaveLength(2);
  });

  it('guarda transcrição sem dados pessoais, auditoria e reabre a última análise', async () => {
    const p = (await api(app).importDeal()).json();
    await app.inject({ method: 'POST', url: `/api/proposals/${p.id}/diagnosis`, headers: as('larissa'), payload: { transcript: TRANSCRIPT } });
    const dump = JSON.stringify((await db.query('select * from transcripts')).rows);
    expect(dump).not.toContain('529.982.247-25');
    const g = await app.inject({ method: 'GET', url: `/api/proposals/${p.id}/diagnosis`, headers: as('clara') });
    expect(g.statusCode).toBe(200);
    expect(g.json().solucoes[0].codigo).toBe('SOL-017');
    const au = await db.query<{ n: number }>("select count(*)::int as n from audit_events where action = 'diagnosis.analyze'");
    expect(au.rows[0].n).toBe(1);
  });

  it('GP não analisa; transcrição vazia → 400', async () => {
    const p = (await api(app).importDeal()).json();
    expect((await app.inject({ method: 'POST', url: `/api/proposals/${p.id}/diagnosis`, headers: as('clara'), payload: { transcript: TRANSCRIPT } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/proposals/${p.id}/diagnosis`, headers: as('larissa'), payload: { transcript: '  ' } })).statusCode).toBe(400);
  });

  it('sem IA configurada → 409 com mensagem clara', async () => {
    await setup(undefined);
    const p = (await api(app).importDeal()).json();
    const r = await app.inject({ method: 'POST', url: `/api/proposals/${p.id}/diagnosis`, headers: as('larissa'), payload: { transcript: TRANSCRIPT } });
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('IA_NAO_CONFIGURADA');
  });
});

describe('importação respeita a ordem dos serviços do Pipedrive', () => {
  it('usa o primeiro serviço do deal que existe no catálogo', async () => {
    db = await freshDb();
    await seedAll(db);
    const connectors = createConnectors({});
    const mock = connectors.pipedrive as unknown as { deals: Map<string, { services: string[] }> };
    mock.deals.get('2018')!.services = ['Plano de Marketing', 'Estruturação Financeira'];
    app = await buildApp({ db, connectors, secrets: TEST_SECRETS });
    const p = (await api(app).importDeal('2018')).json();
    expect(p.currentVersion.input.scope.solutionCode).toBe('SOL-021');
  });
});

describe('cliente do Claude', () => {
  it('chama Opus 5.5 com fallback, saída estruturada e recusa tratada', async () => {
    const calls: Record<string, unknown>[] = [];
    const fake = { beta: { messages: { create: async (params: Record<string, unknown>) => {
      calls.push(params);
      return { stop_reason: 'end_turn', model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"resumo":"r","itens":[],"solucoes":[]}' }] };
    } } } };
    const ai = claudeDiagnosis(fake as never);
    const out = await ai({ transcript: 'texto', catalog: [{ code: 'SOL-017', name: 'Estruturação Financeira', front: 'Financeiro' }] });
    expect(out.output).toEqual({ resumo: 'r', itens: [], solucoes: [] });
    expect(calls[0].model).toBe('claude-opus-5-5');
    expect(calls[0].fallbacks).toBe('default');
    expect(calls[0].betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(JSON.stringify(calls[0].messages)).toContain('SOL-017');
  });

  it('recusa vira erro legível', async () => {
    const fake = { beta: { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } } };
    await expect(claudeDiagnosis(fake as never)({ transcript: 'x', catalog: [] })).rejects.toThrow(/recusou/);
  });
});
