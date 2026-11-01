import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const html = read('../../web/plataforma-aceana-v14.html');
const adapter = read('../../web/app.js');
const front = html + '\n' + adapter;

it('front carrega o adaptador da API', () => {
  expect(html).toContain('<script src="/app.js"></script>');
  expect(adapter).toContain('/api/ui/bootstrap');
});

it('nenhum parâmetro financeiro no front (tabela única no servidor)', () => {
  // hora/piso/verde/imp com zero são só o estado antes da carga da API
  const hits = [/23[.,]45/, /24[.,]28/, /24[.,]29/, /\.0576/, /hora:\s*\.?[1-9]/, /piso:\s*\.?[1-9]/, /verde:\s*\.?[1-9]/, /imp:\s*\.?[1-9]/, /2[.,]99794/, /5[.,]03333/]
    .filter(r => r.test(front)).map(String);
  expect(hits).toEqual([]);
});

it('nenhuma fórmula de margem ou preço no front', () => {
  const hits = [/\*\s*P\.(imp|hora|piso|venda|back|hmd)\b/, /\bV\s*\*\s*P\./, /K\.hora\s*\*/, /capF\s*=/, /contrib\s*=\s*caixa/]
    .filter(r => r.test(front)).map(String);
  expect(hits).toEqual([]);
});

it('mantém visual: tokens escuros e shader da landing', () => {
  expect(html).toContain('--yellow:#FFD000');
  expect(html).toContain('function syncFx()');
});
