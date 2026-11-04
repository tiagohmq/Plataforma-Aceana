import { z } from 'zod';
import { newId, type Db } from '../db/client.ts';
import type { User } from '../http/auth.ts';
import { BusinessError, ForbiddenError } from '../http/errors.ts';
import { can } from '../domain/permissions.ts';
import { parsePricingSheet } from '../domain/pricing-sheet.ts';
import { redactPersonalData } from '../domain/redact.ts';
import { getActiveCatalog } from './catalog.ts';
import { createVersion, getProposalRow, type ProposalView, type VersionInput } from './proposals.ts';
import { recordAudit } from './audit.ts';

const Body = z.object({
  fileBase64: z.string().min(10),
  expectedCurrentNumber: z.number().int().min(1),
});

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Importa o escopo da planilha de precificação preenchida pelo assistente de escopo (Claude.ai → Google Sheets → .xlsx).
 * Só o escopo entra (solução, atividades, dias, equipe, custos, multiplicadores); o preço é do motor da plataforma.
 */
export async function importSpreadsheet(db: Db, user: User, proposalId: string, raw: unknown): Promise<{ proposal: ProposalView; warnings: string[]; sheetPriceCents: number | null; project: string }> {
  if (!can(user.role, 'proposal.edit')) throw new ForbiddenError();
  const { fileBase64, expectedCurrentNumber } = Body.parse(raw);
  await getProposalRow(db, proposalId);

  let sheet;
  try { sheet = await parsePricingSheet(Buffer.from(fileBase64, 'base64')); }
  catch (e) { throw Object.assign(new Error((e as Error).message), { statusCode: 400 }); }

  const catalog = await getActiveCatalog(db);
  const sol = catalog.solutions.find(s => plain(s.name) === plain(sheet.solutionName));
  if (!sol) throw new BusinessError('SOLUCAO_FORA_DO_CATALOGO', `A solução "${sheet.solutionName}" da planilha não existe no catálogo. Ajuste o nome na planilha ou cadastre a solução.`);

  const warnings = [...sheet.warnings];
  if (sheet.managers > 1) warnings.push(`A planilha tem ${sheet.managers} gerentes; a plataforma considera no máximo 1 GP por projeto.`);
  const input: VersionInput = {
    source: 'planilha',
    scope: {
      solutionCode: sol.code,
      stages: sheet.stages.flatMap(st => st.activities.map(a => ({
        name: a.name.slice(0, 200), days: Math.round(a.days), consultants: Math.max(1, Math.round(st.consultants)),
        group: st.name.slice(0, 200), ...(a.dod ? { notes: a.dod.slice(0, 2000) } : {}),
      }))),
      extra: [],
    },
    managers: sheet.managers >= 1 ? 1 : 0,
    externalCostsCents: sheet.externalCostsCents,
    pricing: { complexity: Math.min(5, Math.max(1, sol.complexity)), ...sheet.pricing },
  };

  const proposal = await createVersion(db, user, proposalId, { ...input, expectedCurrentNumber });

  // Dores, objetivo e indicadores da planilha viram o diagnóstico da proposta (sem dados pessoais).
  const d = { dores: redactPersonalData(sheet.diagnosis.dores), objetivo: redactPersonalData(sheet.diagnosis.objetivo), indicadores: redactPersonalData(sheet.diagnosis.indicadores) };
  const itens = [
    d.dores && { tipo: 'DOR', texto: d.dores, trecho: d.dores },
    d.objetivo && { tipo: 'OBJETIVO', texto: d.objetivo, trecho: d.objetivo },
    d.indicadores && { tipo: 'OBJETIVO', texto: `Indicadores: ${d.indicadores}`, trecho: d.indicadores },
  ].filter(Boolean);
  const tid = newId();
  await db.transaction(async tx => {
    await tx.query("insert into transcripts (id, proposal_id, kind, text_redacted, created_by) values ($1,$2,'PLANILHA',$3,$4)",
      [tid, proposalId, [d.dores, d.objetivo, d.indicadores].filter(Boolean).join('\n\n'), user.id]);
    await tx.query('insert into ai_suggestions (id, transcript_id, model, accepted, discarded, created_by) values ($1,$2,$3,$4,$5,$6)', [
      newId(), tid, 'planilha do assistente de escopo',
      JSON.stringify({ resumo: sheet.project, itens, solucoes: [{ codigo: sol.code, motivo: 'Solução definida na planilha de precificação', trecho: sheet.solutionName }] }),
      JSON.stringify([]), user.id]);
    await recordAudit(tx, { actorId: user.id, entity: 'proposals', entityId: proposalId, action: 'scope.import_spreadsheet',
      after: { project: sheet.project, solution: sol.code, atividades: input.scope.stages.length, sheetPriceCents: sheet.sheetPriceCents, avisos: warnings.length } });
  });
  return { proposal, warnings, sheetPriceCents: sheet.sheetPriceCents, project: sheet.project };
}
