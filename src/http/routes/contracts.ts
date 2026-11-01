import type { Route } from '../app.ts';
import { requireUser } from '../auth.ts';
import { createContractForm, getForm, submitForm, generateContract, approveContract, setEnvelope, readPersonal } from '../../modules/contracts.ts';

export const contractRoutes: Route = (app, { db, now, connectors, secrets }) => {
  app.post<{ Params: { id: string } }>('/api/proposals/:id/contract-form', async (req, reply) =>
    reply.code(201).send(await createContractForm(db, requireUser(req), req.params.id, now())));

  // Formulário do cliente: público, protegido só pelo token de uso único.
  app.get<{ Params: { token: string } }>('/api/forms/:token', async req => getForm(db, req.params.token, now()));
  app.post<{ Params: { token: string } }>('/api/forms/:token', async req => {
    await submitForm(db, secrets.contractKey, req.params.token, req.body, now());
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/proposals/:id/contract', async (req, reply) =>
    reply.code(201).send(await generateContract(db, connectors, secrets.contractKey, requireUser(req), req.params.id, req.body, now())));

  app.post<{ Params: { id: string } }>('/api/contracts/:id/approvals', async (req, reply) =>
    reply.code(201).send(await approveContract(db, requireUser(req), req.params.id, req.body)));

  app.post<{ Params: { id: string } }>('/api/contracts/:id/envelope', async req =>
    setEnvelope(db, requireUser(req), req.params.id, req.body));

  app.get<{ Params: { id: string } }>('/api/contracts/:id/personal', async req =>
    readPersonal(db, secrets.contractKey, requireUser(req), req.params.id));
};
