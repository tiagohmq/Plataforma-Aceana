import { createHash } from 'node:crypto';
import type { Route } from '../app.ts';
import { requireCap, requireUser } from '../auth.ts';
import { UnauthorizedError, NotFoundError } from '../errors.ts';
import { verifyClicksignHmac } from '../../domain/hmac.ts';
import { enqueueJob } from '../../jobs/queue.ts';
import { retryJob } from '../../jobs/worker.ts';
import { getHandoff } from '../../modules/handoff.ts';
import { recordAudit } from '../../modules/audit.ts';

export const webhookRoutes: Route = (app, { db, secrets }) => {
  // Padrão dos webhooks: valida, grava o evento e responde 2xx na hora; o processamento é da fila.
  app.post('/api/webhooks/clicksign', async req => {
    const raw = (req as { rawBody?: Buffer }).rawBody ?? Buffer.from('');
    const header = req.headers['content-hmac'];
    if (!verifyClicksignHmac(raw, typeof header === 'string' ? header : undefined, secrets.clicksignHmac ?? '')) throw new UnauthorizedError('Assinatura do webhook inválida.');
    const b = (req.body ?? {}) as { event?: { name?: string; occurred_at?: string }; envelope?: { id?: string }; signer?: { email?: string } };
    // Só o necessário entra na fila: nada de documento, nome ou dados pessoais do signatário.
    const payload = { name: String(b.event?.name ?? ''), envelopeId: String(b.envelope?.id ?? ''), signerEmail: b.signer?.email ?? null, occurredAt: b.event?.occurred_at ?? null };
    await enqueueJob(db, { type: 'clicksign.event', idempotencyKey: `clicksign:${createHash('sha256').update(raw).digest('hex')}`, payload });
    return { ok: true };
  });

  app.get('/api/jobs', async req => {
    requireCap(req, 'admin');
    return (await db.query("select id, type, status, attempts, last_error, to_char(next_at, 'YYYY-MM-DD\"T\"HH24:MI:SS') as next_at, created_at from jobs order by created_at desc limit 200")).rows;
  });

  app.post<{ Params: { id: string } }>('/api/jobs/:id/retry', async req => {
    const u = requireCap(req, 'admin');
    if (!(await retryJob(db, req.params.id))) throw new NotFoundError('Job não encontrado ou já concluído.');
    await recordAudit(db, { actorId: u.id, entity: 'jobs', entityId: req.params.id, action: 'job.retry' });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/proposals/:id/handoff', async req => getHandoff(db, requireUser(req), req.params.id));
};
