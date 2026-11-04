import type { ApprovedTerms, Deal, DealUpdate, PipedriveConnector } from './interface.ts';
import { NotFoundError } from '../../http/errors.ts';

const API = 'https://api.pipedrive.com/v1';
const DIAGNOSIS_STAGE = 'diagnostico realizado';
const CACHE_MS = 10 * 60 * 1000;

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

interface Field { key: string; name: string; field_type: string; options?: { id: number; label: string }[] }
type Raw = Record<string, unknown> & {
  id: number; title: string; value?: number; status?: string; stage_id: number; pipeline_id: number;
  org_name?: string; person_name?: string;
  org_id?: { name?: string } | null; person_id?: { name?: string; email?: { value: string; primary?: boolean }[] } | null;
};

export interface PipedriveRealOptions {
  token: string;
  write?: boolean; // gravações gerais no CRM; desligado por padrão (decisão de 02/11: só leitura)
  writeApproved?: boolean; // só valor aprovado, parcelas aprovadas e validade (decisão de 04/11)
  fetch?: typeof fetch;
}

/**
 * Conector real do Pipedrive (API v1). Lê negócios, etapas, funis e campos personalizados.
 * O token vai no cabeçalho x-api-token, nunca na URL. Com write=false, gravações são registradas e não enviadas.
 */
export class PipedriveReal implements PipedriveConnector {
  private token: string;
  private write: boolean;
  private writeApprovedOn: boolean;
  private http: typeof fetch;
  private cache: { at: number; fields: Field[]; stages: Map<number, string>; pipelines: Map<number, string> } | null = null;
  skippedWrites: { op: string; dealId: string; fields?: DealUpdate }[] = [];

  constructor(o: PipedriveRealOptions) {
    if (!o.token) throw new Error('PIPEDRIVE_API_TOKEN não configurado');
    this.token = o.token;
    this.write = !!o.write;
    this.writeApprovedOn = !!o.writeApproved;
    this.http = o.fetch ?? fetch;
  }

  private async get<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    const r = await this.http(url.toString(), { method: 'GET', headers: { 'x-api-token': this.token, accept: 'application/json' } });
    if (r.status === 404) throw new NotFoundError('Negócio não encontrado no Pipedrive.');
    const j = (await r.json()) as { success?: boolean; data?: T; error?: string };
    if (!r.ok || !j.success) throw new Error(`Pipedrive respondeu ${r.status}: ${j.error ?? 'erro'}`);
    return j.data as T;
  }

  private async meta() {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache;
    const [fields, stages, pipelines] = await Promise.all([
      this.get<Field[]>('/dealFields', { limit: 500 }),
      this.get<{ id: number; name: string }[]>('/stages'),
      this.get<{ id: number; name: string }[]>('/pipelines'),
    ]);
    this.cache = {
      at: Date.now(), fields: fields ?? [],
      stages: new Map((stages ?? []).map(s => [s.id, s.name.trim()])),
      pipelines: new Map((pipelines ?? []).map(p => [p.id, p.name.trim()])),
    };
    return this.cache;
  }

  /** Valor de um campo personalizado pelo nome; set/enum viram os rótulos das opções. */
  private field(raw: Raw, fields: Field[], name: string, prefer?: string): string[] {
    const candidates = fields.filter(f => norm(f.name) === norm(name));
    const f = candidates.find(c => c.field_type === prefer) ?? candidates[0];
    if (!f) return [];
    const v = raw[f.key];
    if (v === null || v === undefined || v === '') return [];
    if (f.options && (f.field_type === 'set' || f.field_type === 'enum')) {
      const ids = String(v).split(',').map(s => Number(s.trim()));
      return ids.map(id => f.options!.find(o => o.id === id)?.label).filter((x): x is string => !!x);
    }
    return f.field_type === 'varchar' && name.startsWith('Serviço') ? String(v).split(',').map(s => s.trim()).filter(Boolean) : [String(v).trim()];
  }

  private async map(raw: Raw): Promise<Deal> {
    const m = await this.meta();
    const one = (name: string) => this.field(raw, m.fields, name).join(', ') || undefined;
    const email = raw.person_id?.email?.find(e => e.primary)?.value ?? raw.person_id?.email?.[0]?.value;
    const services = this.field(raw, m.fields, 'Serviço(s) demandado(s)', 'set');
    return {
      id: String(raw.id),
      title: raw.title,
      org: raw.org_name ?? raw.org_id?.name ?? raw.title,
      contact: raw.person_name ?? raw.person_id?.name ?? '',
      contactEmail: email,
      services: services.length ? services : this.field(raw, m.fields, 'Serviço(s) demandado(s)', 'varchar'),
      front: one('Frente(s) de atuação'),
      stage: m.stages.get(raw.stage_id) ?? String(raw.stage_id),
      pipeline: m.pipelines.get(raw.pipeline_id),
      value: raw.value !== undefined && raw.value !== null ? Math.round(raw.value * 100) : undefined,
      status: (raw.status as Deal['status']) ?? 'open',
      details: { preAudit: one('Pré-auditoria'), urgency: one('Urgência validada'), budget: one('Budget validado'), needsApproval: one('Necessita de aprovação') },
    };
  }

  async getDeal(dealId: string): Promise<Deal> {
    if (!/^\d+$/.test(dealId)) throw new NotFoundError('Negócio não encontrado no Pipedrive.');
    return this.map(await this.get<Raw>(`/deals/${dealId}`));
  }

  /** Sem etapa: todos os negócios abertos em "Diagnóstico realizado", em qualquer funil. */
  async listDeals(stage?: string): Promise<Deal[]> {
    const m = await this.meta();
    const target = norm(stage ?? DIAGNOSIS_STAGE);
    const ids = [...m.stages].filter(([, name]) => norm(name) === target).map(([id]) => id);
    const lists = await Promise.all(ids.map(id => this.get<Raw[]>('/deals', { stage_id: id, status: 'open', limit: 500 })));
    return Promise.all(lists.flatMap(l => l ?? []).map(r => this.map(r)));
  }

  /** Campos que a plataforma pode gravar (lista fechada). Os dois primeiros são criados por um admin do Pipedrive. */
  static readonly APPROVED_FIELDS = { value: 'Valor aprovado', installments: 'Parcelas aprovadas' } as const;

  async writeApproved(dealId: string, t: ApprovedTerms): Promise<void> {
    if (!this.writeApprovedOn) { this.skippedWrites.push({ op: 'writeApproved', dealId }); return; }
    if (!/^\d+$/.test(dealId)) throw new NotFoundError('Negócio não encontrado no Pipedrive.');
    if (t.expectedOrg) {
      const d = await this.getDeal(dealId);
      if (norm(d.org) !== norm(t.expectedOrg)) throw new Error(`Negócio ${dealId} no Pipedrive é de outra organização (${d.org}); nada foi gravado.`);
    }
    const m = await this.meta();
    const key = (name: string) => {
      const f = m.fields.find(x => norm(x.name) === norm(name));
      if (!f) throw new Error(`Campo "${name}" não existe no Pipedrive: peça a um admin para criar (Configurações → Campos de dados → Negócio).`);
      return f.key;
    };
    const brl = (c: number) => 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const body: Record<string, unknown> = {
      [key(PipedriveReal.APPROVED_FIELDS.value)]: t.valueCents / 100,
      [key(PipedriveReal.APPROVED_FIELDS.installments)]: t.installments <= 1 ? `À vista: ${brl(t.valueCents)}` : `${t.installments}x de ${brl(t.installmentsCents[0])}`,
    };
    if (t.validUntil) body.expected_close_date = t.validUntil;
    const r = await this.http(`${API}/deals/${dealId}`, { method: 'PUT', headers: { 'x-api-token': this.token, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
    const j = (await r.json()) as { success?: boolean; error?: string };
    if (!r.ok || !j.success) throw new Error(`Pipedrive recusou a gravação (${r.status}): ${j.error ?? 'erro'}`);
  }

  async updateDeal(dealId: string, fields: DealUpdate): Promise<void> {
    if (!this.write) { this.skippedWrites.push({ op: 'updateDeal', dealId, fields }); return; }
    throw new Error('gravação no Pipedrive ainda não implementada (somente leitura)');
  }

  async markWon(dealId: string): Promise<void> {
    if (!this.write) { this.skippedWrites.push({ op: 'markWon', dealId }); return; }
    throw new Error('gravação no Pipedrive ainda não implementada (somente leitura)');
  }
}
