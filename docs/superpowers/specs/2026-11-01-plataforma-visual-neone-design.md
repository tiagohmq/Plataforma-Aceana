# Plataforma ACEANA — redesign visual no formato Neone

Data: 01/11/2026 · Autor: Tiago Henrique (com Claude Code) · Status: aprovado em conversa, aguardando revisão desta spec

## 1. Objetivo

Dar à plataforma de propostas o **formato** do template Neone AI (21st.dev, Marcellin Leclercq) com a **identidade visual da A.C.E.** já usada no protótipo "Plataforma Java": cores, seta tripla e javali. O resultado é para a demonstração de **05/11/2026**.

Sucesso significa:
- abrir a plataforma e ver uma landing escura premium com o javali e o shader amarelo;
- entrar no app e encontrar todas as telas e fluxos de hoje funcionando, agora em tema escuro;
- nenhuma regra, texto ou cálculo do protótipo alterado.

## 2. Decisões (confirmadas pelo Tiago em 01/11)

| Tema | Decisão |
|---|---|
| Escopo | Landing de entrada + app repaginado |
| Base técnica | HTML único e autônomo (igual ao "Plataforma Java") |
| Tema | Escuro: preto + amarelo, em landing e app |
| Seções da landing | Só Hero + Benefícios (sem fluxo, prévia, integrações, preços, FAQ) |

## 3. Premissas (corrigir se estiverem erradas)

- Fonte: `C:\Users\Tiago Henrique\Downloads\Plataforma Java.html`. O original não é alterado.
- Saída: `prototipo/plataforma-aceana-v14.html` neste repositório (nome provisório).
- Só a camada visual muda: CSS, marcação de cabeçalho/landing e o shader. JavaScript de regra de negócio, textos, fluxos e cálculos ficam intactos.
- Javali e seta: reaproveitar os PNG já embutidos em base64 no HTML original.

## 4. Identidade visual

**Do HTML original (manter):**
- Amarelo de ação `#FFD000`; preto `#111111`; fonte Inter (400–800, Google Fonts).
- Seta tripla em chevron, degradê amarelo → laranja.
- Javali amarelo/marrom com olhos vermelhos.
- Cores semânticas (ok/warn/bad/info) e o semáforo com o mesmo significado.

**Do Neone (adotar):**
- Fundo preto com shader 2D animado no hero.
- Título grande centralizado, linha de apoio, botões pílula (primário cheio, secundário com contorno).
- Cards escuros com borda fina translúcida, leve vidro, brilho no hover.
- Espaçamento generoso e hierarquia tipográfica forte.

## 5. Landing

1. **Topo:** seta tripla + nome da plataforma à esquerda; botão pílula amarelo "Entrar na plataforma" à direita.
2. **Hero:** `<canvas>` com uma onda de luz animada no degradê da seta (substitui a onda branca do Neone). Javali com brilho suave atrás. Título, linha de apoio, dois botões.
3. **Benefícios:** 3–4 cards. Textos tirados do briefing:
   - uma fonte de verdade para catálogo, escopo, preço e contrato;
   - margem prevista visível antes de vender (só interna);
   - aprovação humana antes de qualquer envio;
   - zero divergência entre proposta, contrato e Pipedrive.
   - Nenhum número ou meta inventado.
4. **Navegação:** "Entrar" mostra o app sem recarregar a página; o app tem como voltar à landing.
5. **Movimento:** com `prefers-reduced-motion`, o shader fica parado (quadro estático).

## 6. App repaginado

- **Tokens:** os atuais (`--bg`, `--card`, `--ink`, `--muted`, `--line`, `--side`, `--side-ink`, `--*-soft`) ganham valores escuros. Fundo perto de `#0B0B0B`; sidebar e cards um degrau acima; texto claro. `#FFD000` continua como cor de ação; o degradê da seta entra em destaques (aba ativa, indicadores).
- **Semânticas:** ok/warn/bad/info e as versões `-soft` ajustadas para fundo escuro, com contraste mínimo WCAG AA no texto.
- **Componentes:** cards com borda translúcida e vidro leve; botões pílula; títulos maiores; mais espaço entre blocos.
- **Cabeçalho do app:** faixa fina do shader amarelo no topo, ligando com a landing.
- **Estilos inline:** varrer os `style="..."` com cores fixas (ex.: preto, branco, cinza) e trocar por tokens, para não sobrar texto escuro em fundo escuro.

## 7. Fora do escopo

- Mudar regra, texto, fluxo ou cálculo do protótipo.
- Seções da landing além de Hero + Benefícios.
- Tema claro / alternância de tema.
- Portar para React (fica como evolução, se o v0.1 seguir).

## 8. Riscos

- **Inline styles e cores no JS:** maior risco de quebra visual; mitigado pela varredura do item 6 e pela verificação tela a tela.
- **Desempenho do shader** em máquina fraca na apresentação: canvas leve, resolução reduzida, pausa quando a aba fica oculta.
- **Prazo (04/11 entrega, 05/11 apresentação):** trabalho só visual, mas o HTML tem ~320 KB; priorizar landing + tokens, depois o acabamento por tela.

## 9. Verificação

- Abrir no navegador; passar por todas as abas e fluxos (diagnóstico, escopo, preço e margem, aprovação, proposta, contrato, passagem, painel).
- Console sem erros.
- Conferir largura de celular (375 px) e desktop.
- Conferir contraste dos textos e do semáforo.
- Comparar lado a lado com o original: mesmos valores e mesmos textos nas mesmas telas.
