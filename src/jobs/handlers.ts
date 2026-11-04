import type { Db } from '../db/client.ts';
import type { Connectors } from '../connectors/index.ts';
import type { ProjectInput } from '../connectors/monday/interface.ts';
import type { DealUpdate } from '../connectors/pipedrive/interface.ts';
import { enqueueJob } from './queue.ts';
import { recordAudit } from '../modules/audit.ts';

type Handler = (db: Db, c: Connectors, payload: any) => Promise<void>;

async function link(db: Db, dealId: string, system: string): Promise<string | null> {
  const r = await db.query<{ external_id: string }>('select external_id from external_links where deal_id = $1 and system = $2', [dealId, system]);
  return r.rows[0]?.external_id ?? null;
}

const STATUS_RANK: Record<string, number> = { AGUARDANDO_APROVACAO: 0, APROVADO: 1, ENVIADO_CLICKSIGN: 2, ASSINADO_PARCIAL: 3, ASSINADO_CLIENTE: 4, ASSINADO: 5 };

/** Evento do Clicksign já normalizado na entrada (sem dados pessoais). */
async function clicksignEvent(db: Db, _c: Connectors, p: { name: string; envelopeId: string; signerEmail: string | null; occurredAt: string | null }): Promise<void> {
  const r = await db.query<{ contract_id: string; status: string; proposal_id: string; deal_id: string; org_name: string; content: any; result: any }>(
    `select cs.contract_id, cs.status, c.proposal_id, pr.deal_id, pr.org_name, c.content, pv.result
       from contract_status cs join contracts c on c.id = cs.contract_id
       join proposals pr on pr.id = c.proposal_id join proposal_versions pv on pv.id = c.proposal_version_id
      where cs.envelope_id = $1`, [p.envelopeId]);
  const row = r.rows[0];
  if (!row) throw new Error(`envelope sem contrato na plataforma: ${p.envelopeId}`);
  const clientEmail = String(row.content?.signers?.client?.email ?? '').toLowerCase();
  const isClient = p.name === 'sign' && !!p.signerEmail && p.signerEmail.toLowerCase() === clientEmail;
  // Eventos podem chegar repetidos ou fora de ordem: a situação só anda para frente; cancelado/recusado é final.
  const terminal = row.status === 'CANCELADO' || row.status === 'RECUSADO';
  const proposed = p.name === 'sign' ? (isClient ? 'ASSINADO_CLIENTE' : 'ASSINADO_PARCIAL')
    : p.name === 'auto_close' || p.name === 'document_closed' ? 'ASSINADO'
    : p.name === 'cancel' || p.name === 'refusal' ? 'CANCELADO'
    : null;
  const advances = proposed && !terminal && (proposed === 'CANCELADO' || (STATUS_RANK[proposed] ?? 0) > (STATUS_RANK[row.status] ?? 0));
  if (advances) await db.query('update contract_status set status = $2, updated_at = now() where contract_id = $1', [row.contract_id, proposed]);
  await recordAudit(db, { actorId: null, entity: 'contracts', entityId: row.contract_id, action: `clicksign.${p.name}`, after: { status: advances ? proposed : row.status } });
  if (!isClient || terminal) return;

  // Ganho só na assinatura do cliente (F8.4). Depois: deal ganho, projeto no Monday, pasta no Drive.
  const wonAt = (p.occurredAt ?? new Date().toISOString()).slice(0, 10);
  await enqueueJob(db, { type: 'pipedrive.markWon', idempotencyKey: `won:${row.deal_id}`, payload: { dealId: row.deal_id, wonAt } });
  await enqueueJob(db, { type: 'drive.ensureClientFolder', idempotencyKey: `drive:${row.deal_id}`, payload: { dealId: row.deal_id, clientName: row.org_name } });
  const project: ProjectInput = {
    dealId: row.deal_id, name: row.org_name, valueCents: row.result.valueCents, days: row.result.days,
    allocated: row.result.members - 1 >= 0 ? row.result.members - 1 : 0, front: row.content?.front ?? '', wonAt,
    handoffUrl: `/api/proposals/${row.proposal_id}/handoff`,
  };
  await enqueueJob(db, { type: 'monday.createProject', idempotencyKey: `monday:${row.deal_id}`, payload: project });
}

export const HANDLERS: Record<string, Handler> = {
  'pipedrive.updateDeal': async (_db, c, p: { dealId: string; fields: DealUpdate }) => c.pipedrive.updateDeal(p.dealId, p.fields),
  'pipedrive.writeApproved': async (_db, c, p: { dealId: string; valueCents: number; installments: number; installmentsCents: number[]; validUntil?: string; expectedOrg?: string }) =>
    c.pipedrive.writeApproved(p.dealId, { valueCents: p.valueCents, installments: p.installments, installmentsCents: p.installmentsCents, validUntil: p.validUntil, expectedOrg: p.expectedOrg }),
  'pipedrive.markWon': async (_db, c, p: { dealId: string; wonAt: string }) => c.pipedrive.markWon(p.dealId, p.wonAt),
  'monday.createProject': async (db, c, p: ProjectInput) => {
    if (await link(db, p.dealId, 'monday')) return; // um projeto por deal ganho
    const { itemId } = await c.monday.createProject(p);
    await db.query('insert into external_links (deal_id, system, external_id) values ($1, $2, $3) on conflict do nothing', [p.dealId, 'monday', itemId]);
  },
  'drive.ensureClientFolder': async (db, c, p: { dealId: string; clientName: string }) => {
    const f = await c.drive.ensureClientFolder(p.dealId, p.clientName);
    await db.query('insert into external_links (deal_id, system, external_id) values ($1, $2, $3) on conflict do nothing', [p.dealId, 'drive', f.url]);
  },
  'clicksign.event': clicksignEvent,
};
