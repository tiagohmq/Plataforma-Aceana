import type { Route } from '../app.ts';
import { requireUser } from '../auth.ts';
import { importDeal, createVersion, getProposal, getVersion, listProposals } from '../../modules/proposals.ts';

export const proposalRoutes: Route = (app, { db, now, connectors }) => {
  app.post<{ Params: { dealId: string } }>('/api/deals/:dealId/import', async (req, reply) => {
    const out = await importDeal(db, connectors, requireUser(req), req.params.dealId, now());
    return reply.code(out.created ? 201 : 200).send(out.proposal);
  });

  app.get('/api/proposals', async req => listProposals(db, requireUser(req)));

  app.get<{ Params: { id: string } }>('/api/proposals/:id', async req => getProposal(db, requireUser(req), req.params.id));

  app.get<{ Params: { id: string; n: string } }>('/api/proposals/:id/versions/:n', async req =>
    getVersion(db, requireUser(req), req.params.id, Number(req.params.n)));

  app.post<{ Params: { id: string } }>('/api/proposals/:id/versions', async (req, reply) =>
    reply.code(201).send(await createVersion(db, requireUser(req), req.params.id, req.body)));
};
