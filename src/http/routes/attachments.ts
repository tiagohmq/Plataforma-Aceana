import type { Route } from '../app.ts';
import { requireUser } from '../auth.ts';
import { attachProposal, publicPdf } from '../../modules/attachments.ts';

export const attachmentRoutes: Route = (app, { db }) => {
  // PDF em base64 (até 25 MB) ou link do Canva.
  app.post<{ Params: { id: string } }>('/api/proposals/:id/attachment', { bodyLimit: 25 * 1024 * 1024 }, async (req, reply) =>
    reply.code(201).send(await attachProposal(db, requireUser(req), req.params.id, req.body)));

  // PDF da versão enviada, aberto pelo cliente a partir do link público (token aleatório).
  app.get<{ Params: { token: string } }>('/api/public/proposals/:token/pdf', async (req, reply) => {
    const f = await publicPdf(db, req.params.token);
    return reply.header('content-disposition', `inline; filename="${f.filename.replace(/[^\w.\- ]/g, '_')}"`).type('application/pdf').send(f.data);
  });
};
