# Plataforma ACEANA — backend da demo (v0.2)

Data: 01/11/2026 · Autor: Tiago Henrique (com Claude Code) · Status: desenho aprovado em conversa, aguardando revisão desta spec

Fontes: `CONTEXTO-CLAUDE-CODE.md` (01/11), "Back-end e funcionalidades (plano v0.1)" (01/11), KB v1.0 (28/10): 03 Regras de Negócio, 03 Parâmetros Únicos v0, 04 Requisitos, 06 Dicionário de Dados v0, 05 Catálogo Semente v0, 08 Pendências. Hierarquia em conflito: briefing v1.0 > Rentabilidade v5.0 > demais documentos > decisões do Tiago > hipóteses. Legenda: **CONFIRMADO**, **HIPÓTESE**, **PENDENTE**.

## 1. Objetivo

Fazer o protótipo v14 funcionar de verdade para a apresentação de **05/11/2026**: um backend real (API + banco) que é a fonte única de catálogo, parâmetros, escopo, preço, margem, aprovações, proposta e contrato, com Pipedrive, Monday e Clicksign **simulados** atrás de uma interface pronta para o conector real.

Sucesso significa:
- o fluxo deal → proposta → aprovação → contrato → assinatura → projeto roda gravando no banco, ponta a ponta, com cliente fictício;
- preço, piso, margens e semáforo vêm só do servidor e passam nos golden tests;
- nenhuma regra de aceite (seção 11) é violável pela API;
- trocar `mock` por `real` num conector não exige mexer nos módulos de negócio.

## 2. Decisões desta spec (Tiago, 01/11)

| Tema | Decisão |
|---|---|
| Escopo da demo | Fluxo real, integrações mock |
| Stack | Node 24 + TypeScript, Fastify, PGlite (Postgres embutido em `./data`), vitest |
| Front | O v14 continua; troca a camada de dados por chamadas à API; o backend serve a página |
| Backoffice | 5,764% (Parâmetros Únicos v0 / Rentabilidade v5.0). A v5.1 traz 5,565%; não adotado |
| Custo da hora | R$ 23,45 ativo (decisão de 31/10). R$ 24,2884 fica como versão 1 de parâmetros (histórico) |
| Preço calculado | Fórmula da seção 9.3 do contexto, corrigida: ISS aplicado uma vez; multiplicadores como parâmetros versionados |
| Clicksign | Upload manual (decisão de 01/11). A plataforma só gera o contrato e recebe o webhook |
| Login | Mock: seletor "Entrar como" do v14; permissões aplicadas no servidor por perfil |
| Repositório | `plataforma-aceana` |

## 3. Fora do escopo da demo

Login Google Workspace; conectores reais (só esqueleto); envio automático ao Clicksign; IA (entra só se sobrar tempo, restrita ao catálogo); painel de indicadores com fórmulas reais; cofre de segredos (na demo, chave em `.env`); backup com restauração testada; hospedagem.

## 4. Arquitetura

Monólito modular (alternativa A do plano v0.1).

```
src/
  domain/        regras puras, sem I/O (motor, parcelas, dias úteis, aprovação, permissões, filtro de saída)
  db/            conexão PGlite, migrações SQL, sementes
  modules/       catalog, parameters, proposals, approvals, contracts, handoff, audit
  connectors/    pipedrive, monday, clicksign, drive — cada um: interface.ts, mock.ts, real.ts (esqueleto)
  jobs/          fila no banco: enfileirar, worker, retry com backoff, reprocesso
  http/          Fastify: rotas, auth mock, erros, serve o v14
web/             v14 adaptado (HTML único)
tests/
```

- Banco: PGlite gravando em `./data/`; testes usam PGlite em memória. Migrações em SQL puro, compatíveis com Postgres gerenciado.
- Toda chamada a sistema externo passa por `jobs` (nunca direto de uma rota).
- Segredos (`CONTRACT_KEY`, `CLICKSIGN_HMAC_SECRET`, futuros tokens) só em `.env` (fora do git); `.env.example` versionado.

## 5. Modelo de dados

Tabelas imutáveis têm trigger que rejeita `UPDATE` e `DELETE`.

| Tabela | Conteúdo | Imutável |
|---|---|---|
| `users` | id, nome, e-mail, perfil (GN, GP, DP, DIRETORIA, ADMIN), ativo | não |
| `parameter_versions` | id, versão, valores (JSON validado), vigência, autor, origem | sim |
| `catalog_versions`, `solutions`, `solution_stages` | versão; SOL-xxx, nome, frente, complexidade; etapa, dias úteis, `days_validated` | sim |
| `proposals` | id `PROP_AAAA-MM_Cliente`, deal_id, organização, contato, GN, situação | não (só situação) |
| `proposal_versions` | proposta, nº, catalog_version, parameter_version, escopo (JSON: itens, dias, origem catálogo/fora, risco, diff do padrão), d, consultores, GP, C, preço calculado, preço apresentado, valor vendido, parcelas, margens, semáforo, alertas, validade | sim |
| `approvals` | versão da proposta ou do contrato, tipo (PRICE, EXCEPTION, CONTRACT), solicitante, decisor, decisão, justificativa, data | sim |
| `contract_forms` | proposta, token (hash), expira_em, usado_em | não |
| `contract_data` | campos não pessoais do contrato | não |
| `contract_personal` | CPF, RG, órgão emissor, estado civil, endereço do representante — cifrados (AES-256-GCM, chave em `.env`) | não |
| `contracts` | versão da proposta, conteúdo gerado, hash, situação, envelope Clicksign informado | sim |
| `external_links` | deal_id, sistema, id externo (item Monday, envelope, pasta) — único por (deal, sistema) | não |
| `jobs` | tipo, payload resumido (sem dado pessoal), chave de idempotência (única), tentativas, status, próximo_em, erro | não |
| `connector_runs` | job, conector, evento, resultado, erro, duração | sim |
| `audit_events` | quem, quando, entidade, ação, antes, depois | sim |
| `holidays` | data, abrangência (nacional, Recife/PE) | não |

Integridade: no máximo uma proposta ativa por deal; no máximo um projeto Monday por deal (`external_links`); dinheiro em **centavos inteiros**, arredondamento meio-para-cima uma vez, diferença na última parcela.

## 6. Parâmetros (semente)

Versão 2, ativa. Valores CONFIRMADOS salvo indicação:

| Chave | Valor | Fonte |
|---|---|---|
| `hourCost` | 23,45 | Tiago 31/10 (v1 = 24,2884) |
| `tax` | 0,05 | Briefing |
| `plannedHoursPerMemberDay` | 1,0 | Briefing |
| `salesTime` | 0,10 | Briefing |
| `backoffice` | 0,05764 | Parâmetros Únicos v0 (decisão 01/11) |
| `floorPerMemberDay` | 75,00 | Briefing (ganhos a partir de 01/10/2026) |
| `floorStartDate` | 2026-10-01 | Briefing |
| `greenMin` / `yellowMin` | 0,55 / 0,30 | Parâmetros Únicos v0 (sobre % contribuição) |
| `externalCostAlert` | 0,15 | Briefing |
| `clientValidationDays` | 5 | Briefing |
| `proposalValidityDays` | 15 | HIPÓTESE (protótipo v0.1) |
| `maxInstallmentsDivisor` | 20 | HIPÓTESE (planilha Disalp) |
| `formExpiryHours` | 72 | HIPÓTESE |
| `multipliers` | complexidade 1,00–1,20; nº consultores 1,00–1,20; capacidade (<65% 1,00; 65–75% 1,05; 75–85% 1,125; >85% 1,175); porte (ME 1,00; EPP 1,05; Médio 1,10; Grande 1,13); cartão 1,0325; captação (digital 1,05; outbound 1,025; inbound/MEJ 1,00); modalidade (presencial 1,00; híbrido 0,90; remoto 0,85); descontos (Black November 0,85; Dia do Consumidor 0,8725; indicação 0,85; inovação 0,85); terceirização (completa 1,35; Ray 1,125; Íon 1,075; Orbit 1,125; MEJ 1,115; ODD 1,00; Falaê 1,20; múltiplas 1,15) | Contexto §9.3 |
| `contingency` / `iss` | 1,20 / 1,05 | Contexto §9.3 |
| `dailyConsultant` / `dailyManager` | 2,92 h / 5,03 h × `hourCost` | Contexto §9.3 |
| `expectedFactor` / `maxFactor` | 1,1 / 1,2 | Contexto §9.3 |

Nenhum desses valores aparece no código fora da semente; teste de busca garante.

## 7. Motor (domain, funções puras)

Definições: V = valor (apresentado antes da venda; vendido depois), C = custos externos previstos, d = dias úteis, m = consultores + GP (GN e CS não entram).

- `computeMargins({V, C, d, m}, params)`:
  - caixa = V − tax·V − C
  - horas = d × m × plannedHoursPerMemberDay
  - contribuição = caixa − horas × hourCost; pctContribuição = contribuição ÷ V
  - resultadoTotal = contribuição − salesTime·V − backoffice·V; pctResultado = resultadoTotal ÷ V
  - piso = d × m × floorPerMemberDay
  - semáforo (sobre pctContribuição): verde ≥ greenMin; amarelo ≥ yellowMin; vermelho abaixo
  - alertas: `EXTERNAL_COST` se C > externalCostAlert·V; `BELOW_FLOOR` se V < piso
  - `requiresException` = V < piso **ou** pctContribuição < yellowMin
  - V = 0: percentuais nulos, semáforo vermelho, `requiresException` verdadeiro (sem divisão por zero)
- `computeCalculatedPrice(inputs, params)`:
  - CONFIRMADO (contexto §9.3): valor final = (C × contingency + preço ajustado × terceirização) × iss, com **iss uma vez só**; esperado = mínimo × expectedFactor; máximo = mínimo × maxFactor; diárias de consultor e gerente = horas × custo da hora.
  - HIPÓTESE (o contexto não diz como o mínimo e o preço ajustado são compostos): mínimo = (dias × consultores × diária consultor + dias × GP × diária gerente); preço ajustado = mínimo × produto dos multiplicadores aplicáveis. Antes da implementação, conferir na planilha `PLAN_Precificacao_Caso_Russa_Estruturacao_Financeira.xlsx` e ajustar; a composição fica isolada numa função para trocar sem mexer no resto.
  - Devolve mínimo, esperado, máximo, valor final e memória de cálculo (cada fator usado). PENDENTE: validação pelo DP contra Russa e RS Motoristas.
- `maxInstallments(d)` = teto(d ÷ maxInstallmentsDivisor) + 1.
- `splitInstallments(V, n)`: n parcelas iguais em centavos, sobra na última.
- `addBusinessDays(start, n, holidays)`: pula sábado, domingo e feriados da tabela.

### Golden tests (obrigatórios; h = 24,2884 e h = 23,45; tolerância R$ 0,01 e 0,1 p.p.)

| Caso | V | d | m | C | Piso | Contribuição | % contrib. | % resultado total |
|---|---|---|---|---|---|---|---|---|
| Padrão | 15.000 | 60 | 3 | 0 | 13.500 | 9.878,09 / 10.029,00 | 65,9% / 66,9% | 50,1% / 51,1% |
| Russa | 9.346,69 | 27 | 3 | 360 | 6.075 | — | 70,1% / 70,8% | 54,3% / 55,1% |
| Brutos e Regis | 12.000 | 81 | 3 | 0 | 18.225 (exceção) | — | 45,8% / 47,5% | 30,05% / 31,75% |
| Piso 20×3 | 4.500 | 20 | 3 | 0 | 4.500 | — | 63,7% (verde) | 48,0% |

Bordas: V = 0; C = 15% de V e logo acima; pctContribuição exatamente 30% e 55%; V exatamente igual ao piso; publicar parâmetros novos não altera versões de proposta antigas.

## 8. Regras de fluxo (aplicadas no servidor)

1. **Importar deal** (`POST /api/deals/:dealId/import`): lê o deal no conector Pipedrive (mock) e cria proposta + versão 1 em rascunho. Reimportar devolve a proposta existente.
2. **Editar** (`POST /api/proposals/:id/versions`): qualquer mudança de escopo, d, m, C, preço apresentado, valor vendido ou parcelas cria versão nova com recálculo. A aprovação da versão anterior não vale para a nova. Atividade fora do catálogo com risco marcado → exige exceção (HIPÓTESE D8).
3. **Aprovar preço** (`POST /api/proposals/:id/approvals`): sem exceção → GN, DP ou Diretoria aprovam com um clique. Com exceção → só DP ou Diretoria, e quem pediu não aprova. Registro: decisor, data, versões de catálogo e parâmetros.
4. **Enviar proposta** (`POST /api/proposals/:id/send`): exige aprovação válida da versão atual. Gera a visão do cliente pelo filtro de saída (sem margem, custo, piso, parâmetros nem alertas). Job `pipedrive.updateDeal` (mock) grava etapa, valor, link, validade.
5. **Registrar positiva**: versão com valor vendido; se abaixo do piso ou contribuição < 30% → exceção antes do contrato.
6. **Formulário do cliente** (`POST /api/proposals/:id/contract-form` → link; `GET/POST /api/forms/:token`): token de uso único, expira em `formExpiryHours`; valida CPF, CNPJ, CEP e e-mail; não mostra preço. Dados pessoais vão para `contract_personal` cifrados.
7. **Gerar contrato** (`POST /api/proposals/:id/contract`): Quadro Resumo + Anexo II a partir da versão aprovada e do formulário; nenhum campo variável vazio. Checagem proposta × contrato × deal (valor, parcelas, prazo, ID da proposta): divergência → 409.
8. **Aprovar contrato**: GN dentro da regra; DP em exceção. Depois, a pessoa sobe no Clicksign manualmente e informa o ID do envelope (`POST /api/contracts/:id/envelope`).
9. **Webhook Clicksign** (`POST /api/webhooks/clicksign`): valida `Content-Hmac: sha256=…` sobre o corpo bruto; inválido → 401. Grava o evento, responde 2xx e enfileira. Evento `sign` do signatário cliente → job `pipedrive.markWon` + job `monday.createProject` (idempotente por deal via `external_links`).
10. **Reprocesso** (`POST /api/jobs/:id/retry`): só Administração; não duplica (idempotência).

Leitura de CPF/RG (`GET /api/contracts/:id/personal`): só perfis com permissão (GN e Diretoria, matriz do plano v0.1 §10); cada leitura gera `audit_events`.

## 9. Permissões (matriz do plano v0.1 §10)

| Capacidade | GN | GP | DP | Diretoria | Admin |
|---|---|---|---|---|---|
| Montar escopo, preço e proposta | sim | não | leitura | leitura | não |
| Aprovar preço/contrato dentro da regra | sim | não | sim | não | não |
| Aprovar exceção | não | não | sim | sim | não |
| Ver margem e semáforo | sim | não (PENDENTE) | sim | sim | não |
| Ver CPF/RG | sim | não | não | sim | não |
| Ver pacote de passagem | sim | sim | sim | sim | não |
| Editar catálogo | sugere | não | sim | não | não |
| Publicar parâmetros | não | não | sim | não | não |
| Usuários, conectores, reprocesso | não | não | não | não | sim |

Auth mock: header `X-User-Id` (o v14 envia o usuário do seletor). Produção troca por login institucional sem mudar as checagens.

## 10. Conectores e fila

- Interface por conector em `connectors/<nome>/interface.ts`; `mock.ts` grava em memória/banco e registra em `connector_runs`; `real.ts` é esqueleto que lança "não configurado".
- Seleção por `.env` (`PIPEDRIVE_MODE=mock|real` etc.); padrão `mock`.
- Fila: `jobs` com chave de idempotência única; worker em processo (intervalo curto) pega jobs `pending` com `next_at` vencido; falha → `attempts+1`, `next_at` com backoff exponencial; após 5 tentativas → `failed`. Reprocesso reabre o job.
- Payloads de job e logs nunca contêm CPF, RG nem endereço do representante (teste varre).
- Mock Pipedrive tem deals fictícios na etapa "Diagnóstico realizado" (os do v14).

## 11. Critérios de aceite (cada um vira teste)

| Critério | Teste |
|---|---|
| Parâmetros numa tabela só | busca no `src/` sem constantes financeiras; troca de parâmetro gera nova versão |
| Golden tests | tabela da seção 7, com os dois custos da hora |
| Versão antiga reabre com as versões da época | publicar parâmetros/catálogo novos e reabrir proposta antiga com os valores originais |
| Aprovação antes do envio | enviar sem aprovação → 409 |
| Invalidação | alterar 1 dia do escopo → aprovação da versão nova pendente |
| Exceção só DP/Diretoria; quem pede não aprova | GN aprovando exceção → 403 |
| Proposta sem margem | varredura da visão do cliente por campos de margem/custo/piso |
| Divergência proposta × contrato × deal bloqueia | contrato com parcela diferente → 409 |
| Formulário de uso único | segundo uso → 410; expirado → 410 |
| CPF/RG restritos e auditados | GP lendo → 403; GN lendo → registro em auditoria; banco guarda cifrado |
| Webhook validado | HMAC errado → 401 |
| Sem duplicar projeto | mesmo evento de assinatura duas vezes → um item Monday |
| Reprocesso | job que falha, reprocesso, sucesso, sem duplicar |
| Auditoria imutável | `UPDATE` em `audit_events` → erro do banco |
| Dados pessoais fora de jobs/logs | varredura dos payloads |
| Ponta a ponta | roteiro do cliente fictício passa inteiro |

## 12. Front (v14)

- O backend serve `web/plataforma-aceana-v14.html` em `/`.
- A camada de dados do v14 (estado em memória e funções de cálculo) é trocada por um cliente `api` (fetch) com o `X-User-Id` do seletor. Telas, textos e visual ficam iguais; preço, margem e semáforo exibidos vêm da API.
- O verificador do v14 deixa de comparar o JS com o v13 (a camada de dados muda por design); passa a verificar que o front não tem constantes financeiras nem fórmula de margem.

## 13. Pendências registradas (não bloqueiam a demo)

- Validação da fórmula do preço calculado contra Russa e RS Motoristas (DP).
- Alçada de desconto, prazo de resposta e acúmulo de indicação (D3): não estão na KB; hoje só piso e 30% disparam exceção.
- Limite de corte do escopo e critério de risco (D8): hipótese.
- Validade da proposta (15 dias) e expiração do formulário (72 h): hipóteses.
- Quem vê margem no Pipedrive (N2) e se o GP vê margem.
- Contrato: o dicionário v0 tem 14 campos, o briefing fala em 15; contrato Disalp com correções pendentes.
- Catálogo semente: multiplicador de complexidade corrompido (datas seriais do Excel); dias não validados (D4).
- Aba "Como ler" da Rentabilidade ainda com o semáforo antigo.
- Base tecnológica final e responsável técnico (D7).

## 14. Ordem de construção

1. Fundação: projeto TS, PGlite, migrações, auditoria, parâmetros versionados.
2. Motor com golden tests (primeiro verde) + catálogo semente.
3. Propostas, versões, escopo e recálculo (API).
4. Aprovações e invalidação.
5. Envio da proposta + filtro de saída + fila + conector Pipedrive mock.
6. Formulário, contrato, checagem de consistência, dados pessoais cifrados.
7. Webhook Clicksign + Monday mock + reprocesso.
8. v14 ligado na API.
9. Teste de ponta a ponta + roteiro da demo + README.
