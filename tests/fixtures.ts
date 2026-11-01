import type { FastifyInstance } from 'fastify';

export const as = (user: string) => ({ 'x-user-id': user });

/** Corpo de versão válido: SOL-017, 60 dias, 2 consultores + GP, R$ 15.000 em 3 parcelas (verde, sem exceção). */
export const versionBody = (over: Record<string, unknown> = {}) => ({
  scope: { solutionCode: 'SOL-017', stages: [{ name: 'Start', days: 10, consultants: 2 }, { name: 'Imersão', days: 50, consultants: 2 }] },
  managers: 1,
  externalCostsCents: 0,
  pricing: { complexity: 3, size: 'ME', payment: 'BOLETO', channel: 'INBOUND', modality: 'PRESENCIAL', discount: 'NENHUM', outsourcing: 'NENHUMA' },
  presentedCents: 1500000,
  installments: 3,
  ...over,
});

export const api = (app: FastifyInstance) => ({
  importDeal: (dealId = '2018', user = 'larissa') =>
    app.inject({ method: 'POST', url: `/api/deals/${dealId}/import`, headers: as(user) }),
  newVersion: (id: string, expected: number, body: object = versionBody(), user = 'larissa') =>
    app.inject({ method: 'POST', url: `/api/proposals/${id}/versions`, headers: as(user), payload: { ...body, expectedCurrentNumber: expected } }),
  approve: (id: string, versionNumber: number, user: string, decision = 'APROVADA') =>
    app.inject({ method: 'POST', url: `/api/proposals/${id}/approvals`, headers: as(user), payload: { versionNumber, decision } }),
  requestException: (id: string, versionNumber: number, user: string) =>
    app.inject({ method: 'POST', url: `/api/proposals/${id}/exception-requests`, headers: as(user), payload: { versionNumber, reason: 'Cliente estratégico' } }),
  send: (id: string, user = 'larissa') =>
    app.inject({ method: 'POST', url: `/api/proposals/${id}/send`, headers: as(user) }),
});
