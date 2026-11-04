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

## 02/11/2026 — Pipedrive real e diagnóstico por transcrição
- **Pipedrive real em modo só leitura** (decisão do Tiago): a plataforma lê os negócios em "Diagnóstico realizado" de todos os funis (Vendas Inbound, Vendas Outbound, Licitações), com organização, contato, valor e campos personalizados. Gravações (etapa, valor, ganho) ficam registradas e não são enviadas; `PIPEDRIVE_WRITE=1` liga quando for decidido.
- **Etapas achadas pelo nome** ("Diagnóstico realizado"), não por ID fixo. Token só no `.env`, enviado no cabeçalho `x-api-token`.
- **Serviço do deal → solução do catálogo:** primeiro serviço do Pipedrive (na ordem) que existe no catálogo. Só 3 dos 17 negócios têm o campo preenchido; nos outros, a análise da transcrição sugere a solução.
- **Diagnóstico com IA (Claude Opus 5.5, decisão do Tiago):** a IA lista dores, objetivos e restrições com trecho literal da transcrição e sugere só soluções do catálogo. A trava do servidor descarta solução fora do catálogo, item sem trecho de origem e qualquer saída com valor, prazo, desconto ou cláusula (M10). CPF, RG, CNPJ, e-mail e telefone saem do texto antes do envio. Fallback do servidor ligado (`fallbacks: "default"`).
- **LGPD:** a transcrição (já sem dados pessoais) vai para a Anthropic, que passa a ser operadora. PENDENTE: registrar no inventário de operadores e validar com o jurídico.
- **A IA nunca define preço, desconto nem prazo:** dias vêm do catálogo e o preço do motor; o GN revisa e aprova.
- **Sem chave da Anthropic (02/11):** a análise da transcrição roda por palavras-chave (`src/connectors/ai/keywords.ts`): frases do cliente com marcas de dor, objetivo ou restrição, e soluções cujo nome ou sinônimo aparece na conversa ou na pré-auditoria. Mesma trava da IA. Os sinônimos são HIPÓTESE do time. Com `ANTHROPIC_API_KEY` no `.env`, o Claude assume automaticamente.

## 04/11/2026 — Escopo e proposta vindos dos assistentes do Claude.ai
- **Escopo pela planilha (decisão do Tiago):** o assistente de escopo do Claude.ai continua escrevendo na planilha de precificação (Google Sheets). O GN baixa como `.xlsx` e importa na proposta: solução, etapas, atividades com dias e DoD, consultores, gerente, custos externos (TOTAL DOS CUSTOS) e multiplicadores (porte, pagamento, captação, modalidade, desconto, terceirização). Dores, objetivo e indicadores viram o diagnóstico.
- **O preço da planilha não entra no cálculo:** aparece só como referência. Na planilha da Clínica Maluar (04/11) o "VALOR FINAL" saiu errado por células `#REF!` nos parâmetros; o importador avisa quando isso acontece.
- **Ler pelo link do Google:** não, por enquanto. O link responde 401 sem credencial; exigiria conta de serviço do Google da A.C.E. Evolução futura.
- **Proposta pronta (decisão do Tiago):** o assistente com o design system gera PDF ou Canva; o GN anexa à versão aprovada. PDF: a plataforma confere valor, parcelas e ausência de margem no texto; divergência exige confirmação do GN, registrada em seu nome. Canva: sempre confirmação do GN (não dá para ler o link). Só links https do Canva. Nova versão = anexo antigo deixa de valer. O cliente abre o PDF/Canva pelo link público.
- **Dependências novas:** `exceljs` (ler .xlsx) e `unpdf` (texto do PDF). `npm audit` aponta 9 alertas moderados nas dependências delas; aceitável para a demo local, rever antes de produção.

## 04/11 — Gravação restrita no Pipedrive (Caminho A)
- A plataforma grava no negócio só três coisas: "Valor aprovado" e "Parcelas aprovadas" (na aprovação) e a validade em "Data de fechamento esperada" (no envio). Todas as outras gravações continuam desligadas.
- Liga com `PIPEDRIVE_WRITE_APPROVED=1`. Os dois campos personalizados são criados por um admin do Pipedrive; sem eles, o job falha com mensagem clara em Integrações e pode ser reprocessado.
- Trava: antes de gravar, a plataforma confere se o negócio ainda é da mesma organização da proposta; se não for, não grava nada.
