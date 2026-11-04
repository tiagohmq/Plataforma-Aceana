import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testApp } from './app-helper.ts';
import { api, as, versionBody } from './fixtures.ts';

/** PDF mínimo válido com uma linha de texto (Helvetica). */
export function makePdf(line: string): Buffer {
  const esc = line.replace(/[\\()]/g, m => '\\' + m);
  const stream = `BT /F1 12 Tf 50 700 Td (${esc}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

let app: FastifyInstance;
let a: ReturnType<typeof api>;
beforeEach(async () => { ({ app } = await testApp()); a = api(app); });

/** Proposta com v2 aprovada: R$ 15.000 em 3 parcelas de R$ 5.000. */
async function approved(): Promise<string> {
  const p = (await a.importDeal()).json();
  await a.newVersion(p.id, 1, versionBody());
  await a.approve(p.id, 2, 'larissa');
  return p.id;
}
const attach = (id: string, payload: object, user = 'larissa') => app.inject({ method: 'POST', url: `/api/proposals/${id}/attachment`, headers: as(user), payload });
const pdf = (line: string) => ({ kind: 'PDF', filename: 'proposta.pdf', fileBase64: makePdf(line).toString('base64') });

describe('proposta pronta anexada (PDF ou Canva)', () => {
  it('PDF com valor e parcelas da versão aprovada é aceito sem confirmação', async () => {
    const id = await approved();
    const r = await attach(id, pdf('Investimento: R$ 15.000,00 em 3 parcelas de R$ 5.000,00'));
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().checks).toMatchObject({ valueFound: true, installmentsFound: true, mentionsMargin: false });
  });

  it('PDF com valor diferente pede conferência; confirmado, entra com o nome de quem confirmou', async () => {
    const id = await approved();
    const r = await attach(id, pdf('Investimento: R$ 14.000,00 em 2 parcelas'));
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('CONFERENCIA_PENDENTE');
    const ok = await attach(id, { ...pdf('Investimento: R$ 14.000,00 em 2 parcelas'), confirmed: true });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().confirmedBy).toBe('larissa');
  });

  it('PDF que menciona margem pede conferência', async () => {
    const id = await approved();
    const r = await attach(id, pdf('R$ 15.000,00 em 3 parcelas de R$ 5.000,00. Margem de contribuicao 66%'));
    expect(r.json().codigo).toBe('CONFERENCIA_PENDENTE');
    expect(r.json().erro).toMatch(/margem/i);
  });

  it('link do Canva exige confirmação do GN', async () => {
    const id = await approved();
    const url = 'https://www.canva.com/design/DAG0000/view';
    expect((await attach(id, { kind: 'LINK', url })).json().codigo).toBe('CONFERENCIA_PENDENTE');
    const ok = await attach(id, { kind: 'LINK', url, confirmed: true });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().url).toBe(url);
  });

  it('link fora do Canva ou sem https → 400', async () => {
    const id = await approved();
    expect((await attach(id, { kind: 'LINK', url: 'http://www.canva.com/design/x', confirmed: true })).statusCode).toBe(400);
    expect((await attach(id, { kind: 'LINK', url: 'https://exemplo.com/proposta', confirmed: true })).statusCode).toBe(400);
  });

  it('sem aprovação da versão atual não anexa', async () => {
    const p = (await a.importDeal()).json();
    await a.newVersion(p.id, 1, versionBody());
    expect((await attach(p.id, pdf('R$ 15.000,00'))).json().codigo).toBe('APROVACAO_PENDENTE');
  });

  it('GP não anexa; arquivo que não é PDF → 400', async () => {
    const id = await approved();
    expect((await attach(id, pdf('R$ 15.000,00'), 'clara')).statusCode).toBe(403);
    expect((await attach(id, { kind: 'PDF', filename: 'x.pdf', fileBase64: Buffer.from('oi').toString('base64') })).statusCode).toBe(400);
  });

  it('cliente vê o PDF da versão enviada pelo link público', async () => {
    const id = await approved();
    await attach(id, pdf('Investimento: R$ 15.000,00 em 3 parcelas de R$ 5.000,00'));
    const sent = (await a.send(id)).json();
    const pub = (await app.inject({ method: 'GET', url: sent.publicUrl })).json();
    expect(pub.attachment.kind).toBe('PDF');
    const file = await app.inject({ method: 'GET', url: pub.attachment.url });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toMatch(/application\/pdf/);
    expect(file.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('nova versão: o anexo antigo deixa de valer', async () => {
    const id = await approved();
    await attach(id, pdf('Investimento: R$ 15.000,00 em 3 parcelas de R$ 5.000,00'));
    await a.newVersion(id, 2, versionBody({ presentedCents: 1600000 }));
    const b = (await app.inject({ method: 'GET', url: '/api/ui/bootstrap', headers: as('larissa') })).json();
    expect(b.proposals[0].flow.attachment).toBeNull();
  });
});
