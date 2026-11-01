# Roteiro da demo (05/11/2026)

Espelha o teste automático `tests/e2e.test.ts`. Cliente fictício: Mercearia Sol Nascente (deal 2018). Integrações simuladas.

## Antes de começar

```bash
npm install
npm start
```

Abra `http://localhost:3333`. Para recomeçar do zero: pare o servidor e apague a pasta `data/`.

## Passo a passo

| # | Quem | Ação | O que mostrar |
|---|---|---|---|
| 1 | Larissa (GN) | Funil → "Criar proposta" no deal Mercearia Sol Nascente | Proposta v1 nasce do deal, sem redigitar |
| 2 | Larissa | Escopo: Estruturação Financeira, 10 + 50 dias, 2 consultores + GP; preço R$ 15.000, 3 parcelas | Preço calculado, piso, as duas margens e o semáforo vêm do servidor |
| 3 | Larissa | Aprovar (dentro da regra) e enviar | Link do cliente sem margem; deal vai para "Proposta apresentada" |
| 4 | Larissa | Mudar 1 dia do escopo | Versão nova; aprovação volta a pendente (invalidação) |
| 5 | Larissa | Valor abaixo do piso | Exceção: GN não aprova; DP aprova; quem pediu não aprova |
| 6 | Larissa | Positiva: registrar valor vendido e aprovar; gerar link do formulário | Link de uso único com prazo |
| 7 | Cliente | Preencher o formulário (CPF/CNPJ fictícios válidos) | Segundo uso do link é recusado; CPF fica cifrado |
| 8 | Larissa | Gerar contrato (exclusões e nº de reuniões), aprovar, informar o ID do envelope | Conferência proposta × contrato × Pipedrive; Quadro Resumo e Anexo II sem campo vazio |
| 9 | Terminal | `node scripts/simular-assinatura.mjs env-demo-1 rita@solnascente.exemplo.com` | Webhook com HMAC: deal ganho, projeto no Monday (um só), pasta no Drive |
| 10 | Clara (GP) | Abrir o pacote de passagem | GP vê escopo e projeto, não vê margem nem CPF |
| 11 | Admin | Integrações: job com falha → reprocessar | Reprocesso com um clique, sem duplicar |

## Perguntas prováveis

- **Onde ficam os parâmetros?** Uma tabela versionada; cada proposta guarda a versão usada. Publicar novos não muda propostas antigas.
- **A IA define preço?** Não. Nesta versão não há IA no fluxo de preço; o motor é determinístico e testado.
- **E o Clicksign?** Upload manual por decisão de 01/11; a plataforma gera o contrato e recebe o retorno da assinatura.
