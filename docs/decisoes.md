# Decisões

## 01/11/2026 — Redesign visual v14 (formato Neone)
- **Landing + app em tema escuro preto e amarelo**, num HTML único (`prototipo/plataforma-aceana-v14.html`). Decisão do Tiago.
- **Rota padrão agora é `#inicio` (landing).** Antes era `#painel`. Motivo: abrir a plataforma mostra a apresentação, e "Entrar" leva ao funil.
- **Prévias de proposta, contrato e slide continuam claras (papel).** Motivo: representam o PDF que vai ao cliente.
- **Faixa animada do topo do app em CSS, não em canvas.** Motivo: não pesar na máquina da apresentação.
- **Marca na landing: "Java", "Plataforma de Propostas da A.C.E." e "Desculpa ou Resultado"**, como no HTML original.

## 01/11/2026 — Backend da demo (v0.2)
- **Escopo para 05/11:** fluxo real com banco e API; Pipedrive, Monday e Clicksign simulados (mock) atrás de interface pronta para o conector real. Decisão do Tiago.
- **Stack:** Node 24 + TypeScript + Fastify + PGlite (Postgres embutido). Motivo: sem Docker/Postgres na máquina; mesmo SQL de um Postgres gerenciado. Decisão do Tiago.
- **Front:** o v14 continua e passa a consumir a API; preço e margem só no servidor. Decisão do Tiago.
- **Backoffice = 5,764%** (Parâmetros Únicos v0 / Rentabilidade v5.0), não 5,565% da v5.1. Motivo: golden tests do contexto fecham com 5,764%. Decisão do Tiago.
- **Custo da hora ativo = R$ 23,45** (decisão de 31/10); R$ 24,2884 fica como versão 1 de parâmetros.
- **Preço calculado:** fórmula do contexto §9.3 com ISS uma vez só; composição do mínimo é hipótese a conferir na planilha Russa. Decisão do Tiago.
