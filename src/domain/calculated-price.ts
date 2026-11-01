import type { Params } from './params-schema.ts';
import { mulCents } from './money.ts';

export interface CalcInput {
  stages: { days: number; consultants: number }[];
  complexity: 1 | 2 | 3 | 4 | 5;
  capacity: number; // capacidade produtiva, fração (0,7684 = 76,84%)
  size: string;
  payment: string;
  channel: string;
  modality: string;
  discount: string;
  outsourcing: string;
  externalCostsCents: number;
}

export interface CalcResult {
  minimumCents: number;
  adjustedCents: number;
  finalCents: number;
  expectedCents: number;
  maxCents: number;
  memory: { label: string; factor: number }[];
}

function pick(table: Record<string, number>, key: string, what: string): number {
  const v = table[key];
  if (v === undefined) throw new Error(`${what} sem multiplicador: ${key}`);
  return v;
}

/**
 * Preço calculado pela planilha de precificação (spec §7, planilha Russa), com duas correções:
 * ISS só no fim (não dentro do fator de 5+ consultores) e soma de todas as etapas.
 */
export function computeCalculatedPrice(i: CalcInput, p: Params): CalcResult {
  const mm = p.multipliers;
  const memory: CalcResult['memory'] = [];
  const complexity = pick(mm.complexity, String(i.complexity), 'complexidade');
  const capacity = (mm.capacity.find(b => b.upTo === null || i.capacity <= b.upTo) ?? mm.capacity[mm.capacity.length - 1]).mult;
  const dayConsultant = p.hoursPerConsultantDay * p.hourCost;
  const dayManager = p.hoursPerManagerDay * p.hourCost;
  memory.push({ label: 'complexidade', factor: complexity }, { label: 'capacidade produtiva', factor: capacity });

  let minimum = 0; // em reais, sem arredondar entre etapas (como a planilha)
  for (const s of i.stages) {
    const key = s.consultants >= Number(mm.consultantsMaxKey) ? mm.consultantsMaxKey : String(s.consultants);
    const consultants = pick(mm.consultants, key, 'número de consultores');
    memory.push({ label: `consultores (${s.consultants})`, factor: consultants });
    minimum += complexity * (s.days * s.consultants * dayConsultant + s.days * dayManager) * consultants * capacity;
  }
  const minimumCents = Math.round(minimum * 100);

  const factors: [string, number][] = [
    ['porte', pick(mm.size, i.size, 'porte')],
    ['pagamento', pick(mm.payment, i.payment, 'forma de pagamento')],
    ['captação', pick(mm.channel, i.channel, 'captação')],
    ['modalidade', pick(mm.modality, i.modality, 'modalidade')],
    ['desconto', pick(mm.discount, i.discount, 'desconto')],
  ];
  let adjusted = minimum;
  for (const [label, f] of factors) { adjusted *= f; memory.push({ label, factor: f }); }
  const adjustedCents = Math.round(adjusted * 100);

  const outsourcing = pick(mm.outsourcing, i.outsourcing, 'terceirização');
  memory.push({ label: 'terceirização', factor: outsourcing }, { label: 'contingência', factor: p.contingency }, { label: 'ISS', factor: p.iss });
  const final = (i.externalCostsCents / 100 * outsourcing * p.contingency + adjusted * outsourcing) * p.iss;

  return {
    minimumCents,
    adjustedCents,
    finalCents: Math.round(final * 100),
    expectedCents: mulCents(minimumCents, p.expectedFactor),
    maxCents: mulCents(minimumCents, p.maxFactor),
    memory,
  };
}
