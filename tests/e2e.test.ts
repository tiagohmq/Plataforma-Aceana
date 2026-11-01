import { it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { createConnectors } from '../src/connectors/index.ts';
import type { MondayMock } from '../src/connectors/monday/mock.ts';
import { runDueJobs } from '../src/jobs/worker.ts';
import { testApp, TEST_SECRETS } from './app-helper.ts';
import { api, as, versionBody, FORM } from './fixtures.ts';

// Roteiro da demo (docs/roteiro-demo.md), ponta a ponta, com cliente fictício.
it('do diagnóstico ao projeto iniciado', async () => {
  let clock = new Date('2026-11-05T13:00:00Z');
  const tick = () => (clock = new Date(clock.getTime() + 60000));
  const connectors = createConnectors({});
  const { app, db } = await testApp({ connectors, now: () => clock });
  const a = api(app);
  const ok = (r: { statusCode: number; body: string }, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };

  // 1. Deal em "Diagnóstico realizado" vira proposta v1
  const p = ok(await a.importDeal('2018'), 201).json();
  // 2. GN monta escopo e preço (v2) e aprova dentro da regra
  ok(await a.newVersion(p.id, 1), 201);
  ok(await a.approve(p.id, 2, 'larissa'), 201);
  // 3. Envia: link do cliente e deal em "Proposta apresentada"
  const sent = ok(await a.send(p.id)).json();
  await runDueJobs(db, connectors, tick());
  expect((await connectors.pipedrive.getDeal('2018')).stage).toBe('Proposta apresentada');
  const pub = ok(await app.inject({ method: 'GET', url: sent.publicUrl })).json();
  expect(pub.valueCents).toBe(1500000);
  // 4. Positiva: registra valor vendido (v3) e aprova
  ok(await a.newVersion(p.id, 2, versionBody({ soldCents: 1500000 })), 201);
  ok(await a.approve(p.id, 3, 'larissa'), 201);
  // 5. Formulário do cliente
  const form = ok(await app.inject({ method: 'POST', url: `/api/proposals/${p.id}/contract-form`, headers: as('larissa') }), 201).json();
  const token = form.url.split('/').pop();
  ok(await app.inject({ method: 'POST', url: `/api/forms/${token}`, payload: FORM }));
  await runDueJobs(db, connectors, tick());
  // 6. Contrato gerado, conferido e aprovado; envelope informado
  const c = ok(await app.inject({ method: 'POST', url: `/api/proposals/${p.id}/contract`, headers: as('larissa'), payload: { exclusoes: ['Implantação de software'], reunioes: 6 } }), 201).json();
  ok(await app.inject({ method: 'POST', url: `/api/contracts/${c.id}/approvals`, headers: as('larissa'), payload: { decision: 'APROVADA' } }), 201);
  ok(await app.inject({ method: 'POST', url: `/api/contracts/${c.id}/envelope`, headers: as('larissa'), payload: { envelopeId: 'env-demo-1' } }));
  // 7. Cliente assina no Clicksign (webhook com HMAC)
  const body = JSON.stringify({ event: { name: 'sign', occurred_at: clock.toISOString() }, envelope: { id: 'env-demo-1' }, signer: { email: FORM.emailSignatario } });
  ok(await app.inject({
    method: 'POST', url: '/api/webhooks/clicksign', payload: body,
    headers: { 'content-type': 'application/json', 'content-hmac': 'sha256=' + createHmac('sha256', TEST_SECRETS.clicksignHmac).update(body).digest('hex') },
  }));
  for (let i = 0; i < 3; i++) await runDueJobs(db, connectors, tick());
  // 8. Deal ganho, um projeto no Monday, pasta no Drive, pacote de passagem para o GP
  expect((await connectors.pipedrive.getDeal('2018')).status).toBe('won');
  expect((connectors.monday as MondayMock).items.size).toBe(1);
  const h = ok(await app.inject({ method: 'GET', url: `/api/proposals/${p.id}/handoff`, headers: as('clara') })).json();
  expect(h.mondayItemId).toBeTruthy();
  expect(h.driveFolder).toBeTruthy();
  expect(h.contract.status).toBe('ASSINADO_CLIENTE');
  // Auditoria com a sequência inteira
  const actions = (await db.query<{ action: string }>('select action from audit_events order by created_at')).rows.map(r => r.action);
  expect(actions).toEqual(expect.arrayContaining([
    'proposal.import', 'proposal.version', 'approval.decide', 'proposal.send', 'contract.form_link', 'contract.form_submitted',
    'contract.generate', 'contract.approve', 'contract.envelope', 'clicksign.sign',
  ]));
  const failed = await db.query("select type, last_error from jobs where status <> 'done'");
  expect(failed.rows).toEqual([]);
}, 120000); // fluxo inteiro: mais lento que os testes unitários, sobretudo com a suíte em paralelo
