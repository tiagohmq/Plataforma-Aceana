import { it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Parâmetros financeiros só podem existir na semente (spec §6). Este teste varre o resto do src/.
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const FORBIDDEN = ['23.45', '24.2884', '0.05764', '0.0576', '0.55', '0.15', '1.05', '1.025', '1.0325', '1.125', '1.175', '0.85', '0.8725'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return p.includes(join('db', 'seeds')) ? [] : files(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

it('nenhuma constante financeira fora da semente', () => {
  const hits: string[] = [];
  for (const f of files(SRC)) {
    const src = readFileSync(f, 'utf8');
    for (const lit of FORBIDDEN) {
      if (new RegExp(`(?<![\\d.])${lit.replace('.', '\\.')}(?![\\d])`).test(src)) hits.push(`${f}: ${lit}`);
    }
  }
  expect(hits).toEqual([]);
});
