import { describe, it, expect } from 'vitest';
import { PipedriveReal } from '../src/connectors/pipedrive/real.ts';

// Respostas no formato da API v1 do Pipedrive (dados fictícios).
const FIELDS = [
  { key: 'a'.repeat(40), name: 'Serviço(s) demandado(s)', field_type: 'set', options: [{ id: 10, label: 'Estruturação Financeira' }, { id: 11, label: 'Plano de Marketing' }] },
  { key: 'b'.repeat(40), name: 'Serviço(s) demandado(s)', field_type: 'varchar' },
  { key: 'c'.repeat(40), name: 'Frente(s) de atuação', field_type: 'set', options: [{ id: 20, label: 'Financeiro' }] },
  { key: 'd'.repeat(40), name: 'Pré-auditoria ', field_type: 'text' },
  { key: 'e'.repeat(40), name: 'Urgência validada', field_type: 'set', options: [{ id: 30, label: 'Alta' }] },
  { key: 'f'.repeat(40), name: 'Budget validado', field_type: 'set', options: [{ id: 40, label: 'Sim' }] },
  { key: 'g'.repeat(40), name: 'Necessita de aprovação', field_type: 'enum', options: [{ id: 50, label: 'Não' }] },
];
const STAGES = [
  { id: 66, name: 'Diagnóstico realizado', pipeline_id: 11 },
  { id: 67, name: 'Proposta apresentada', pipeline_id: 11 },
  { id: 33, name: 'Diagnóstico realizado', pipeline_id: 4 },
];
const PIPELINES = [{ id: 11, name: 'Vendas Inbound' }, { id: 4, name: 'Vendas Outbound' }];
const deal = (id: number, stage: number) => ({
  id, title: `Negócio ${id}`, value: 12500.5, status: 'open', stage_id: stage, pipeline_id: stage === 33 ? 4 : 11,
  org_name: `Empresa ${id}`, person_name: `Contato ${id}`,
  person_id: { name: `Contato ${id}`, email: [{ value: `c${id}@exemplo.com`, primary: true }] },
  ['a'.repeat(40)]: '10,11', ['c'.repeat(40)]: '20', ['d'.repeat(40)]: 'Caixa desorganizado',
  ['e'.repeat(40)]: '30', ['f'.repeat(40)]: '40', ['g'.repeat(40)]: '50',
});

function fakeFetch() {
  const calls: { url: string; headers: Record<string, string>; method: string }[] = [];
  const fn = async (url: string, init?: { headers?: Record<string, string>; method?: string }) => {
    calls.push({ url, headers: init?.headers ?? {}, method: init?.method ?? 'GET' });
    const u = new URL(url);
    const body = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ success: true, data }) });
    if (u.pathname.endsWith('/dealFields')) return body(FIELDS);
    if (u.pathname.endsWith('/stages')) return body(STAGES);
    if (u.pathname.endsWith('/pipelines')) return body(PIPELINES);
    if (u.pathname.endsWith('/deals')) {
      const s = Number(u.searchParams.get('stage_id'));
      return body(s === 66 ? [deal(1, 66), deal(2, 66)] : s === 33 ? [deal(3, 33)] : []);
    }
    const m = u.pathname.match(/\/deals\/(\d+)$/);
    if (m) return body(deal(Number(m[1]), 66));
    return { ok: false, status: 404, json: async () => ({ success: false, error: 'not found' }) };
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

const make = () => { const f = fakeFetch(); return { f, pd: new PipedriveReal({ token: 'TOKEN-SECRETO', fetch: f.fn }) }; };

describe('Pipedrive real (somente leitura)', () => {
  it('lista os negócios abertos das etapas "Diagnóstico realizado" de todos os funis', async () => {
    const { pd } = make();
    const deals = await pd.listDeals();
    expect(deals.map(d => d.id).sort()).toEqual(['1', '2', '3']);
    expect(deals.find(d => d.id === '3')!.pipeline).toBe('Vendas Outbound');
  });

  it('traduz campos personalizados e valores', async () => {
    const { pd } = make();
    const d = await pd.getDeal('7');
    expect(d.org).toBe('Empresa 7');
    expect(d.contact).toBe('Contato 7');
    expect(d.contactEmail).toBe('c7@exemplo.com');
    expect(d.services).toEqual(['Estruturação Financeira', 'Plano de Marketing']);
    expect(d.front).toBe('Financeiro');
    expect(d.stage).toBe('Diagnóstico realizado');
    expect(d.value).toBe(1250050);
    expect(d.details).toEqual({ preAudit: 'Caixa desorganizado', urgency: 'Alta', budget: 'Sim', needsApproval: 'Não' });
  });

  it('token vai no cabeçalho, nunca na URL', async () => {
    const { pd, f } = make();
    await pd.listDeals();
    expect(f.calls.length).toBeGreaterThan(0);
    for (const c of f.calls) {
      expect(c.url).not.toContain('TOKEN-SECRETO');
      expect(c.headers['x-api-token']).toBe('TOKEN-SECRETO');
    }
  });

  it('em modo somente leitura, gravações não chamam a API', async () => {
    const { pd, f } = make();
    await pd.updateDeal('1', { stage: 'Proposta apresentada', valueCents: 100 });
    await pd.markWon('1', '2026-11-05');
    expect(f.calls.filter(c => c.method !== 'GET')).toEqual([]);
    expect(pd.skippedWrites).toHaveLength(2);
  });

  it('deal inexistente → erro de não encontrado', async () => {
    const f = fakeFetch();
    const pd = new PipedriveReal({ token: 't', fetch: (async (url: string, init: never) => (url.includes('/deals/999') ? { ok: false, status: 404, json: async () => ({ success: false }) } : (f.fn as never as (u: string, i: never) => unknown)(url, init))) as unknown as typeof fetch });
    await expect(pd.getDeal('999')).rejects.toThrow(/não encontrado/);
  });
});
