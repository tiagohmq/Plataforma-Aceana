import ExcelJS from 'exceljs';

/**
 * Monta um .xlsx no formato das planilhas PLAN_Precificacao preenchidas pelo assistente de escopo
 * (abas Escopo, Ferramenta e Custos, mesmas células da planilha da Clínica Maluar). Dados fictícios.
 */
export async function buildPricingSheet(opts: { solution?: string; managers?: number; stageDays?: number; withRef?: boolean } = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const esc = wb.addWorksheet('Escopo');
  esc.getCell('B1').value = 'ESCOPO';
  esc.getCell('D6').value = 'Nome do projeto'; esc.getCell('G6').value = 'Nº Gerentes'; esc.getCell('I6').value = 'Dias'; esc.getCell('K6').value = 'Frente de atuação';
  esc.getCell('D7').value = 'Plano de Negócios – Clínica Exemplo'; esc.getCell('G7').value = opts.managers ?? 1; esc.getCell('I7').value = 10; esc.getCell('K7').value = 'Estratégia e Mercado';
  esc.getCell('D10').value = 'Dores Identificadas no cenário atual';
  esc.getCell('D11').value = 'A dona quer abrir uma clínica e não tem demanda validada. Contato: dona@exemplo.com, CPF 529.982.247-25.';
  esc.getCell('D13').value = 'Principal objetivo do cliente no projeto ou ganhos esperados';
  esc.getCell('D14').value = 'Decidir com base em dados se e como abrir a clínica.';
  esc.getCell('D16').value = 'Indicadores que serão acompanhados para comprovar os ganhos esperados';
  esc.getCell('D17').value = 'Ponto de equilíbrio, payback e VPL.';
  const stage = (row: number, name: string, consultants: number | '', days: number) => {
    esc.getCell(`D${row}`).value = 'Nome da etapa'; esc.getCell(`E${row}`).value = name;
    esc.getCell(`G${row}`).value = 'Consultores'; esc.getCell(`H${row}`).value = consultants;
    esc.getCell(`I${row}`).value = 'Dias'; esc.getCell(`J${row}`).value = days;
    esc.getCell(`K${row}`).value = 'Escopo'; if (name) esc.getCell(`L${row}`).value = opts.solution ?? 'Plano de Negócios';
  };
  const act = (row: number, text: string, days: number, dod?: string) => {
    esc.getCell(`D${row}`).value = text; esc.getCell(`I${row}`).value = days;
    if (dod) esc.getCell(`K${row}`).value = `Pronto quando (DoD): ${dod}`;
  };
  stage(21, 'Start · Ambientação', 2, opts.stageDays ?? 4);
  act(22, 'Estudos Iniciais\n\nO que entrega: base de conhecimento do segmento.', 3, 'Documento consolidado.');
  act(23, 'Reunião de Onboarding\n\nO que entrega: Canvas de Alinhamento.', 1, 'Canvas validado.');
  stage(30, 'Imersão e Análise · Pesquisa', 3, 6);
  act(31, 'Relatório de Mercado\n\nO que entrega: PESTEL e 5 Forças.', 4, 'Relatório validado.');
  act(32, 'Reunião Parcial de Validação 1', 2);
  stage(40, '', '', 0); // etapas vazias que o modelo da planilha sempre traz

  const fer = wb.addWorksheet('Ferramenta');
  fer.getCell('C5').value = 'VALOR FINAL: ';
  fer.getCell('D5').value = 12549.6;
  fer.getCell('C23').value = 'Porte da Empresa'; fer.getCell('D23').value = 'Empresa de Pequeno Porte (EPP)';
  fer.getCell('C24').value = 'Forma de pagamento'; fer.getCell('D24').value = 'Boleto';
  fer.getCell('C25').value = 'Captação'; fer.getCell('D25').value = 'Inbound';
  fer.getCell('C26').value = 'Modalidade'; fer.getCell('D26').value = 'Híbrido';
  fer.getCell('C27').value = 'Iniciativa/Descontos'; fer.getCell('D27').value = '*Margem para desconto';
  fer.getCell('C28').value = 'Capacidade produtiva'; fer.getCell('D28').value = opts.withRef ? { error: '#REF!' } as never : 0.7;
  fer.getCell('C31').value = 'Terceirização'; fer.getCell('D31').value = 'Realizado';
  for (const [i, n] of ['Terceirização completa', 'Ray', 'Íon', 'Orbit', 'MEJ', 'ODD', 'Falaê', 'Múltiplas'].entries()) {
    fer.getCell(`C${32 + i}`).value = n; fer.getCell(`D${32 + i}`).value = n === 'MEJ';
  }

  const cus = wb.addWorksheet('Custos');
  cus.getCell('C51').value = 'TOTAL DOS CUSTOS';
  cus.getCell('G51').value = { formula: 'SUM(G1:G50)', result: 9960 } as never;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
