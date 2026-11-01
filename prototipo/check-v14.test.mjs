// Verificação do redesign v14: o JS de negócio continua o do original, os tokens têm contraste AA
// e o CSS não tem cor fixa fora do :root. Rodar com: node --test prototipo/check-v14.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ORIG = process.env.ORIG || fileURLToPath(new URL('./referencia/plataforma-java-v13.html', import.meta.url));
const V14 = process.env.V14 || fileURLToPath(new URL('./plataforma-aceana-v14.html', import.meta.url));
// normaliza CRLF: com core.autocrlf=true o checkout grava o HTML com CRLF e o original tem LF
const read = p => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const orig = read(ORIG);
const v14 = read(V14);

// prefixos de linhas do script ORIGINAL que podem mudar (as linhas do shell() têm base64 enorme, por isso prefixo)
const ALLOWED_CHANGED = [
  "const route=()=>",
  " if(r==='cliente')html=vCliente();",
  '  <div class="brand"><img class="logo-img jav"',
  '  <div class="mascot ace"><img',
  " window.scrollTo(0,r===lastRoute?y:0);",
];
const allowed = line => ALLOWED_CHANGED.some(p => line.startsWith(p));

export const scriptOf = html => {
  const i = html.lastIndexOf('<script>'), j = html.lastIndexOf('</script>');
  return html.slice(i + 8, j);
};
export const cssOf = html => html.split('<style>')[2].split('</style>')[0];
export const stripNeone = js => js.replace(/\/\* NEONE:start \*\/[\s\S]*?\/\* NEONE:end \*\//g, '');

export function tokens(css) {
  const root = css.match(/:root\{([^}]*)\}/)[1];
  const t = {};
  for (const m of root.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})\b/g)) t[m[1]] = m[2];
  return t;
}
function lum(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

test('JS original preservado', () => {
  const now = stripNeone(scriptOf(v14)).split('\n');
  let k = 0;
  for (const line of scriptOf(orig).split('\n')) {
    if (allowed(line)) continue;
    while (k < now.length && now[k] !== line) k++;
    assert.ok(k < now.length, `linha original ausente ou fora de ordem: ${line.slice(0, 120)}`);
    k++;
  }
});

// linhas que existem no v14 fora dos blocos NEONE e não existem no original: lista exata, nada além disso
const ALLOWED_ADDED = [
  "const route=()=>(location.hash||'#inicio').slice(1);",
  '  <div class="brand"><a href="#inicio" aria-label="Voltar à página inicial"><img class="logo-img jav" src="${JAV_SRC}" alt="Java"><div><b>Java</b><span>Desculpa ou Resultado</span></div></a></div>',
  '  <div class="mascot ace"><img src="${SETA_SRC}" alt="Logo A.C.E."></div>',
  " if(r==='inicio')html=vLanding();",
  " else if(r==='cliente')html=vCliente();",
  " window.scrollTo(0,r===lastRoute?y:0);lastRoute=r;paintToast();syncFx();",
];

test('nenhuma linha nova no JS fora dos blocos NEONE além das permitidas', () => {
  const known = new Set(scriptOf(orig).split('\n'));
  const added = stripNeone(scriptOf(v14)).split('\n').filter(l => !known.has(l));
  assert.deepEqual(added, ALLOWED_ADDED);
});

test('mesmo número de <script> que o original', () => {
  const count = h => (h.match(/<script\b/g) ?? []).length;
  assert.equal(count(v14), count(orig));
});

test('blocos NEONE não redefinem nomes do JS original', () => {
  const decl = js => new Set([...js.matchAll(/^(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)|\bA\.(\w+)\s*=/gm)].map(m => m[1] || 'A.' + m[2]));
  const neone = (scriptOf(v14).match(/\/\* NEONE:start \*\/[\s\S]*?\/\* NEONE:end \*\//g) ?? []).join('\n');
  const origNames = decl(scriptOf(orig));
  assert.deepEqual([...decl(neone)].filter(n => origNames.has(n)), []);
});

test('cards sem backdrop-filter (custo de GPU sem efeito visível)', () => {
  const card = cssOf(v14).match(/\n\.card\{[^}]*\}/)[0];
  assert.ok(!/backdrop-filter/.test(card), card);
});

test('contraste AA dos tokens', () => {
  const t = tokens(cssOf(v14));
  for (const [fg, bg] of [['ink', 'bg'], ['ink', 'card'], ['muted', 'card'], ['muted', 'bg'], ['side-ink', 'side'],
    ['ok', 'ok-soft'], ['warn', 'warn-soft'], ['bad', 'bad-soft'], ['info', 'info-soft'], ['on-yellow', 'yellow'], ['paper-ink', 'paper']]) {
    assert.ok(t[fg] && t[bg], `token ausente: --${fg} ou --${bg}`);
    assert.ok(contrast(t[fg], t[bg]) >= 4.5, `${fg} sobre ${bg}: ${contrast(t[fg], t[bg]).toFixed(2)}`);
  }
});

// Roda o bloco do shader num DOM falso mínimo para checar quando ele anima.
function fxEnv({ canvas, reduced, hash }) {
  const block = scriptOf(v14).match(/\/\* NEONE:start \*\/\s*\/\* ===== FX[\s\S]*?\/\* NEONE:end \*\//);
  assert.ok(block, 'bloco FX ausente');
  const calls = { draw: 0, raf: 0, cancel: 0 };
  const ctx2d = new Proxy({}, { get: (_, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => { calls.draw++; }), set: () => true });
  const env = {
    calls, location: { hash },
    document: { hidden: false, addEventListener() {}, getElementById: id => (id === 'hero-fx' ? env.canvasEl : null), documentElement: {} },
    canvasEl: canvas ? { width: 0, height: 0, clientWidth: 800, clientHeight: 600, parentElement: {}, getContext: () => ctx2d } : null,
    matchMedia: () => ({ matches: reduced }),
    requestAnimationFrame: () => { calls.raf++; return 1; },
    cancelAnimationFrame: () => { calls.cancel++; },
    getComputedStyle: () => ({ getPropertyValue: () => '#FFD000' }),
    ResizeObserver: class { observe() {} disconnect() {} },
    performance: { now: () => 0 },
    devicePixelRatio: 2, Math,
  };
  env.window = env;
  vm.createContext(env);
  vm.runInContext(block[0], env);
  return env;
}

test('shader não roda fora da landing', () => {
  const e = fxEnv({ canvas: false, reduced: false, hash: '#painel' });
  vm.runInContext('syncFx()', e);
  assert.equal(e.__fx.running, false);
});

test('shader com menos movimento desenha um quadro e para', () => {
  const e = fxEnv({ canvas: true, reduced: true, hash: '#inicio' });
  vm.runInContext('syncFx()', e);
  assert.equal(e.__fx.running, false);
  assert.ok(e.calls.draw > 0, 'nenhum desenho');
  assert.equal(e.calls.raf, 0);
});

test('shader anima na landing e desliga ao sair', () => {
  const e = fxEnv({ canvas: true, reduced: false, hash: '#inicio' });
  vm.runInContext('syncFx()', e);
  assert.equal(e.__fx.running, true);
  assert.ok(e.calls.raf > 0);
  e.canvasEl = null; e.location.hash = '#painel';
  vm.runInContext('syncFx()', e);
  assert.equal(e.__fx.running, false);
  assert.ok(e.calls.cancel > 0);
});

test('nenhuma cor hex fora do :root no CSS', () => {
  const css = cssOf(v14).replace(/:root\{[^}]*\}/, '');
  assert.deepEqual(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], []);
});
