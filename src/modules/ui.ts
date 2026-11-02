import type { Db } from '../db/client.ts';
import type { User } from '../http/auth.ts';
import { can } from '../domain/permissions.ts';
import { approvalNeeded } from '../domain/approval-rules.ts';
import { getActiveParams } from './parameters.ts';
import { getActiveCatalog } from './catalog.ts';
import { listProposals, type ProposalView } from './proposals.ts';

type Q = Pick<Db, 'query'>;

/** Estado de fluxo de uma proposta, no formato que as telas do v14 usam. Nada pessoal; margem só via currentVersion (já filtrada). */
async function flowOf(db: Q, user: User, p: ProposalView, names: Map<string, string>) {
  const v = p.currentVersion;
  const kind = approvalNeeded(v.result as { requiresException: boolean });
  const ap = await db.query<{ kind: string; decision: string; decided_by: string | null; requested_by: string | null; justification: string | null; created_at: string }>(
    "select kind, decision, decided_by, requested_by, justification, created_at from approvals where target_type = 'PROPOSAL_VERSION' and target_id = $1 order by created_at desc", [v.id]);
  const decided = ap.rows.find(r => r.kind === kind && (r.decision === 'APROVADA' || r.decision === 'RECUSADA'));
  const requested = ap.rows.find(r => r.kind === 'EXCEPTION_REQUEST');
  const approval = decided
    ? { status: decided.decision === 'APROVADA' ? 'ok' : 'rec', kind, by: names.get(decided.decided_by ?? '') ?? decided.decided_by, at: decided.created_at, note: decided.justification }
    : requested ? { status: 'req', kind, by: names.get(requested.requested_by ?? '') ?? requested.requested_by, at: requested.created_at, note: requested.justification }
    : { status: 'none', kind };

  const pr = await db.query<{ sent_version_id: string | null; sent_at: string | null; valid_until: string | null }>(
    "select sent_version_id, sent_at, to_char(valid_until, 'YYYY-MM-DD') as valid_until from proposals where id = $1", [p.id]);
  const forms = await db.query('select 1 from contract_forms where proposal_id = $1 limit 1', [p.id]);
  const data = await db.query<{ data: Record<string, string> }>('select data from contract_data where proposal_id = $1', [p.id]);
  const contract = await db.query<{ id: string; status: string; envelope_id: string | null; proposal_version_id: string }>(
    'select c.id, cs.status, cs.envelope_id, c.proposal_version_id from contracts c join contract_status cs on cs.contract_id = c.id where c.proposal_id = $1 order by c.created_at desc limit 1', [p.id]);
  const c = contract.rows[0];
  const signs = c ? await db.query<{ n: number }>("select count(*)::int as n from audit_events where entity_id = $1 and action = 'clicksign.sign'", [c.id]) : null;
  const links = await db.query<{ system: string }>('select system from external_links where deal_id = $1', [p.dealId]);
  const sys = new Set(links.rows.map(l => l.system));
  return {
    approval,
    sent: !!pr.rows[0]?.sent_version_id && pr.rows[0].sent_version_id === v.id,
    everSent: !!pr.rows[0]?.sent_at,
    sentAt: pr.rows[0]?.sent_at ?? null,
    validUntil: pr.rows[0]?.valid_until ?? null,
    accepted: !!v.input.soldCents,
    formSent: forms.rows.length > 0,
    formData: can(user.role, 'personal.view') ? data.rows[0]?.data ?? null : null, // dados do contratante: só quem vê dados pessoais
    contract: c ? { id: c.id, status: c.status, envelopeId: c.envelope_id, proposalVersionId: c.proposal_version_id } : null,
    signatures: signs?.rows[0].n ?? 0,
    projectCreated: sys.has('monday'),
    driveOk: sys.has('drive'),
  };
}

const ACTIONS: Record<string, string> = {
  'proposal.import': 'Importou deal do Pipedrive', 'proposal.version': 'Criou nova versão', 'approval.decide': 'Decidiu aprovação',
  'approval.request_exception': 'Pediu aprovação de exceção', 'proposal.send': 'Enviou a proposta ao cliente', 'contract.form_link': 'Gerou o link dos dados do contrato',
  'contract.form_submitted': 'Cliente enviou os dados do contrato', 'contract.generate': 'Gerou o contrato', 'contract.approve': 'Decidiu o contrato',
  'contract.envelope': 'Informou o envelope do Clicksign', 'clicksign.sign': 'Assinatura registrada', 'personal.read': 'Leu dados pessoais',
  'params.publish': 'Publicou parâmetros', 'job.retry': 'Reprocessou execução',
};

export async function bootstrap(db: Q, user: User) {
  const users = (await db.query<{ id: string; name: string; role: string }>('select id, name, role from users where active order by id')).rows;
  const names = new Map(users.map(u => [u.id, u.name]));
  const proposals = await listProposals(db, user);
  const withFlow = await Promise.all(proposals.map(async p => ({ ...p, ownerName: names.get(p.ownerId ?? '') ?? null, flow: await flowOf(db, user, p, names) })));
  const deals = new Map(proposals.map(p => [p.dealId, p.id]));
  const runs = (await db.query<{ id: string; job_id: string; connector: string; event: string; ok: boolean; error: string | null; created_at: string; attempts: number; deal_id: string | null; status: string }>(
    `select r.id, r.job_id, r.connector, r.event, r.ok, r.error, r.created_at, j.attempts, j.payload->>'dealId' as deal_id, j.status
       from connector_runs r join jobs j on j.id = r.job_id order by r.created_at desc limit 60`)).rows
    .map(r => ({ ...r, proposalId: r.deal_id ? deals.get(r.deal_id) ?? null : null }));
  const audit = (await db.query<{ actor_id: string | null; action: string; entity_id: string; after: unknown; created_at: string }>(
    'select actor_id, action, entity_id, after, created_at from audit_events order by created_at desc limit 100')).rows
    .map(a => ({ at: a.created_at, who: a.actor_id ? names.get(a.actor_id) ?? a.actor_id : 'Plataforma', action: ACTIONS[a.action] ?? a.action, ref: a.entity_id, detail: a.after }));
  const catalog = await getActiveCatalog(db);
  return {
    me: user,
    users,
    params: can(user.role, 'margin.view') ? await getActiveParams(db) : null,
    catalog: { id: catalog.id, version: catalog.version, solutions: catalog.solutions },
    proposals: withFlow,
    runs,
    audit,
  };
}
