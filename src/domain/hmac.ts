import { createHmac, timingSafeEqual } from 'node:crypto';

/** Confere o header Content-Hmac ("sha256=<hex>") do Clicksign sobre o corpo bruto, em tempo constante. */
export function verifyClicksignHmac(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!header || !header.startsWith('sha256=') || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const got = Buffer.from(header.slice(7), 'hex');
  return got.length === expected.length && timingSafeEqual(got, expected);
}
