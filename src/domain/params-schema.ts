import { z } from 'zod';

const frac = z.number().min(0).max(1);
const mult = z.number().positive();

/** Formato de uma versão de parâmetros (spec §6). Os valores ficam só na semente e no banco. */
export const ParamsSchema = z.object({
  hourCost: z.number().positive(),
  tax: frac,
  plannedHoursPerMemberDay: z.number().positive(),
  salesTime: frac,
  backoffice: frac,
  floorPerMemberDay: z.number().nonnegative(),
  floorStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  greenMin: frac,
  yellowMin: frac,
  externalCostAlert: frac,
  clientValidationDays: z.number().int().positive(),
  proposalValidityDays: z.number().int().positive(),
  maxInstallmentsDivisor: z.number().int().positive(),
  formExpiryHours: z.number().int().positive(),
  hoursPerConsultantDay: z.number().positive(),
  hoursPerManagerDay: z.number().positive(),
  contingency: mult,
  iss: mult,
  expectedFactor: mult,
  maxFactor: mult,
  multipliers: z.object({
    complexity: z.record(z.string(), mult),
    consultants: z.record(z.string(), mult),
    consultantsMaxKey: z.string(),
    capacity: z.array(z.object({ upTo: z.number().nullable(), mult })).min(1),
    size: z.record(z.string(), mult),
    payment: z.record(z.string(), mult),
    channel: z.record(z.string(), mult),
    modality: z.record(z.string(), mult),
    discount: z.record(z.string(), mult),
    outsourcing: z.record(z.string(), mult),
  }),
}).refine(p => p.yellowMin <= p.greenMin, { message: 'amarelo precisa ser menor ou igual ao verde' });

export type Params = z.infer<typeof ParamsSchema>;
