import type { Params } from '../../domain/params-schema.ts';

// Única fonte dos valores financeiros (spec §6). Fontes entre parênteses.
const multipliers: Params['multipliers'] = {
  complexity: { '1': 1.0, '2': 1.05, '3': 1.1, '4': 1.15, '5': 1.2 }, // planilha Russa, aba Parâmetros
  consultants: { '1': 1.0, '2': 1.05, '3': 1.1, '4': 1.15, '5': 1.2 }, // planilha Russa, aba Premissas
  consultantsMaxKey: '5', // 5 ou mais consultores usam esta chave (sem ISS: correção da planilha)
  capacity: [ // contexto §9.3
    { upTo: 0.65, mult: 1.0 },
    { upTo: 0.75, mult: 1.05 },
    { upTo: 0.85, mult: 1.125 },
    { upTo: null, mult: 1.175 },
  ],
  size: { ME: 1.0, EPP: 1.05, MEDIO: 1.1, GRANDE: 1.13 },
  payment: { CARTAO: 1.0325, BOLETO: 1.0, A_VISTA: 1.0 },
  channel: { DIGITAL: 1.05, OUTBOUND: 1.025, INBOUND: 1.0, MEJ: 1.0 },
  modality: { PRESENCIAL: 1.0, HIBRIDO: 0.9, REMOTO: 0.85 },
  discount: { NENHUM: 1.0, BLACK_NOVEMBER: 0.85, DIA_CONSUMIDOR: 0.8725, INDICACAO: 0.85, INOVACAO: 0.85 },
  outsourcing: { NENHUMA: 1.0, COMPLETA: 1.35, RAY: 1.125, ION: 1.075, ORBIT: 1.125, MEJ: 1.115, ODD: 1.0, FALAE: 1.2, MULTIPLAS: 1.15 },
};

const common = {
  tax: 0.05, // briefing
  plannedHoursPerMemberDay: 1.0, // briefing
  salesTime: 0.1, // briefing
  backoffice: 0.05764, // Parâmetros Únicos v0 (decisão 01/11)
  floorPerMemberDay: 75, // briefing
  floorStartDate: '2026-10-01', // briefing
  greenMin: 0.55, // Parâmetros Únicos v0
  yellowMin: 0.3, // Parâmetros Únicos v0
  externalCostAlert: 0.15, // briefing
  clientValidationDays: 5, // briefing
  proposalValidityDays: 15, // HIPÓTESE (protótipo v0.1)
  maxInstallmentsDivisor: 20, // HIPÓTESE (planilha Disalp)
  formExpiryHours: 72, // HIPÓTESE
  hoursPerManagerDay: 5.033333333, // planilha de capacidade
  contingency: 1.2, // contexto §9.3
  iss: 1.05, // contexto §9.3
  expectedFactor: 1.1, // contexto §9.3
  maxFactor: 1.2, // contexto §9.3
  multipliers,
};

export const PARAMETER_SEEDS: { version: number; origin: string; values: Params }[] = [
  {
    version: 1,
    origin: 'Rentabilidade v5.0 / Parâmetros Únicos v0 (histórico)',
    values: { ...common, hourCost: 24.2884, hoursPerConsultantDay: 2.915897436 },
  },
  {
    version: 2,
    origin: 'Decisão de 31/10 (custo da hora) + capacidade de 30/10',
    values: { ...common, hourCost: 23.45, hoursPerConsultantDay: 2.997948718 },
  },
];
