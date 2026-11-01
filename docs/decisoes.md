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

## 01/11/2026 — Correções da revisão final do backend
- **Conferência proposta × contrato:** proposta e contrato saem da mesma versão imutável, então não podem divergir entre si. A conferência que pode falhar é contra o Pipedrive (valor) e contra a versão atual: contrato de versão antiga ou sem aprovação válida não é aprovado nem recebe envelope.
- **Contratante pessoa física:** o CPF do contratante é tratado como dado pessoal (cifrado); nos dados abertos fica mascarado. O documento do contrato leva o CPF completo.
- **Link público da proposta:** token aleatório, não o id (que é adivinhável pelo nome do cliente).
- **Situação do contrato:** só avança (eventos do Clicksign podem chegar repetidos ou fora de ordem); contrato cancelado não vira ganho.
- **Reinício do servidor:** jobs que estavam em execução voltam para a fila; o Pipedrive simulado reaplica as gravações já feitas.
- **Aprovação de preço dentro da regra:** GN e DP (matriz de perfis). A Diretoria aprova exceções. A spec §8.3 citava também a Diretoria para preço comum; ficou a matriz. PENDENTE confirmar.
- **Faixas de capacidade produtiva:** limite com "menor ou igual" (≤ 65% → 1,00), como a planilha Russa; o contexto escreve "< 65%". PENDENTE confirmar com o DP.
