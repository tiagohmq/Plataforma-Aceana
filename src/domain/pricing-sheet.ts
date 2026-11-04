import ExcelJS from 'exceljs';

/** Escopo lido de uma planilha PLAN_Precificacao (a que o assistente de escopo preenche no Google Sheets). */
export interface PricingSheet {
  project: string;
  solutionName: string;
  managers: number;
  front: string;
  diagnosis: { dores: string; objetivo: string; indicadores: string };
  stages: { name: string; consultants: number; days: number; activities: { name: string; description: string; days: number; dod?: string }[] }[];
  pricing: { size: string; payment: string; channel: string; modality: string; discount: string; outsourcing: string };
  externalCostsCents: number;
  sheetPriceCents: number | null; // só referência: o preço vem do motor da plataforma
  warnings: string[];
}

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Texto de uma célula, qualquer que seja o tipo (texto, rico, fórmula, erro). */
function text(c: ExcelJS.Cell): string {
  const v = c.value as unknown;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const o = v as { richText?: { text: string }[]; result?: unknown; error?: string; text?: string };
    if (o.richText) return o.richText.map(r => r.text).join('');
    if (o.error) return o.error;
    if ('result' in o) return o.result === undefined || o.result === null ? '' : typeof o.result === 'object' ? String((o.result as { error?: string }).error ?? '') : String(o.result);
    if (o.text) return o.text;
  }
  return String(v);
}

/** Número de uma célula: aceita número, fórmula com resultado e texto "R$ 9.960,00". */
function num(c: ExcelJS.Cell): number | null {
  const v = c.value as unknown;
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && typeof (v as { result?: unknown }).result === 'number') return (v as { result: number }).result;
  const t = text(c).replace(/R\$|\s|%/g, '');
  if (!t || /#REF|#N\/A|#VALUE/i.test(t) || t === '-') return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : null;
}

const SIZE: Record<string, string> = { 'microempresa (me)': 'ME', 'microempresa (mei)': 'ME', 'empresa de pequeno porte (epp)': 'EPP', 'empresa de medio porte': 'MEDIO', 'grandes empresas': 'GRANDE' };
const PAYMENT: Record<string, string> = { cartao: 'CARTAO', boleto: 'BOLETO', 'a vista': 'A_VISTA' };
const CHANNEL: Record<string, string> = { digital: 'DIGITAL', outbound: 'OUTBOUND', inbound: 'INBOUND', mej: 'MEJ' };
const MODALITY: Record<string, string> = { presencial: 'PRESENCIAL', hibrido: 'HIBRIDO', remoto: 'REMOTO' };
const DISCOUNT: Record<string, string> = { 'black november': 'BLACK_NOVEMBER', 'dia do consumidor': 'DIA_CONSUMIDOR', 'indicacao de cliente': 'INDICACAO', inovacao: 'INOVACAO', '*margem para desconto': 'NENHUM' };
const OUTSOURCING: Record<string, string> = { 'terceirizacao completa': 'COMPLETA', ray: 'RAY', ion: 'ION', orbit: 'ORBIT', mej: 'MEJ', odd: 'ODD', falae: 'FALAE', multiplas: 'MULTIPLAS' };

function sheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = wb.worksheets.find(w => plain(w.name) === plain(name));
  if (!ws) throw new Error(`O arquivo não parece a planilha de precificação: falta a aba "${name}".`);
  return ws;
}

/** Linha (1-based) cuja coluna tem o rótulo; prefix = começa com. */
function findRow(ws: ExcelJS.Worksheet, col: number, label: string, prefix = false): number | null {
  const want = plain(label);
  for (let r = 1; r <= ws.rowCount; r++) {
    const t = plain(text(ws.getCell(r, col)));
    if (prefix ? t.startsWith(want) : t === want) return r;
  }
  return null;
}

export async function parsePricingSheet(file: Buffer): Promise<PricingSheet> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(file as never); } catch { throw new Error('Não consegui abrir o arquivo. Baixe a planilha do Google como .xlsx (Arquivo → Fazer download → Microsoft Excel).'); }
  const warnings: string[] = [];
  const esc = sheet(wb, 'Escopo');
  const D = 4, E = 5, H = 8, I = 9, J = 10, K = 11, L = 12;

  const hdr = findRow(esc, D, 'Nome do projeto');
  if (!hdr) throw new Error('A aba Escopo não tem "Nome do projeto": não parece a planilha de precificação.');
  const after = (label: string) => { const r = findRow(esc, D, label, true); return r ? text(esc.getCell(r + 1, D)).trim() : ''; };

  const stages: PricingSheet['stages'] = [];
  let current: PricingSheet['stages'][number] | null = null;
  let solutionName = '';
  for (let r = hdr + 1; r <= esc.rowCount; r++) {
    const d = text(esc.getCell(r, D)).trim();
    if (plain(d) === 'nome da etapa') {
      const name = text(esc.getCell(r, E)).trim();
      current = name ? { name, consultants: num(esc.getCell(r, H)) ?? 0, days: num(esc.getCell(r, J)) ?? 0, activities: [] } : null;
      if (current) { stages.push(current); solutionName ||= text(esc.getCell(r, L)).trim(); }
      continue;
    }
    const days = num(esc.getCell(r, I));
    if (current && d && days !== null && !/^(dias|atividades)/i.test(plain(d))) {
      const [first, ...rest] = d.split(/\r?\n/);
      const dod = text(esc.getCell(r, K)).replace(/^pronto quando \(dod\):\s*/i, '').trim();
      current.activities.push({ name: first.trim(), description: rest.join('\n').trim(), days, ...(dod ? { dod } : {}) });
    }
  }
  if (!stages.length) throw new Error('Nenhuma etapa preenchida na aba Escopo.');
  for (const s of stages) {
    const sum = s.activities.reduce((a, x) => a + x.days, 0);
    if (sum !== s.days) warnings.push(`Etapa "${s.name}": as atividades somam ${sum} dias, mas a etapa diz ${s.days}. Vale o total das atividades.`);
    if (!s.consultants) warnings.push(`Etapa "${s.name}": sem número de consultores; considerei 1.`);
  }

  const fer = sheet(wb, 'Ferramenta');
  const C = 3, Dc = 4;
  const label = (l: string) => { const r = findRow(fer, C, l); return r ? text(fer.getCell(r, Dc)).trim() : ''; };
  const pick = (table: Record<string, string>, value: string, what: string, fallback: string) => {
    const k = table[plain(value)];
    if (!k) { if (value) warnings.push(`${what} "${value}" não reconhecido; usei o padrão.`); return fallback; }
    return k;
  };
  const outs = Object.entries(OUTSOURCING).filter(([n]) => { const r = findRow(fer, C, n); return r ? /^(true|verdadeiro|1)$/i.test(text(fer.getCell(r, Dc))) : false; }).map(([, k]) => k);
  if (outs.length > 1) warnings.push('Mais de uma terceirização marcada; usei "Múltiplas".');
  const capRow = findRow(fer, C, 'Capacidade produtiva');
  const valueRow = findRow(fer, C, 'VALOR FINAL:');
  const hasRef = [capRow].some(r => r && /#REF/i.test(text(fer.getCell(r, Dc))));
  if (hasRef) warnings.push('A planilha tem células com #REF! (parâmetros quebrados): o preço dela está errado. O preço desta proposta é o calculado pela plataforma.');

  let externalCostsCents = 0;
  const cus = wb.worksheets.find(w => plain(w.name) === 'custos');
  if (cus) {
    const r = findRow(cus, C, 'TOTAL DOS CUSTOS');
    const v = r ? num(cus.getCell(r, 7)) : null;
    if (v === null) warnings.push('Não achei o "TOTAL DOS CUSTOS" na aba Custos; custos externos ficaram zerados.');
    else externalCostsCents = Math.round(v * 100);
  } else warnings.push('Sem aba Custos; custos externos ficaram zerados.');

  const managers = num(esc.getCell(hdr + 1, 7)) ?? 1;
  return {
    project: text(esc.getCell(hdr + 1, D)).trim(),
    solutionName,
    managers,
    front: text(esc.getCell(hdr + 1, K)).trim(),
    diagnosis: { dores: after('Dores'), objetivo: after('Principal objetivo'), indicadores: after('Indicadores') },
    stages,
    pricing: {
      size: pick(SIZE, label('Porte da Empresa'), 'Porte', 'ME'),
      payment: pick(PAYMENT, label('Forma de pagamento'), 'Forma de pagamento', 'BOLETO'),
      channel: pick(CHANNEL, label('Captação'), 'Captação', 'INBOUND'),
      modality: pick(MODALITY, label('Modalidade'), 'Modalidade', 'PRESENCIAL'),
      discount: pick(DISCOUNT, label('Iniciativa/Descontos'), 'Desconto', 'NENHUM'),
      outsourcing: outs.length > 1 ? 'MULTIPLAS' : outs[0] ?? 'NENHUMA',
    },
    externalCostsCents,
    sheetPriceCents: valueRow ? (v => (v === null ? null : Math.round(v * 100)))(num(fer.getCell(valueRow, Dc))) : null,
    warnings,
  };
}
