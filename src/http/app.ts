import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Db } from '../db/client.ts';
import { resolveUser, requireUser, requireCap } from './auth.ts';
import { BusinessError, ForbiddenError, GoneError, NotFoundError, UnauthorizedError } from './errors.ts';
import { getActiveParams, publishParams } from '../modules/parameters.ts';
import { getActiveCatalog } from '../modules/catalog.ts';
import type { Params } from '../domain/params-schema.ts';

export interface AppDeps {
  db: Db;
  now?: () => Date;
  testRoutes?: boolean;
}

export type Route = (app: FastifyInstance, deps: Required<Pick<AppDeps, 'db' | 'now'>>) => void;

/** Monta a API sem abrir porta (testes usam app.inject). */
export async function buildApp(deps: AppDeps, routes: Route[] = []): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const ctx = { db: deps.db, now: deps.now ?? (() => new Date()) };

  app.decorateRequest('user', null);
  app.addHook('onRequest', async req => { req.user = await resolveUser(deps.db, req); });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof BusinessError) return reply.code(409).send({ erro: err.message, codigo: err.codigo });
    if (err instanceof ForbiddenError) return reply.code(403).send({ erro: err.message });
    if (err instanceof UnauthorizedError) return reply.code(401).send({ erro: err.message });
    if (err instanceof NotFoundError) return reply.code(404).send({ erro: err.message });
    if (err instanceof GoneError) return reply.code(410).send({ erro: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ erro: 'Dados inválidos.', detalhes: err.issues.map(i => `${i.path.join('.')}: ${i.message}`) });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.code(status).send({ erro: (err as Error).message });
    return reply.code(500).send({ erro: 'Erro interno.' });
  });

  app.get('/api/me', async req => requireUser(req));

  app.get('/api/params/active', async req => {
    requireCap(req, 'margin.view');
    return getActiveParams(deps.db);
  });

  app.post('/api/params', async (req, reply) => {
    const u = requireCap(req, 'params.publish');
    const out = await publishParams(deps.db, u.id, req.body as Params);
    return reply.code(201).send(out);
  });

  app.get('/api/catalog', async req => {
    requireUser(req);
    return getActiveCatalog(deps.db);
  });

  if (deps.testRoutes) {
    app.get('/api/_test/business-error', async () => { throw new BusinessError('TESTE', 'Regra de teste'); });
  }

  for (const r of routes) r(app, ctx);
  return app;
}
