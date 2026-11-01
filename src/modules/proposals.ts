import { z } from 'zod';
import { newId, type Db } from '../db/client.ts';
import type { Connectors } from '../connectors/index.ts';
import type { User } from '../http/auth.ts';
import { BusinessError, ForbiddenError, NotFoundError } from '../http/errors.ts';
import { can } from '../domain/permissions.ts';
import { computeMargins, type Margins } from '../domain/pricing.ts';
import { computeCalculatedPrice, type CalcResult } from '../domain/calculated-price.ts';
import { maxInstallments, splitInstallments } from '../domain/installments.ts';
import type { Params } from '../domain/params-schema.ts';
import { getActiveParams } from './parameters.ts';
import { getActiveCatalog, type Catalog } from './catalog.ts';
import { recordAudit } from './audit.ts';

const RISKS = ['CUSTO_EXTERNO', 'SISTEMA', 'RECORRENCIA', 'PROMESSA_RESULTADO'] as const;
const cents = z.number().int();

export const VersionInputSchema = z.object({
  scope: z.object({
    solutionCode: z.string().min(1),
    stages: z.array(z.object({ name: z.string().min(1), days: z.number().int().min(0), consultants: z.number().int().min(1) })),
    extra: z.array(z.object({ name: z.string().min(1), days: z.number().int().min(0), risks: z.array(z.enum(RISKS)) })).default([]),
  }),
  managers: z.union([z.literal(0), z.literal(1)]),
  externalCostsCents: cents.min(0),
  pricing: z.object({
    complexity: z.number().int().min(1).max(5),
    capacity: z.number().min(0).max(1).optional(),
    size: z.string(), payment: z.string(), channel: z.string(), modality: z.string(), discount: z.string(), outsourcing: z.string(),
  }),
  presentedCents: cents.positive().optional(),
  soldCents: cents.positive().optional(),
  installments: z.number().int().min(1).optional(),
});
export type VersionInput = z.infer<typeof VersionInputSchema>;

export interface VersionResult {
  days: number;
  members: number;
  calculated: CalcResult;
  valueCents: number;
  margins: Margins;
  maxInstallments: number;
  installments: number;
  installmentsCents: number[];
  riskyExtras: string[];
  requiresException: boolean;
}

export interface VersionView {
  id: string;
  number: number;
  input: VersionInput;
  result: VersionResult | Omit<VersionResult, 'margins'>;
  catalogVersionId: string;
  parameterVersionId: string;
  validUntil: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface ProposalView {
  id: string;
  dealId: string;
  org: string;
  contact: string | null;
  ownerId: string | null;
  status: string;
  currentVersion: VersionView;
  versions: number[];
}

/** Recalcula tudo a partir da entrada e dos parâmetros da versão (função pura sobre params/catálogo). */
export function computeVersion(input: VersionInput, params: Params): VersionResult {
  const stageDays = input.scope.stages.reduce((a, s) => a + s.days, 0);
  const extraDays = input.scope.extra.reduce((a, e) => a + e.days, 0);
  const days = stageDays + extraDays;
  const consultants = input.scope.stages.reduce((a, s) => Math.max(a, s.consultants), 0);
  const members = consultants + input.managers;
  const calculated = computeCalculatedPrice({
    stages: input.scope.stages.map(s => ({ days: s.days, consultants: s.consultants })),
    complexity: input.pricing.complexity as 1 | 2 | 3 | 4 | 5,
    capacity: input.pricing.capacity ?? params.productiveCapacity,
    size: input.pricing.size, payment: input.pricing.payment, channel: input.pricing.channel,
    modality: input.pricing.modality, discount: input.pricing.discount, outsourcing: input.pricing.outsourcing,
    externalCostsCents: input.externalCostsCents,
  }, params);
  const valueCents = input.soldCents ?? input.presentedCents ?? calculated.finalCents;
  const margins = computeMargins({ valueCents, externalCostsCents: input.externalCostsCents, days, members }, params);
  const max = maxInstallments(days, params);
  const installments = input.installments ?? 1;
  const riskyExtras = input.scope.extra.filter(e => e.risks.length > 0).map(e => e.name);
  return {
    days, members, calculated, valueCents, margins,
    maxInstallments: max, installments,
    installmentsCents: splitInstallments(valueCents, installments),
    riskyExtras,
    requiresException: margins.requiresException || riskyExtras.length > 0,
  };
}

function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, '')
    .split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join('');
}

function defaultInput(catalog: Catalog, services: string[]): VersionInput {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const sol = catalog.solutions.find(s => services.some(x => norm(x) === norm(s.name))) ?? catalog.solutions[0];
  return {
    scope: { solutionCode: sol.code, stages: sol.stages.map(st => ({ name: st.name, days: st.days, consultants: 2 })), extra: [] },
    managers: 1,
    externalCostsCents: 0,
    pricing: { complexity: Math.min(5, Math.max(1, sol.complexity)), size: 'ME', payment: 'BOLETO', channel: 'INBOUND', modality: 'PRESENCIAL', discount: 'NENHUM', outsourcing: 'NENHUMA' },
  };
}

type Row = { id: string; deal_id: string; org_name: string; contact_name: string | null; owner_id: string | null; status: string };
type VRow = { id: string; number: number; input: VersionInput; result: VersionResult; catalog_version_id: string; parameter_version_id: string; valid_until: string | null; created_by: string | null; created_at: string };

function toVersionView(v: VRow, user: User): VersionView {
  const result = { ...v.result } as Partial<VersionResult>;
  if (!can(user.role, 'margin.view')) delete result.margins;
  return {
    id: v.id, number: v.number, input: v.input, result: result as VersionView['result'],
    catalogVersionId: v.catalog_version_id, parameterVersionId: v.parameter_version_id,
    validUntil: v.valid_until, createdBy: v.created_by, createdAt: String(v.created_at),
  };
}

const VCOLS = "id, number, input, result, catalog_version_id, parameter_version_id, to_char(valid_until, 'YYYY-MM-DD') as valid_until, created_by, created_at";

export async function getVersionRow(db: Pick<Db, 'query'>, proposalId: string, number?: number): Promise<VRow> {
  const r = number === undefined
    ? await db.query<VRow>(`select ${VCOLS} from proposal_versions where proposal_id = $1 order by number desc limit 1`, [proposalId])
    : await db.query<VRow>(`select ${VCOLS} from proposal_versions where proposal_id = $1 and number = $2`, [proposalId, number]);
  if (!r.rows.length) throw new NotFoundError('Versão da proposta não encontrada.');
  return r.rows[0];
}

export async function getProposalRow(db: Pick<Db, 'query'>, id: string): Promise<Row> {
  const r = await db.query<Row>('select id, deal_id, org_name, contact_name, owner_id, status from proposals where id = $1', [id]);
  if (!r.rows.length) throw new NotFoundError('Proposta não encontrada.');
  return r.rows[0];
}

export async function getProposal(db: Pick<Db, 'query'>, user: User, id: string): Promise<ProposalView> {
  const p = await getProposalRow(db, id);
  const v = await getVersionRow(db, id);
  const nums = await db.query<{ number: number }>('select number from proposal_versions where proposal_id = $1 order by number', [id]);
  return {
    id: p.id, dealId: p.deal_id, org: p.org_name, contact: p.contact_name, ownerId: p.owner_id, status: p.status,
    currentVersion: toVersionView(v, user), versions: nums.rows.map(n => n.number),
  };
}

export async function getVersion(db: Pick<Db, 'query'>, user: User, id: string, number: number): Promise<VersionView> {
  await getProposalRow(db, id);
  return toVersionView(await getVersionRow(db, id, number), user);
}

export async function listProposals(db: Pick<Db, 'query'>, user: User): Promise<ProposalView[]> {
  const r = await db.query<{ id: string }>("select id from proposals where status <> 'PERDIDA' order by created_at");
  return Promise.all(r.rows.map(x => getProposal(db, user, x.id)));
}

async function insertVersion(db: Pick<Db, 'query'>, proposalId: string, number: number, input: VersionInput, user: User): Promise<void> {
  const params = await getActiveParams(db);
  const catalog = await getActiveCatalog(db);
  // Chaves de multiplicador inválidas são erro de entrada (400), não chegam ao motor.
  for (const [table, key] of [['size', input.pricing.size], ['payment', input.pricing.payment], ['channel', input.pricing.channel], ['modality', input.pricing.modality], ['discount', input.pricing.discount], ['outsourcing', input.pricing.outsourcing], ['complexity', String(input.pricing.complexity)]] as const) {
    if (!(key in params.values.multipliers[table])) throw Object.assign(new Error(`Valor inválido em ${table}: ${key}.`), { statusCode: 400 });
  }
  if (input.installments !== undefined) {
    const max = computeVersion({ ...input, installments: 1 }, params.values).maxInstallments;
    if (input.installments > max) throw new BusinessError('PARCELAS_ACIMA_DO_MAXIMO', `O máximo para este escopo é ${max} parcelas.`);
  }
  const result = computeVersion(input, params.values);
  await db.query(
    'insert into proposal_versions (id, proposal_id, number, catalog_version_id, parameter_version_id, input, result, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)',
    [newId(), proposalId, number, catalog.id, params.id, JSON.stringify(input), JSON.stringify(result), user.id]);
}

/** Cria a proposta a partir do deal (no máximo uma ativa por deal; reimportar devolve a existente). */
export async function importDeal(db: Db, connectors: Connectors, user: User, dealId: string, now: Date): Promise<{ created: boolean; proposal: ProposalView }> {
  if (!can(user.role, 'proposal.edit')) throw new ForbiddenError();
  const existing = await db.query<{ id: string }>("select id from proposals where deal_id = $1 and status <> 'PERDIDA'", [dealId]);
  if (existing.rows.length) return { created: false, proposal: await getProposal(db, user, existing.rows[0].id) };
  const deal = await connectors.pipedrive.getDeal(dealId);
  const catalog = await getActiveCatalog(db);
  // Mesma organização pode ter dois deals no mês (dois serviços): sufixo para não colidir.
  const base = `PROP_${now.toISOString().slice(0, 7)}_${slug(deal.org)}`;
  let id = base;
  for (let n = 2; (await db.query('select 1 from proposals where id = $1', [id])).rows.length; n++) id = `${base}_${n}`;
  await db.transaction(async tx => {
    await tx.query('insert into proposals (id, deal_id, org_name, contact_name, owner_id) values ($1,$2,$3,$4,$5)', [id, dealId, deal.org, deal.contact, user.id]);
    await insertVersion(tx, id, 1, defaultInput(catalog, deal.services), user);
    await recordAudit(tx, { actorId: user.id, entity: 'proposals', entityId: id, action: 'proposal.import', after: { dealId } });
  });
  return { created: true, proposal: await getProposal(db, user, id) };
}

/** Toda mudança cria versão nova (imutável). expectedCurrentNumber evita duas versões iguais em paralelo. */
export async function createVersion(db: Db, user: User, proposalId: string, raw: unknown): Promise<ProposalView> {
  if (!can(user.role, 'proposal.edit')) throw new ForbiddenError();
  const { expectedCurrentNumber, ...rest } = z.object({ expectedCurrentNumber: z.number().int().min(1) }).passthrough().parse(raw);
  const input = VersionInputSchema.parse(rest);
  await getProposalRow(db, proposalId);
  const before = await getVersionRow(db, proposalId);
  if (before.number !== expectedCurrentNumber) throw new BusinessError('VERSAO_DESATUALIZADA', 'A proposta mudou desde que você abriu. Recarregue e tente de novo.');
  try {
    await db.transaction(async tx => {
      await insertVersion(tx, proposalId, expectedCurrentNumber + 1, input, user);
      await recordAudit(tx, { actorId: user.id, entity: 'proposals', entityId: proposalId, action: 'proposal.version', before: { number: before.number }, after: { number: expectedCurrentNumber + 1 } });
    });
  } catch (e) {
    if (e instanceof BusinessError) throw e;
    if (String((e as Error).message).includes('duplicate key')) throw new BusinessError('VERSAO_DESATUALIZADA', 'A proposta mudou desde que você abriu. Recarregue e tente de novo.');
    throw e;
  }
  return getProposal(db, user, proposalId);
}
