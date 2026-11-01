import type { Params } from './params-schema.ts';
import { mulCents } from './money.ts';

export type Light = 'verde' | 'amarelo' | 'vermelho';
export type MarginAlert = 'EXTERNAL_COST' | 'BELOW_FLOOR';

export interface MarginInput {
  valueCents: number;        // V: apresentado antes da venda, vendido depois
  externalCostsCents: number; // C
  days: number;              // d
  members: number;           // m = consultores + GP
}

export interface Margins {
  cashCents: number;
  plannedHours: number;
  contributionCents: number;
  contributionPct: number | null;
  totalResultCents: number;
  totalResultPct: number | null;
  floorCents: number;
  light: Light;
  alerts: MarginAlert[];
  requiresException: boolean;
}

/** Margem prevista, piso e semáforo (spec §7). O semáforo usa o % de contribuição. */
export function computeMargins(i: MarginInput, p: Params): Margins {
  const V = i.valueCents;
  const cashCents = V - mulCents(V, p.tax) - i.externalCostsCents;
  const plannedHours = i.days * i.members * p.plannedHoursPerMemberDay;
  const contributionCents = cashCents - Math.round(plannedHours * p.hourCost * 100);
  const totalResultCents = contributionCents - mulCents(V, p.salesTime) - mulCents(V, p.backoffice);
  const floorCents = Math.round(i.days * i.members * p.floorPerMemberDay * 100);

  const contributionPct = V > 0 ? contributionCents / V : null;
  const totalResultPct = V > 0 ? totalResultCents / V : null;

  const light: Light = contributionPct === null ? 'vermelho'
    : contributionPct >= p.greenMin ? 'verde'
    : contributionPct >= p.yellowMin ? 'amarelo'
    : 'vermelho';

  const alerts: MarginAlert[] = [];
  if (i.externalCostsCents > mulCents(V, p.externalCostAlert)) alerts.push('EXTERNAL_COST');
  if (V < floorCents) alerts.push('BELOW_FLOOR');

  const requiresException = V < floorCents || contributionPct === null || contributionPct < p.yellowMin;

  return { cashCents, plannedHours, contributionCents, contributionPct, totalResultCents, totalResultPct, floorCents, light, alerts, requiresException };
}
