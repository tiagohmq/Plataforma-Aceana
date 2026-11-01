import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Route } from '../app.ts';
import { requireCap, requireUser } from '../auth.ts';
import { BusinessError, NotFoundError } from '../errors.ts';
import { bootstrap } from '../../modules/ui.ts';
import { enqueueJob } from '../../jobs/queue.ts';

const PAGE = fileURLToPath(new URL('../../../web/plataforma-aceana-v14.html', import.meta.url));
const ADAPTER = fileURLToPath(new URL('../../../web/app.js', import.meta.url));

export const uiRoutes: Route = (app, { db, connectors, demo }) => {
  // Lidos a cada pedido: editar o front não exige reiniciar o servidor.
  app.get('/', async (_req, reply) => reply.header('cache-control', 'no-store').type('text/html; charset=utf-8').send(readFileSync(PAGE, 'utf8')));
  app.get('/app.js', async (_req, reply) => reply.header('cache-control', 'no-store').type('text/javascript; charset=utf-8').send(readFileSync(ADAPTER, 'utf8')));

  app.get('/api/ui/bootstrap', async req => bootstrap(db, requireUser(req)));

  if (!demo) return;

  // Só para a demonstração (DEMO_MODE=1): o navegador não tem o segredo do HMAC do Clicksign.
  app.post('/api/demo/simulate-sign', async req => {
    requireUser(req);
    const { proposalId, signer } = z.object({ proposalId: z.string(), signer: z.enum(['client', 'ace', 'witness']) }).parse(req.body);
    const r = await db.query<{ contract_id: string; envelope_id: string | null; content: { signers: Record<string, { email: string }> } }>(
      'select cs.contract_id, cs.envelope_id, c.content from contracts c join contract_status cs on cs.contract_id = c.id where c.proposal_id = $1 order by c.created_at desc limit 1', [proposalId]);
    const c = r.rows[0];
    if (!c) throw new NotFoundError('Contrato não encontrado.');
    if (!c.envelope_id) throw new BusinessError('SEM_ENVELOPE', 'Informe o envelope do Clicksign antes de simular a assinatura.');
    const email = c.content.signers[signer]?.email;
    await enqueueJob(db, {
      type: 'clicksign.event', idempotencyKey: `demo:${c.contract_id}:${signer}`,
      payload: { name: 'sign', envelopeId: c.envelope_id, signerEmail: email, occurredAt: new Date().toISOString() },
    });
    return { ok: true };
  });

  app.post('/api/demo/fail-next', async req => {
    requireCap(req, 'admin');
    const { connector } = z.object({ connector: z.enum(['pipedrive', 'monday']) }).parse(req.body);
    (connectors[connector] as unknown as { failNext: number }).failNext = 1;
    return { ok: true };
  });
};
