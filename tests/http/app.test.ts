import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testApp } from '../app-helper.ts';

let app: FastifyInstance;
beforeAll(async () => { app = (await testApp()).app; });

const as = (user: string) => ({ 'x-user-id': user });

describe('API base', () => {
  it('sem usuário → 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/me' });
    expect(r.statusCode).toBe(401);
  });

  it('GN identificado', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/me', headers: as('larissa') });
    expect(r.statusCode).toBe(200);
    expect(r.json().role).toBe('GN');
  });

  it('GP não vê parâmetros (margem)', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/params/active', headers: as('clara') });
    expect(r.statusCode).toBe(403);
  });

  it('GN não publica parâmetros; DP publica', async () => {
    const cur = (await app.inject({ method: 'GET', url: '/api/params/active', headers: as('dp') })).json();
    const gn = await app.inject({ method: 'POST', url: '/api/params', headers: as('larissa'), payload: cur.values });
    expect(gn.statusCode).toBe(403);
    const dp = await app.inject({ method: 'POST', url: '/api/params', headers: as('dp'), payload: { ...cur.values, hourCost: 30 } });
    expect(dp.statusCode).toBe(201);
    expect(dp.json().version).toBe(cur.version + 1);
  });

  it('parâmetro inválido → 400', async () => {
    const cur = (await app.inject({ method: 'GET', url: '/api/params/active', headers: as('dp') })).json();
    const r = await app.inject({ method: 'POST', url: '/api/params', headers: as('dp'), payload: { ...cur.values, greenMin: 2 } });
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toBeTruthy();
  });

  it('catálogo disponível para qualquer perfil', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/catalog', headers: as('clara') });
    expect(r.statusCode).toBe(200);
    expect(r.json().solutions).toHaveLength(31);
  });

  it('erro de negócio sai como 409 {erro, codigo}', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/_test/business-error', headers: as('larissa') });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ erro: 'Regra de teste', codigo: 'TESTE' });
  });
});
