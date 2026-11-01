import type { Route } from '../app.ts';
import { requireUser } from '../auth.ts';
import { decide, requestException, sendProposal, getClientProposal } from '../../modules/approvals.ts';

export const approvalRoutes: Route = (app, { db, now }) => {
  app.post<{ Params: { id: string } }>('/api/proposals/:id/approvals', async (req, reply) =>
    reply.code(201).send(await decide(db, requireUser(req), req.params.id, req.body)));

  app.post<{ Params: { id: string } }>('/api/proposals/:id/exception-requests', async (req, reply) => {
    await requestException(db, requireUser(req), req.params.id, req.body);
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { id: string } }>('/api/proposals/:id/send', async req =>
    sendProposal(db, requireUser(req), req.params.id, now()));

  // Link público do cliente: sem login, só a visão filtrada.
  app.get<{ Params: { id: string } }>('/api/public/proposals/:id', async req => getClientProposal(db, req.params.id));
};
