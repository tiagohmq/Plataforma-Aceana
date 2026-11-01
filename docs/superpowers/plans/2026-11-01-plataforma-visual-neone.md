# Plataforma ACEANA — redesign visual Neone: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gerar `prototipo/plataforma-aceana-v14.html`: o protótipo "Plataforma Java" em tema escuro preto + amarelo no formato Neone, com uma landing (Hero + Benefícios) na frente.

**Architecture:** Cópia do HTML original, editada no lugar. O CSS (2º `<style>`, linhas 5–112 do original) é reescrito sobre tokens escuros. O JS de negócio (linhas 115–790) não muda, exceto duas linhas de roteamento e um bloco novo delimitado por `/* NEONE:start */ … /* NEONE:end */` (landing + shader). Um script Node verifica três coisas: que o JS original continua intacto, o contraste dos tokens e que não há cor fixa fora dos tokens.

**Tech Stack:** HTML/CSS/JS puro num arquivo só; Canvas 2D para o shader; Inter (Google Fonts, já carregada); Node 24 (`node:test`) só para a verificação.

**Spec:** `docs/superpowers/specs/2026-11-01-plataforma-visual-neone-design.md`

## Global Constraints

- Fonte: `C:\Users\Tiago Henrique\Downloads\Plataforma Java.html`. Nunca editar o original.
- Saída: `prototipo/plataforma-aceana-v14.html`.
- Amarelo de ação `#FFD000`; texto sobre amarelo `#111111`; fonte Inter.
- Javali e seta: os PNG base64 já presentes no arquivo (classe `.logo-img.jav` = javali; `.mascot.ace img` = seta). Não recriar nem reexportar.
- Não alterar regra, texto, fluxo ou cálculo. As únicas linhas do JS original que podem mudar estão listadas em `ALLOWED_CHANGED` (Task 1).
- Contraste mínimo WCAG AA: 4,5:1 para texto.
- Landing: só Hero + Benefícios. Textos dos benefícios saem do briefing; nenhum número ou meta.
- `prefers-reduced-motion: reduce` → shader em quadro estático.
- Documentos que imitam papel (`.doc`, `.slide`, `.var`) continuam claros: representam PDF/contrato/slide do cliente. (Decisão de implementação; registrar em `docs/decisoes.md`.)

## Review Focus

1. **Texto escuro em fundo escuro** gerado pelo JS (templates com `style="..."` ou classes sem token). Esperado: tudo legível em todas as rotas. Coberto pela varredura da Task 2 e pelo passeio da Task 5.
2. **Rota `#cliente`** (visão do cliente, `vCliente`) fica fora do `shell()`. Esperado: herda o tema escuro, e o documento da proposta continua papel claro. Coberto pela Task 5.
3. **Modal e toast** (`.modal`, `.toast`) sobre fundo escuro. Esperado: o modal se destaca do fundo e o toast continua visível. Coberto pela Task 5.
4. **Shader rodando com a aba oculta ou depois de sair da landing.** Esperado: nenhum `requestAnimationFrame` ativo fora da landing. Teste na Task 4.
5. **Celular (375 px):** landing sem rolagem horizontal; sidebar empilhada (`@media(max-width:900px)`) legível no escuro. Coberto pela Task 5.

---

### Task 1: Cópia de trabalho + verificador

**Files:**
- Create: `prototipo/plataforma-aceana-v14.html` (cópia byte a byte do original)
- Create: `prototipo/check-v14.test.mjs`
- Create: `prototipo/README.md` (como abrir e como rodar a verificação; 10 linhas)

**Interfaces:**
- Produces: `node --test prototipo/` como verificação oficial, usada em todas as tasks seguintes.

- [ ] **Step 1: Copiar o original**

Run: `cp "/c/Users/Tiago Henrique/Downloads/Plataforma Java.html" prototipo/plataforma-aceana-v14.html`

- [ ] **Step 2: Escrever `check-v14.test.mjs` com três testes (`node:test` + `node:assert`)**

O caminho do original vem de `process.env.ORIG`, com padrão no caminho acima. Helpers: `scriptOf(html)` devolve o conteúdo do último `<script>…</script>`; `cssOf(html)` devolve o 2º bloco `<style>`; `tokens(css)` devolve um mapa nome→hex do `:root{…}`; `contrast(hexA, hexB)` calcula a razão WCAG.

```js
// prefixos de linhas do script ORIGINAL que podem mudar (as linhas do shell() têm base64 enorme, por isso prefixo)
const ALLOWED_CHANGED = [
  "const route=()=>",
  " if(r==='cliente')html=vCliente();",
  '  <div class="brand"><img class="logo-img jav"',
  '  <div class="mascot ace"><img',
  " window.scrollTo(0,r===lastRoute?y:0);",
];
const allowed = line => ALLOWED_CHANGED.some(p => line.startsWith(p));
test('JS original preservado', () => {
  // remove o bloco /* NEONE:start */…/* NEONE:end */ do v14;
  // cada linha do script original fora de ALLOWED_CHANGED existe, na mesma ordem relativa, no script do v14
});
test('contraste AA dos tokens', () => {
  const t = tokens(cssOf(v14));
  for (const [fg, bg] of [['ink','bg'],['ink','card'],['muted','card'],['muted','bg'],['side-ink','side'],
    ['ok','ok-soft'],['warn','warn-soft'],['bad','bad-soft'],['info','info-soft'],['on-yellow','yellow'],['paper-ink','paper']])
    assert.ok(contrast(t[fg], t[bg]) >= 4.5, `${fg} sobre ${bg}`);
});
test('nenhuma cor hex fora do :root no CSS', () => {
  const css = cssOf(v14).replace(/:root\{[^}]*\}/, '');
  assert.deepEqual(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], []);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test prototipo/`
Expected: "JS original preservado" PASS; "contraste" FAIL (os tokens `on-yellow`, `paper` e `paper-ink` ainda não existem); "nenhuma cor hex" FAIL (lista `#111`, `#fff`, `#ECEBE5`…).

- [ ] **Step 4: Commit**

```bash
git add prototipo/
git commit -m "chore: cópia de trabalho v14 e verificador do redesign"
```

---

### Task 2: Tokens escuros + componentes no estilo Neone

**Files:**
- Modify: `prototipo/plataforma-aceana-v14.html`, 2º `<style>` (bloco das linhas 5–112 do original). O 1º `<style>` da linha 1 passa para `color-scheme:dark` e `body{background:#0B0B0B;color:#F2F1EC}`.

**Interfaces:**
- Consumes: verificador da Task 1.
- Produces: tokens que as Tasks 3–4 usam: `--bg --bg-2 --card --card-2 --line --line-strong --ink --muted --yellow --yellow-2 --orange --on-yellow --glow --side --side-ink --side-hover --ok/--ok-soft --warn/--warn-soft --bad/--bad-soft --info/--info-soft --paper --paper-ink --paper-line --focus --grad-arrow`.

- [ ] **Step 1: Reescrever `:root`** com:
  - `--bg:#0B0B0B`; `--bg-2:#121212`; `--card:#161616`; `--card-2:#1D1D1D`;
  - `--line:rgba(255,255,255,.08)`; `--line-strong:rgba(255,255,255,.16)`;
  - `--ink:#F2F1EC`; `--muted:#A3A29B`;
  - `--yellow:#FFD000`; `--yellow-2:#FFB800`; `--orange:#F59E0B`; `--on-yellow:#111111`;
  - `--grad-arrow:linear-gradient(135deg,var(--yellow),var(--orange))`; `--glow:rgba(255,208,0,.35)`;
  - `--side:#0F0F0F`; `--side-ink:#D9D8D2`; `--side-hover:#1E1E1E`;
  - semânticas escuras: texto claro sobre fundo escuro tingido, ex. `--ok:#5FD39A`/`--ok-soft:#10261A`. Valores finais escolhidos para passar no teste de contraste;
  - `--paper:#FFFFFF`; `--paper-ink:#111111`; `--paper-line:#E4E2DA`; `--focus:#7B93FF`.

  O verificador conta `rgba(...)` fora do `:root` como permitido. Só hex é proibido.
- [ ] **Step 2: Trocar todo hex fora do `:root` por token**, seletor a seletor. Regras do estilo Neone:
  - `.card`: `background:linear-gradient(180deg,var(--card-2),var(--card))`, `border:1px solid var(--line)`, `border-radius:16px`, `backdrop-filter:blur(8px)`; no hover, `border-color:var(--line-strong)`.
  - `.btn`: `border-radius:999px`. `.btn` padrão = contorno `var(--line-strong)` com texto `--ink`; `.btn.p` e `.btn.y` = `var(--yellow)` com texto `--on-yellow` e `box-shadow:0 0 24px var(--glow)` no hover.
  - `.nav.on`: `background:var(--grad-arrow)` com texto `--on-yellow`.
  - `.tab.on`: texto `--ink`, borda inferior `--yellow`.
  - `h1`: 34px.
  - `.main`: padding `32px 40px 72px`.
  - `.f input/select/textarea`, `.inp`, `.who select`: fundo `--bg-2`, borda `--line-strong`, texto `--ink`.
  - `.step`, `.chip`, `.bar`, `.kcol`, `.dot`: fundo `--card-2`, texto `--muted`.
  - `.tbl tr.lk:hover td`: `--card-2`.
  - `.modal`: overlay `rgba(0,0,0,.7)`. `.toast`: `--card-2` com borda `--yellow`.
  - `.light.y`: `--yellow`.
  - `.doc`, `.slide`, `.var`: `--paper`/`--paper-ink`/`--paper-line` (o amarelo do `.var` vira `rgba(255,208,0,.25)` com borda `--yellow`).
  - `.slide.cv`: `--on-yellow` de fundo e texto `--paper`.
  - Foco: `outline:3px solid var(--focus)`.
- [ ] **Step 3: Faixa do topo do app:** `.main{position:relative}` com `.main:before` de 3px no topo: `background:var(--grad-arrow)`, `background-size:200%`, animação `@keyframes sweep` deslizando o degradê, desligada em reduced-motion. (Faixa em CSS, sem canvas, para não pesar.)
- [ ] **Step 4: Rodar a verificação**

Run: `node --test prototipo/`
Expected: os 3 testes PASS.

- [ ] **Step 5: Varrer cores no JS**

Run: `grep -noE 'style="[^"]*(#[0-9a-fA-F]{3,6}|color:\s*(black|white))' prototipo/plataforma-aceana-v14.html`
Expected: só a ocorrência de `#FFD000` (legível no escuro). Qualquer outra vira classe/token, mas sem mudar texto nem lógica. Se exigir mudar uma linha do JS, acrescentar a linha a `ALLOWED_CHANGED` com comentário do porquê.

- [ ] **Step 6: Commit** — `git commit -am "feat(v14): tema escuro preto e amarelo no estilo Neone"`

---

### Task 3: Landing (Hero + Benefícios) e roteamento

**Files:**
- Modify: `prototipo/plataforma-aceana-v14.html`: linha `const route=…` (padrão `#inicio`); `render()` (novo ramo); bloco `/* NEONE:start */` antes de `/* ===== RENDER ===== */`; CSS da landing no fim do 2º `<style>`; link de volta no `.brand` do `shell()`.

**Interfaces:**
- Consumes: tokens da Task 2; constantes base64 já existentes.
- Produces: `vLanding(): string` (HTML da landing com `<canvas id="hero-fx">`); rota `inicio`; `JAV_SRC` e `SETA_SRC` (strings `data:image/png;base64,…`).

- [ ] **Step 1: Conferir `ALLOWED_CHANGED`** (já cobre `route`, o ramo de `render()` e as duas linhas de imagem do `shell()`). Nenhuma outra linha original pode mudar.
- [ ] **Step 2: Extrair `JAV_SRC` e `SETA_SRC`** para constantes no bloco NEONE e usá-las no `shell()` (substitui os dois `src` literais, o que reduz o arquivo). As duas linhas do `shell()` já estão em `ALLOWED_CHANGED`.
- [ ] **Step 3: Implementar**
  - `const route=()=>(location.hash||'#inicio').slice(1);`
  - em `render()`: `if(r==='inicio')html=vLanding();else if(r==='cliente')html=vCliente();`
  - `vLanding()` com:
    - `<nav>`: seta + "Plataforma ACEANA de Propostas" + botão pílula amarelo `<a class="btn y" href="#painel">Entrar na plataforma</a>`;
    - hero: `<canvas id="hero-fx" aria-hidden="true">` absoluto ao fundo, javali com `.mascot`-like glow, `h1` "Do diagnóstico ao projeto iniciado, sem retrabalho.", apoio "Catálogo, escopo, preço, proposta e contrato numa fonte só, integrada ao Pipedrive, ao Monday e ao Clicksign.", botões `Entrar na plataforma` (`.btn y`) e `Ver como funciona` (`.btn`, âncora `#beneficios` via `data-a`, para não trocar de rota);
    - `#beneficios` com 4 `.card` e os textos da spec §5.3.
  - Em `.brand` do `shell()`: o logo vira `<a href="#inicio" aria-label="Voltar à página inicial">`.
  - CSS `.land*`: hero `min-height:88vh`, conteúdo centralizado, `h1` em `clamp(36px,6vw,68px)`, grid de benefícios `repeat(auto-fit,minmax(240px,1fr))` e gutter de 16px no celular.
- [ ] **Step 4: Rodar** `node --test prototipo/` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(v14): landing Hero + Benefícios e rota #inicio"`

---

### Task 4: Shader do hero

**Files:**
- Modify: `prototipo/plataforma-aceana-v14.html`, bloco NEONE; chamada `syncFx()` no fim de `render()` (a linha `window.scrollTo…` de `render()`, já em `ALLOWED_CHANGED`, ganha `;syncFx()`).
- Modify: `prototipo/check-v14.test.mjs` (teste novo).

**Interfaces:**
- Consumes: `vLanding()` (canvas `#hero-fx`), tokens de cor (lidos via `getComputedStyle`).
- Produces: `syncFx(): void`, que liga o shader se `#hero-fx` existe e desliga caso contrário; `window.__fx` = `{running:boolean}` para inspeção.

- [ ] **Step 1: Teste**: `test('shader não roda fora da landing')`. Carrega o script NEONE num sandbox `node:vm` com DOM mínimo falso (`document.getElementById` devolvendo `null`), chama `syncFx()` e verifica `__fx.running === false`. Com o canvas falso presente e `matchMedia('(prefers-reduced-motion: reduce)').matches===true`, `syncFx()` desenha um quadro e deixa `__fx.running === false`.
- [ ] **Step 2: Rodar** → FAIL (`syncFx` indefinido).
- [ ] **Step 3: Implementar `syncFx()`**
  - Ondas: 3 a 4 faixas senoidais sobrepostas, desenhadas com `globalCompositeOperation='lighter'` e preenchimento `createLinearGradient` de `#FFD000`→`#F59E0B` lido dos tokens `--yellow`/`--orange`, alpha 0,08–0,2. Parâmetro de fase `t`. É a versão amarela da onda de luz do Neone.
  - Canvas em `devicePixelRatio` limitado a 1,5, com `ResizeObserver` no pai.
  - Para o `requestAnimationFrame` quando: `document.hidden`, rota ≠ `inicio`, ou reduced-motion (desenha só 1 quadro).
- [ ] **Step 4: Rodar** `node --test prototipo/` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(v14): shader amarelo animado no hero"`

---

### Task 5: Verificação visual ponta a ponta

**Files:**
- Modify: `prototipo/README.md` (adicionar o roteiro de passeio abaixo)
- Create/Modify: `docs/decisoes.md` (anotar: documentos papel ficam claros; faixa do app em CSS; rota padrão agora é `#inicio`)

- [ ] **Step 1:** Abrir `prototipo/plataforma-aceana-v14.html` no navegador do app. Passar por `#inicio`, `#painel`, `#propostas`, uma `#proposta-…` em todas as abas, `#aprovacoes`, `#catalogo`, `#integracoes`, `#administracao`, `#auditoria`, `#cliente`. Abrir o modal de nova proposta, disparar um toast e trocar o perfil no seletor.
  Esperado: nenhum texto ilegível; semáforo, chips e banners distinguíveis; `.doc`/`.slide` em papel claro.
- [ ] **Step 2:** `read_console_messages` com onlyErrors. Esperado: vazio.
- [ ] **Step 3:** Repetir landing, painel e uma proposta em 375 px. Esperado: `document.documentElement.scrollWidth <= innerWidth`.
- [ ] **Step 4:** Comparar valores com o original: mesma proposta, mesma aba de preço. Esperado: preço, margens e semáforo idênticos.
- [ ] **Step 5:** Corrigir o que aparecer (só CSS/tokens), rodar `node --test prototipo/` → PASS, tirar screenshots da landing e do painel.
- [ ] **Step 6: Commit** — `git commit -am "docs(v14): roteiro de verificação e decisões do redesign"`
