// Simula o webhook do Clicksign de "assinatura do cliente" contra o servidor local (demo).
// Uso: node scripts/simular-assinatura.mjs <envelopeId> <email do signatário> [porta]
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [envelopeId, email, port = process.env.PORT ?? '3333'] = process.argv.slice(2);
if (!envelopeId || !email) {
  console.error('Uso: node scripts/simular-assinatura.mjs <envelopeId> <email do signatário> [porta]');
  process.exit(1);
}
const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const secret = env.CLICKSIGN_HMAC_SECRET;
if (!secret) { console.error('CLICKSIGN_HMAC_SECRET ausente no .env'); process.exit(1); }

const body = JSON.stringify({ event: { name: 'sign', occurred_at: new Date().toISOString() }, envelope: { id: envelopeId }, signer: { email } });
const res = await fetch(`http://localhost:${port}/api/webhooks/clicksign`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'content-hmac': 'sha256=' + createHmac('sha256', secret).update(body).digest('hex') },
  body,
});
console.log(res.status, await res.text());
