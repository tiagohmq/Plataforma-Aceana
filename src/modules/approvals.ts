import { z } from 'zod';
import { newId, type Db } from '../db/client.ts';
import type { User } from '../http/auth.ts';
import { BusinessError, ForbiddenError, NotFoundError } from '../http/errors.ts';
import { can } from '../domain/permissions.ts';
import { approvalNeeded, canApprove, type ApprovalKind } from '../domain/approval-rules.ts';
import { toClientView, type ClientProposal } from '../domain/client-view.ts';
import { getParams } from './parameters.ts';
import { getCatalog } from './catalog.ts';
import { getProposal, getProposalRow, getVersionRow, type ProposalView, type VersionResult } from './proposals.ts';
import { recordAudit } from './audit.ts';
import { enqueueJob } from '../jobs/queue.ts';

const DecisionSchema = z.object({
  versionNumber: z.number().int().min(1),
  decision: z.enum(['APROVADA', 'RECUSADA']),
  justification: z.string().optional(),
});

async function currentVersion(db: Pick<Db, 'query'>, proposalId: string, versionNumber: number) {
  await getProposalRow(db, proposalId);
  const v = await getVersionRow(db, proposalId);
  if (v.number !== versionNumber) throw new BusinessError('VERSAO_DESATUALIZADA', 'Só a versão atual da proposta pode ser aprovada.');
  return v;
}

/** Aprovação válida = a última decisão do tipo exigido para esta versão é APROVADA. */
export async function isApproved(db: Pick<Db, 'query'>, versionId: string, kind: ApprovalKind): Promise<boolean> {
  const r = await db.query<{ decision: string }>(
    "select decision from approvals where target_type = 'PROPOSAL_VERSION' and target_id = $1 and kind = $2 and decision in ('APROVADA','RECUSADA') order by created_at desc limit 1",
    [versionId, kind]);
  return r.rows[0]?.decision === 'APROVADA';
}

export async function requestException(db: Db, user: User, proposalId: string, raw: unknown): Promise<void> {
  const { versionNumber, reason } = z.object({ versionNumber: z.number().int().min(1), reason: z.string().min(1) }).parse(raw);
  if (!can(user.role, 'proposal.edit') && !can(user.role, 'price.approve')) throw new ForbiddenError();
  const v = await currentVersion(db, proposalId, versionNumber);
  await db.query(
    "insert into approvals (id, target_type, target_id, kind, requested_by, decision, justification) values ($1,'PROPOSAL_VERSION',$2,'EXCEPTION_REQUEST',$3,'PEDIDA',$4)",
    [newId(), v.id, user.id, reason]);
  await recordAudit(db, { actorId: user.id, entity: 'proposals', entityId: proposalId, action: 'approval.request_exception', after: { version: v.number, reason } });
}

export async function decide(db: Db, user: User, proposalId: string, raw: unknown): Promise<{ kind: ApprovalKind; decision: string }> {
  const { versionNumber, decision, justification } = DecisionSchema.parse(raw);
  const v = await currentVersion(db, proposalId, versionNumber);
  const kind = approvalNeeded(v.result);
  const req = await db.query<{ requested_by: string }>(
    "select requested_by from approvals where target_id = $1 and kind = 'EXCEPTION_REQUEST' order by created_at desc limit 1", [v.id]);
  const requestedBy = req.rows[0]?.requested_by ?? v.created_by;
  if (!canApprove(user, kind, requestedBy)) throw new ForbiddenError(kind === 'EXCEPTION'
    ? 'Exceção só é aprovada pela Diretoria de Projetos ou Diretoria, e quem pediu não aprova.'
    : 'Seu perfil não aprova preço.');
  await db.query(
    "insert into approvals (id, target_type, target_id, kind, requested_by, decided_by, decision, justification, catalog_version_id, parameter_version_id) values ($1,'PROPOSAL_VERSION',$2,$3,$4,$5,$6,$7,$8,$9)",
    [newId(), v.id, kind, requestedBy, user.id, decision, justification ?? null, v.catalog_version_id, v.parameter_version_id]);
  await recordAudit(db, { actorId: user.id, entity: 'proposals', entityId: proposalId, action: 'approval.decide', after: { version: v.number, kind, decision } });
  return { kind, decision };
}

/** Envia a versão atual: exige aprovação válida, grava validade e enfileira a atualização do deal. */
export async function sendProposal(db: Db, user: User, proposalId: string, now: Date): Promise<ProposalView & { validUntil: string }> {
  if (!can(user.role, 'proposal.edit')) throw new ForbiddenError();
  const p = await getProposalRow(db, proposalId);
  const v = await getVersionRow(db, proposalId);
  if (!(await isApproved(db, v.id, approvalNeeded(v.result)))) throw new BusinessError('APROVACAO_PENDENTE', 'A versão atual ainda não tem aprovação válida.');
  const params = await getParams(db, v.parameter_version_id);
  const validUntil = new Date(now.getTime() + params.proposalValidityDays * 86400000).toISOString().slice(0, 10);
  await db.transaction(async tx => {
    const already = await tx.query('select 1 from proposals where id = $1 and sent_version_id = $2', [proposalId, v.id]);
    if (!already.rows.length) {
      await tx.query("update proposals set status = 'ENVIADA', sent_version_id = $2, sent_at = $3, valid_until = $4 where id = $1", [proposalId, v.id, now.toISOString(), validUntil]);
      await recordAudit(tx, { actorId: user.id, entity: 'proposals', entityId: proposalId, action: 'proposal.send', after: { version: v.number, validUntil } });
    }
    await enqueueJob(tx, {
      type: 'pipedrive.updateDeal',
      idempotencyKey: `send:${v.id}`,
      payload: { dealId: p.deal_id, fields: { stage: 'Proposta apresentada', valueCents: (v.result as VersionResult).valueCents, proposalLink: `/api/public/proposals/${proposalId}`, validUntil, approvalStatus: 'Aprovada', proposalId } },
    });
  });
  const view = await getProposal(db, user, proposalId);
  const vu = await db.query<{ v: string }>("select to_char(valid_until, 'YYYY-MM-DD') as v from proposals where id = $1", [proposalId]);
  return { ...view, validUntil: vu.rows[0].v };
}

/** Visão do cliente da versão enviada (link público). */
export async function getClientProposal(db: Pick<Db, 'query'>, proposalId: string): Promise<ClientProposal> {
  const r = await db.query<{ id: string; org_name: string; contact_name: string | null; sent_version_id: string | null; valid_until: string | null }>(
    "select id, org_name, contact_name, sent_version_id, to_char(valid_until, 'YYYY-MM-DD') as valid_until from proposals where id = $1", [proposalId]);
  const p = r.rows[0];
  if (!p || !p.sent_version_id) throw new NotFoundError('Proposta não encontrada.');
  const v = await db.query<{ input: never; result: VersionResult; catalog_version_id: string }>(
    'select input, result, catalog_version_id from proposal_versions where id = $1', [p.sent_version_id]);
  const row = v.rows[0];
  const catalog = await getCatalog(db, row.catalog_version_id);
  const input = row.input as unknown as import('./proposals.ts').VersionInput;
  const sol = catalog.solutions.find(s => s.code === input.scope.solutionCode);
  return toClientView({
    proposalId: p.id, client: p.org_name, contact: p.contact_name, solutionName: sol?.name ?? input.scope.solutionCode,
    input, result: row.result, validUntil: p.valid_until,
  });
}
