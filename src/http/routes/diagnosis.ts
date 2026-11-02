import type { Route } from '../app.ts';
import { requireUser } from '../auth.ts';
import { analyzeTranscript, getDiagnosis } from '../../modules/diagnosis.ts';

export const diagnosisRoutes: Route = (app, { db, connectors, ai }) => {
  app.post<{ Params: { id: string } }>('/api/proposals/:id/diagnosis', async (req, reply) =>
    reply.code(201).send(await analyzeTranscript(db, connectors, ai, requireUser(req), req.params.id, req.body)));

  app.get<{ Params: { id: string } }>('/api/proposals/:id/diagnosis', async req => getDiagnosis(db, requireUser(req), req.params.id));
};
