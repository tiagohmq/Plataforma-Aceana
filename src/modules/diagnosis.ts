import { z } from 'zod';
import { newId, type Db } from '../db/client.ts';
import type { Connectors } from '../connectors/index.ts';
import type { DiagnosisAI } from '../connectors/ai/interface.ts';
import type { User } from '../http/auth.ts';
import { BusinessError, ForbiddenError, NotFoundError } from '../http/errors.ts';
import { can } from '../domain/permissions.ts';
import { redactPersonalData } from '../domain/redact.ts';
import { guardDiagnosis, type Diagnosis } from '../domain/ai-guard.ts';
import { getActiveCatalog } from './catalog.ts';
import { getProposalRow } from './proposals.ts';
import { recordAudit } from './audit.ts';

const InputSchema = z.object({ transcript: z.string().trim().min(20, 'Cole a transcrição da reunião (pelo menos algumas frases).').max(400000) });

export interface DiagnosisView extends Diagnosis {
  id: string;
  model: string;
  createdAt: string;
  solucoes: (Diagnosis['solucoes'][number] & { nome: string })[];
  descartados: { tipo: string; texto: string; motivo: string }[];
}

/**
 * F2.2–F2.4: recebe a transcrição, tira dados pessoais, pede à IA o diagnóstico estruturado e as soluções do catálogo,
 * e passa a resposta pela trava (catálogo, trecho de origem, nada de preço/prazo/cláusula). O GN decide o que usar.
 */
export async function analyzeTranscript(db: Db, connectors: Connectors, ai: DiagnosisAI | undefined, user: User, proposalId: string, raw: unknown): Promise<DiagnosisView> {
  if (!can(user.role, 'proposal.edit')) throw new ForbiddenError();
  const { transcript } = InputSchema.parse(raw);
  const p = await getProposalRow(db, proposalId);
  if (!ai) throw new BusinessError('IA_NAO_CONFIGURADA', 'A IA não está configurada: coloque ANTHROPIC_API_KEY no .env e reinicie o servidor.');

  const redacted = redactPersonalData(transcript);
  const catalog = await getActiveCatalog(db);
  let preAudit: string | undefined;
  try { preAudit = (await connectors.pipedrive.getDeal(p.deal_id)).details?.preAudit; } catch { /* deal indisponível: segue sem a pré-auditoria */ }

  const out = await ai({
    transcript: redacted,
    preAudit: preAudit ? redactPersonalData(preAudit) : undefined,
    catalog: catalog.solutions.map(s => ({ code: s.code, name: s.name, front: s.front })),
  });
  const g = guardDiagnosis(out.output, redacted + '\n' + (preAudit ? redactPersonalData(preAudit) : ''), catalog.solutions.map(s => s.code));

  const tid = newId(), sid = newId();
  await db.transaction(async tx => {
    await tx.query('insert into transcripts (id, proposal_id, text_redacted, created_by) values ($1,$2,$3,$4)', [tid, proposalId, redacted, user.id]);
    await tx.query('insert into ai_suggestions (id, transcript_id, model, accepted, discarded, created_by) values ($1,$2,$3,$4,$5,$6)',
      [sid, tid, out.model, JSON.stringify(g.accepted), JSON.stringify(g.discarded), user.id]);
    await recordAudit(tx, { actorId: user.id, entity: 'proposals', entityId: proposalId, action: 'diagnosis.analyze',
      after: { model: out.model, itens: g.accepted.itens.length, solucoes: g.accepted.solucoes.map(s => s.codigo), descartados: g.discarded.length } });
  });
  return getDiagnosis(db, user, proposalId);
}

/** Última análise da proposta (GP também vê: entra no pacote de passagem). */
export async function getDiagnosis(db: Pick<Db, 'query'>, user: User, proposalId: string): Promise<DiagnosisView> {
  if (!can(user.role, 'proposal.edit') && !can(user.role, 'handoff.view')) throw new ForbiddenError();
  await getProposalRow(db, proposalId);
  const r = await db.query<{ id: string; model: string; accepted: Diagnosis; discarded: DiagnosisView['descartados']; created_at: string }>(
    `select s.id, s.model, s.accepted, s.discarded, s.created_at from ai_suggestions s join transcripts t on t.id = s.transcript_id
      where t.proposal_id = $1 order by s.created_at desc limit 1`, [proposalId]);
  const row = r.rows[0];
  if (!row) throw new NotFoundError('Nenhuma transcrição analisada nesta proposta.');
  const catalog = await getActiveCatalog(db);
  const name = (c: string) => catalog.solutions.find(s => s.code === c)?.name ?? c;
  return {
    id: row.id, model: row.model, createdAt: String(row.created_at),
    resumo: row.accepted.resumo, itens: row.accepted.itens,
    solucoes: row.accepted.solucoes.map(s => ({ ...s, nome: name(s.codigo) })),
    descartados: row.discarded,
  };
}
