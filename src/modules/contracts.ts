import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { newId, type Db } from '../db/client.ts';
import type { Connectors } from '../connectors/index.ts';
import type { User } from '../http/auth.ts';
import { BusinessError, ForbiddenError, GoneError, NotFoundError } from '../http/errors.ts';
import { can } from '../domain/permissions.ts';
import { approvalNeeded, canApprove } from '../domain/approval-rules.ts';
import { isValidCep, isValidCnpj, isValidCpf, isValidEmail } from '../domain/validators.ts';
import { encrypt, decrypt } from '../domain/crypto.ts';
import { renderContract } from '../domain/contract-template.ts';
import { checkConsistency } from '../domain/consistency.ts';
import { ACE_SIGNATORIES, CONTRACT_PLACE } from '../db/seeds/signatories.ts';
import { getParams } from './parameters.ts';
import { getCatalog } from './catalog.ts';
import { getProposalRow, getVersionRow, type VersionInput, type VersionResult } from './proposals.ts';
import { isApproved } from './approvals.ts';
import { recordAudit } from './audit.ts';
import { enqueueJob } from '../jobs/queue.ts';

const text = z.string().trim().min(1);
// Campos do contrato (dicionário de dados §5). Os pessoais vão cifrados para contract_personal.
const FormSchema = z.object({
  razaoSocial: text,
  cnpjCpf: text.refine(v => isValidCnpj(v) || isValidCpf(v), 'CNPJ ou CPF inválido'),
  endereco: text,
  cep: text.refine(isValidCep, 'CEP inválido'),
  representanteNome: text,
  nacionalidade: text,
  profissao: text,
  emailSignatario: text.refine(isValidEmail, 'e-mail inválido'),
  emailFinanceiro: text.refine(isValidEmail, 'e-mail inválido'),
  representanteCpf: text.refine(isValidCpf, 'CPF inválido'),
  representanteRg: text,
  orgaoEmissor: text,
  estadoCivil: text,
  enderecoRepresentante: text,
});
const PERSONAL = ['representanteCpf', 'representanteRg', 'orgaoEmissor', 'estadoCivil', 'enderecoRepresentante'] as const;

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

function requireKey(key: Buffer | undefined): Buffer {
  if (!key || key.length !== 32) throw new Error('CONTRACT_KEY não configurada');
  return key;
}

/** Versão vendida e aprovada é pré-requisito do formulário e do contrato. */
async function soldApprovedVersion(db: Pick<Db, 'query'>, proposalId: string) {
  const p = await getProposalRow(db, proposalId);
  const v = await getVersionRow(db, proposalId);
  if (p.status === 'RASCUNHO') throw new BusinessError('PROPOSTA_NAO_ENVIADA', 'A proposta ainda não foi enviada ao cliente.');
  if (!v.input.soldCents) throw new BusinessError('VENDA_NAO_REGISTRADA', 'Registre o valor vendido (positiva) antes do contrato.');
  if (!(await isApproved(db, v.id, approvalNeeded(v.result)))) throw new BusinessError('APROVACAO_PENDENTE', 'O valor vendido ainda não tem aprovação válida.');
  return { p, v };
}

export async function createContractForm(db: Db, user: User, proposalId: string, now: Date): Promise<{ url: string; expiresAt: string }> {
  if (!can(user.role, 'proposal.edit')) throw new ForbiddenError();
  const { p, v } = await soldApprovedVersion(db, proposalId);
  const params = await getParams(db, v.parameter_version_id);
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + params.formExpiryHours * 3600000).toISOString();
  await db.query('insert into contract_forms (id, proposal_id, token_hash, expires_at) values ($1,$2,$3,$4)', [newId(), proposalId, hashToken(token), expiresAt]);
  // Positiva: o deal recebe o valor vendido (mesma fonte do contrato).
  await enqueueJob(db, { type: 'pipedrive.updateDeal', idempotencyKey: `sold:${v.id}`, payload: { dealId: p.deal_id, fields: { valueCents: (v.result as VersionResult).valueCents, proposalId } } });
  await recordAudit(db, { actorId: user.id, entity: 'proposals', entityId: proposalId, action: 'contract.form_link', after: { expiresAt } });
  return { url: `/formulario/${token}`, expiresAt };
}

async function openForm(db: Pick<Db, 'query'>, token: string, now: Date) {
  const r = await db.query<{ id: string; proposal_id: string; expires_at: string; used_at: string | null }>(
    'select id, proposal_id, expires_at, used_at from contract_forms where token_hash = $1', [hashToken(token)]);
  const f = r.rows[0];
  if (!f) throw new NotFoundError('Link não encontrado.');
  if (f.used_at || new Date(f.expires_at).getTime() <= now.getTime()) throw new GoneError();
  return f;
}

export async function getForm(db: Pick<Db, 'query'>, token: string, now: Date) {
  const f = await openForm(db, token, now);
  const p = await getProposalRow(db, f.proposal_id);
  return { proposalId: p.id, client: p.org_name, fields: Object.keys(FormSchema.shape) };
}

export async function submitForm(db: Db, key: Buffer | undefined, token: string, raw: unknown, now: Date): Promise<void> {
  const f = await openForm(db, token, now);
  const data = FormSchema.parse(raw);
  const personal = Object.fromEntries(PERSONAL.map(k => [k, data[k]]));
  const pub = Object.fromEntries(Object.entries(data).filter(([k]) => !(PERSONAL as readonly string[]).includes(k)));
  await db.transaction(async tx => {
    const used = await tx.query('update contract_forms set used_at = $2 where id = $1 and used_at is null returning id', [f.id, now.toISOString()]);
    if (!used.rows.length) throw new GoneError();
    await tx.query('insert into contract_data (proposal_id, data) values ($1,$2) on conflict (proposal_id) do update set data = excluded.data, updated_at = now()', [f.proposal_id, JSON.stringify(pub)]);
    await tx.query('insert into contract_personal (proposal_id, ciphertext) values ($1,$2) on conflict (proposal_id) do update set ciphertext = excluded.ciphertext, updated_at = now()',
      [f.proposal_id, encrypt(JSON.stringify(personal), requireKey(key))]);
    await recordAudit(tx, { actorId: null, entity: 'proposals', entityId: f.proposal_id, action: 'contract.form_submitted' });
  });
}

export async function generateContract(db: Db, connectors: Connectors, user: User, proposalId: string, raw: unknown, now: Date) {
  if (!can(user.role, 'proposal.edit')) throw new ForbiddenError();
  const { exclusoes, reunioes } = z.object({ exclusoes: z.array(text), reunioes: z.number().int().min(1) }).parse(raw);
  const { p, v } = await soldApprovedVersion(db, proposalId);
  const input = v.input as VersionInput;
  const result = v.result as VersionResult;
  const catalog = await getCatalog(db, v.catalog_version_id);
  const sol = catalog.solutions.find(s => s.code === input.scope.solutionCode);
  const cd = await db.query<{ data: Record<string, string> }>('select data from contract_data where proposal_id = $1', [proposalId]);
  const stages = [...input.scope.stages.map(s => ({ name: s.name, days: s.days })), ...input.scope.extra.map(e => ({ name: e.name, days: e.days }))];
  const rendered = renderContract({
    proposalId, solution: sol?.name ?? input.scope.solutionCode, stages, totalDays: result.days,
    valueCents: result.valueCents, installmentsCents: result.installmentsCents, paymentMethod: input.pricing.payment,
    client: (cd.rows[0]?.data as never) ?? null,
    ace: { signatory: ACE_SIGNATORIES.institutional.name, signatoryTitle: ACE_SIGNATORIES.institutional.title, witness: ACE_SIGNATORIES.witness.name },
    exclusoes, reunioes, place: CONTRACT_PLACE, date: now.toISOString().slice(0, 10),
  });
  const deal = await connectors.pipedrive.getDeal(p.deal_id);
  const check = checkConsistency({
    proposal: { id: proposalId, valueCents: result.valueCents, installmentsCents: result.installmentsCents, days: result.days },
    contract: { proposalId: rendered.quadroResumo.clausula22, valueCents: result.valueCents, installmentsCents: result.installmentsCents, days: result.days },
    deal: { valueCents: deal.value },
  });
  if (!check.ok) throw new BusinessError('DIVERGENCIA', `Divergência entre proposta, contrato e Pipedrive: ${check.divergences.join(', ')}.`);
  const content = {
    ...rendered, front: sol?.front ?? '', valueCents: result.valueCents, installmentsCents: result.installmentsCents, days: result.days,
    signers: { client: { name: cd.rows[0].data.representanteNome, email: cd.rows[0].data.emailSignatario }, ace: ACE_SIGNATORIES.institutional, witness: ACE_SIGNATORIES.witness },
  };
  const id = newId();
  const hash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  await db.transaction(async tx => {
    await tx.query('insert into contracts (id, proposal_id, proposal_version_id, content, content_hash, created_by) values ($1,$2,$3,$4,$5,$6)', [id, proposalId, v.id, JSON.stringify(content), hash, user.id]);
    await tx.query("insert into contract_status (contract_id, status) values ($1, 'AGUARDANDO_APROVACAO')", [id]);
    await recordAudit(tx, { actorId: user.id, entity: 'contracts', entityId: id, action: 'contract.generate', after: { proposalId, hash } });
  });
  return { id, proposalId, content, status: 'AGUARDANDO_APROVACAO' };
}

async function contractRow(db: Pick<Db, 'query'>, id: string) {
  const r = await db.query<{ id: string; proposal_id: string; proposal_version_id: string; created_by: string | null; status: string; deal_id: string; result: VersionResult }>(
    `select c.id, c.proposal_id, c.proposal_version_id, c.created_by, cs.status, pr.deal_id, pv.result
       from contracts c join contract_status cs on cs.contract_id = c.id join proposals pr on pr.id = c.proposal_id
       join proposal_versions pv on pv.id = c.proposal_version_id where c.id = $1`, [id]);
  if (!r.rows.length) throw new NotFoundError('Contrato não encontrado.');
  return r.rows[0];
}

/** Aprovação própria do contrato: GN/DP dentro da regra; exceção só DP/Diretoria (F5.4). */
export async function approveContract(db: Db, user: User, contractId: string, raw: unknown) {
  const { decision } = z.object({ decision: z.enum(['APROVADA', 'RECUSADA']) }).parse(raw);
  const c = await contractRow(db, contractId);
  const kind = approvalNeeded(c.result);
  if (!canApprove(user, kind, c.created_by)) throw new ForbiddenError();
  await db.query("insert into approvals (id, target_type, target_id, kind, requested_by, decided_by, decision) values ($1,'CONTRACT',$2,$3,$4,$5,$6)",
    [newId(), contractId, kind === 'EXCEPTION' ? 'EXCEPTION' : 'CONTRACT', c.created_by, user.id, decision]);
  const status = decision === 'APROVADA' ? 'APROVADO' : 'RECUSADO';
  await db.query('update contract_status set status = $2, updated_at = now() where contract_id = $1', [contractId, status]);
  await recordAudit(db, { actorId: user.id, entity: 'contracts', entityId: contractId, action: 'contract.approve', after: { decision } });
  return { id: contractId, status };
}

/** Upload no Clicksign é manual (decisão de 01/11): a pessoa informa o ID do envelope criado. */
export async function setEnvelope(db: Db, user: User, contractId: string, raw: unknown) {
  if (!can(user.role, 'proposal.edit')) throw new ForbiddenError();
  const { envelopeId } = z.object({ envelopeId: text }).parse(raw);
  const c = await contractRow(db, contractId);
  if (c.status !== 'APROVADO') throw new BusinessError('CONTRATO_NAO_APROVADO', 'O contrato precisa estar aprovado antes de ir ao Clicksign.');
  await db.transaction(async tx => {
    await tx.query("update contract_status set envelope_id = $2, status = 'ENVIADO_CLICKSIGN', updated_at = now() where contract_id = $1", [contractId, envelopeId]);
    await tx.query("insert into external_links (deal_id, system, external_id) values ($1, 'clicksign', $2) on conflict (deal_id, system) do update set external_id = excluded.external_id", [c.deal_id, envelopeId]);
    await recordAudit(tx, { actorId: user.id, entity: 'contracts', entityId: contractId, action: 'contract.envelope', after: { envelopeId } });
  });
  return { id: contractId, status: 'ENVIADO_CLICKSIGN', envelopeId };
}

/** Leitura de CPF/RG: só perfil autorizado; cada leitura fica na auditoria (sem os valores). */
export async function readPersonal(db: Db, key: Buffer | undefined, user: User, contractId: string) {
  if (!can(user.role, 'personal.view')) throw new ForbiddenError();
  const c = await contractRow(db, contractId);
  const r = await db.query<{ ciphertext: string }>('select ciphertext from contract_personal where proposal_id = $1', [c.proposal_id]);
  if (!r.rows.length) throw new NotFoundError('Dados pessoais não preenchidos.');
  await recordAudit(db, { actorId: user.id, entity: 'contracts', entityId: contractId, action: 'personal.read' });
  return JSON.parse(decrypt(r.rows[0].ciphertext, requireKey(key)));
}
