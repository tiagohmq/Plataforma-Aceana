import type { FastifyRequest } from 'fastify';
import type { Db } from '../db/client.ts';
import { can, type Capability, type Role } from '../domain/permissions.ts';
import { ForbiddenError, UnauthorizedError } from './errors.ts';

export interface User { id: string; name: string; role: Role }

declare module 'fastify' {
  interface FastifyRequest { user: User | null }
}

/** Auth mock: o usuário vem do header X-User-Id (seletor "Entrar como" do v14). Produção troca por login institucional. */
export async function resolveUser(db: Db, req: FastifyRequest): Promise<User | null> {
  const id = req.headers['x-user-id'];
  if (typeof id !== 'string' || !id) return null;
  const r = await db.query<User>('select id, name, role from users where id = $1 and active', [id]);
  return r.rows[0] ?? null;
}

export function requireUser(req: FastifyRequest): User {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export function requireCap(req: FastifyRequest, cap: Capability): User {
  const u = requireUser(req);
  if (!can(u.role, cap)) throw new ForbiddenError();
  return u;
}
