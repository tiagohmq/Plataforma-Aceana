import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Db } from '../db/client.ts';
import { resolveUser, requireUser, requireCap } from './auth.ts';
import { BusinessError, ForbiddenError, GoneError, NotFoundError, UnauthorizedError } from './errors.ts';
import { getActiveParams, publishParams } from '../modules/parameters.ts';
import { getActiveCatalog } from '../modules/catalog.ts';
import type { Params } from '../domain/params-schema.ts';
import { createConnectors, type Connectors } from '../connectors/index.ts';
import { proposalRoutes } from './routes/proposals.ts';
import { approvalRoutes } from './routes/approvals.ts';
import { webhookRoutes } from './routes/webhooks.ts';
import { contractRoutes } from './routes/contracts.ts';
import { uiRoutes } from './routes/ui.ts';
import { diagnosisRoutes } from './routes/diagnosis.ts';
import { attachmentRoutes } from './routes/attachments.ts';
import type { DiagnosisAI } from '../connectors/ai/interface.ts';

export interface Secrets { clicksignHmac?: string; contractKey?: Buffer }

export interface AppDeps {
  db: Db;
  now?: () => Date;
  connectors?: Connectors;
  secrets?: Secrets;
  demo?: boolean; // rotas /api/demo/* (DEMO_MODE=1)
  ai?: DiagnosisAI; // assistente de diagnóstico; ausente = IA desligada
  testRoutes?: boolean;
}

export interface RouteCtx { db: Db; now: () => Date; connectors: Connectors; secrets: Secrets; demo: boolean; ai?: DiagnosisAI }
export type Route = (app: FastifyInstance, ctx: RouteCtx) => void;

const ROUTES: Route[] = [proposalRoutes, approvalRoutes, webhookRoutes, contractRoutes, diagnosisRoutes, attachmentRoutes, uiRoutes];

/** Segredos vêm do .env (nunca do código). */
export function secretsFromEnv(env: Record<string, string | undefined> = process.env): Secrets {
  return {
    clicksignHmac: env.CLICKSIGN_HMAC_SECRET || undefined,
    contractKey: env.CONTRACT_KEY ? Buffer.from(env.CONTRACT_KEY, 'base64') : undefined,
  };
}

/** Monta a API sem abrir porta (testes usam app.inject). */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const ctx: RouteCtx = {
    db: deps.db, now: deps.now ?? (() => new Date()),
    connectors: deps.connectors ?? createConnectors(), secrets: deps.secrets ?? secretsFromEnv(), demo: !!deps.demo, ai: deps.ai,
  };

  // Guarda o corpo bruto: o HMAC do Clicksign é calculado sobre ele.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body: Buffer, done) => {
    (req as { rawBody?: Buffer }).rawBody = body;
    if (!body.length) return done(null, undefined);
    try { done(null, JSON.parse(body.toString('utf8'))); } catch { done(Object.assign(new Error('JSON inválido.'), { statusCode: 400 }), undefined); }
  });

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

  for (const r of ROUTES) r(app, ctx);
  return app;
}
