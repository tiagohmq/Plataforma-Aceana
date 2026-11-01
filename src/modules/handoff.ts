import type { Db } from '../db/client.ts';
import type { User } from '../http/auth.ts';
import { ForbiddenError } from '../http/errors.ts';
import { can } from '../domain/permissions.ts';
import { getProposal } from './proposals.ts';

/** Pacote de passagem para o GP (F9.3): margem só para quem tem permissão. */
export async function getHandoff(db: Pick<Db, 'query'>, user: User, proposalId: string) {
  if (!can(user.role, 'handoff.view')) throw new ForbiddenError();
  const p = await getProposal(db, user, proposalId);
  const links = await db.query<{ system: string; external_id: string }>('select system, external_id from external_links where deal_id = $1', [p.dealId]);
  const contract = await db.query<{ status: string; envelope_id: string | null }>(
    'select cs.status, cs.envelope_id from contract_status cs join contracts c on c.id = cs.contract_id where c.proposal_id = $1 order by c.created_at desc limit 1', [proposalId]);
  const byKey = Object.fromEntries(links.rows.map(l => [l.system, l.external_id]));
  return {
    proposalId: p.id, dealId: p.dealId, client: p.org, contact: p.contact, status: p.status,
    scope: p.currentVersion.input.scope, result: p.currentVersion.result,
    contract: contract.rows[0] ?? null,
    mondayItemId: byKey.monday ?? null,
    driveFolder: byKey.drive ?? null,
  };
}
