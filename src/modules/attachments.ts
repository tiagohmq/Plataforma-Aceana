import { z } from 'zod';
import { extractText, getDocumentProxy } from 'unpdf';
import { newId, type Db } from '../db/client.ts';
import type { User } from '../http/auth.ts';
import { BusinessError, ForbiddenError, NotFoundError } from '../http/errors.ts';
import { can } from '../domain/permissions.ts';
import { approvalNeeded } from '../domain/approval-rules.ts';
import { getProposalRow, getVersionRow, type VersionResult } from './proposals.ts';
import { isApproved } from './approvals.ts';
import { recordAudit } from './audit.ts';

const Body = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('PDF'), filename: z.string().min(1).max(200), fileBase64: z.string().min(10), confirmed: z.boolean().optional() }),
  z.object({ kind: z.literal('LINK'), url: z.string().url().max(1000), confirmed: z.boolean().optional() }),
]);

// Só links do Canva, sempre https (o cliente abre o link a partir da plataforma).
const CANVA = /(^|\.)(canva\.com|canva\.link|canva\.site)$/i;

export interface AttachmentChecks {
  valueFound: boolean | null; // null = não dá para ler (link)
  installmentsFound: boolean | null;
  mentionsMargin: boolean | null;
  expected: { value: string; installments: number; installment: string };
}

export interface AttachmentView {
  id: string; kind: 'PDF' | 'LINK'; filename: string | null; url: string | null;
  checks: AttachmentChecks; confirmedBy: string | null; createdBy: string | null; createdAt: string;
}

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Confere o texto do PDF contra a versão aprovada: valor, parcelas e nenhuma menção a margem. */
export function checkProposalText(text: string, r: VersionResult): AttachmentChecks {
  const t = text.replace(/ /g, ' ').replace(/\s+/g, ' ');
  const value = brl(r.valueCents), installment = brl(r.installmentsCents[0] ?? r.valueCents), n = r.installments;
  const installmentsFound = n <= 1 ? true : new RegExp(`\\b${n}\\s*(x|×|parcelas|vezes)`, 'i').test(t) && t.includes(installment);
  return {
    valueFound: t.includes(value),
    installmentsFound,
    mentionsMargin: /margem|contribui[cç][aã]o|\bpiso\b/i.test(t),
    expected: { value: `R$ ${value}`, installments: n, installment: `R$ ${installment}` },
  };
}

async function pdfText(buf: Buffer): Promise<string> {
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw Object.assign(new Error('O arquivo não é um PDF.'), { statusCode: 400 });
  try {
    const doc = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(doc, { mergePages: true });
    return Array.isArray(text) ? text.join(' ') : text;
  } catch { throw Object.assign(new Error('Não consegui ler o PDF. Exporte de novo pelo Canva ou pelo Docs e tente outra vez.'), { statusCode: 400 }); }
}

/**
 * Anexa a proposta pronta (PDF ou Canva) à versão atual, que precisa estar aprovada (M6).
 * Divergência de valor/parcelas ou menção a margem exige confirmação explícita do GN, registrada em seu nome.
 */
export async function attachProposal(db: Db, user: User, proposalId: string, raw: unknown): Promise<AttachmentView> {
  if (!can(user.role, 'proposal.edit')) throw new ForbiddenError();
  const body = Body.parse(raw);
  await getProposalRow(db, proposalId);
  const v = await getVersionRow(db, proposalId);
  if (!(await isApproved(db, v.id, approvalNeeded(v.result)))) throw new BusinessError('APROVACAO_PENDENTE', 'Aprove o preço desta versão antes de anexar a proposta.');
  const r = v.result as VersionResult;

  let checks: AttachmentChecks;
  let content: string | null = null, url: string | null = null, filename: string | null = null;
  if (body.kind === 'PDF') {
    const buf = Buffer.from(body.fileBase64, 'base64');
    checks = checkProposalText(await pdfText(buf), r);
    content = buf.toString('base64');
    filename = body.filename;
  } else {
    const u = new URL(body.url);
    if (u.protocol !== 'https:' || !CANVA.test(u.hostname)) throw Object.assign(new Error('Use um link https do Canva (canva.com, canva.link ou canva.site).'), { statusCode: 400 });
    url = body.url;
    checks = { valueFound: null, installmentsFound: null, mentionsMargin: null, expected: { value: `R$ ${brl(r.valueCents)}`, installments: r.installments, installment: `R$ ${brl(r.installmentsCents[0] ?? r.valueCents)}` } };
  }

  const problems = body.kind === 'LINK'
    ? [`não dá para ler o Canva: confira se o valor é ${checks.expected.value} em ${checks.expected.installments}x de ${checks.expected.installment} e que nada sobre margem aparece`]
    : [
      !checks.valueFound && `o valor ${checks.expected.value} não aparece no PDF`,
      !checks.installmentsFound && `as ${checks.expected.installments} parcelas de ${checks.expected.installment} não aparecem no PDF`,
      checks.mentionsMargin && 'o PDF menciona margem, contribuição ou piso (a margem nunca vai para o cliente)',
    ].filter((x): x is string => !!x);
  if (problems.length && !body.confirmed) {
    throw new BusinessError('CONFERENCIA_PENDENTE', `Confira antes de anexar: ${problems.join('; ')}. Se estiver certo, confirme.`);
  }

  const id = newId();
  const confirmedBy = problems.length ? user.id : null;
  await db.query('insert into proposal_attachments (id, proposal_version_id, kind, filename, content_base64, url, checks, confirmed_by, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, v.id, body.kind, filename, content, url, JSON.stringify(checks), confirmedBy, user.id]);
  await recordAudit(db, { actorId: user.id, entity: 'proposals', entityId: proposalId, action: 'proposal.attach',
    after: { version: v.number, kind: body.kind, checks: { valor: checks.valueFound, parcelas: checks.installmentsFound, margem: checks.mentionsMargin }, confirmadoPor: confirmedBy } });
  return (await latestAttachment(db, v.id))!;
}

/** Último anexo de uma versão (ou null). */
export async function latestAttachment(db: Pick<Db, 'query'>, versionId: string): Promise<AttachmentView | null> {
  const r = await db.query<{ id: string; kind: 'PDF' | 'LINK'; filename: string | null; url: string | null; checks: AttachmentChecks; confirmed_by: string | null; created_by: string | null; created_at: string }>(
    'select id, kind, filename, url, checks, confirmed_by, created_by, created_at from proposal_attachments where proposal_version_id = $1 order by created_at desc limit 1', [versionId]);
  const a = r.rows[0];
  return a ? { id: a.id, kind: a.kind, filename: a.filename, url: a.url, checks: a.checks, confirmedBy: a.confirmed_by, createdBy: a.created_by, createdAt: String(a.created_at) } : null;
}

/** PDF anexado à versão enviada, para o link público do cliente. */
export async function publicPdf(db: Pick<Db, 'query'>, token: string): Promise<{ filename: string; data: Buffer }> {
  const r = await db.query<{ filename: string; content_base64: string }>(
    `select a.filename, a.content_base64 from proposals p join proposal_attachments a on a.proposal_version_id = p.sent_version_id
      where p.public_token = $1 and a.kind = 'PDF' order by a.created_at desc limit 1`, [token]);
  if (!r.rows.length) throw new NotFoundError('Proposta não encontrada.');
  return { filename: r.rows[0].filename, data: Buffer.from(r.rows[0].content_base64, 'base64') };
}
