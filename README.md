# Plataforma ACEANA de Propostas

Plataforma da A.C.E. que cobre do diagnóstico realizado ao projeto iniciado: catálogo, escopo, preço e margem prevista, aprovações, proposta, contrato e passagem para projetos, integrada ao Pipedrive, ao Monday e ao Clicksign.

## O que tem aqui

- `prototipo/plataforma-aceana-v14.html` — protótipo navegável em arquivo único (abre com dois cliques). Landing + app em tema escuro preto e amarelo. Clientes e valores fictícios.
- `prototipo/referencia/plataforma-java-v13.html` — versão anterior (tema claro), usada como referência pelo verificador.
- `prototipo/check-v14.test.mjs` — verificação automática (`node --test prototipo/check-v14.test.mjs`, Node 20+).
- `docs/decisoes.md` — o que foi decidido e por quê.
- `docs/superpowers/` — specs e planos (redesign visual e backend).
- `docs/roteiro-demo.md` — roteiro da apresentação.
- `src/` — backend (TypeScript): `domain` (regras puras), `modules` (banco + regras), `connectors` (mock e real), `jobs` (fila), `http` (API).

Detalhes do protótipo em [prototipo/README.md](prototipo/README.md).

## Rodar o backend

Precisa de Node 24.

```bash
npm install
cp .env.example .env
```

No `.env`, preencha `CONTRACT_KEY` (32 bytes em base64) e `CLICKSIGN_HMAC_SECRET`. Para gerar a chave:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Depois:

```bash
npm start
```

A API sobe em `http://localhost:3333`. O banco (Postgres embutido, PGlite) fica na pasta `data/`; para zerar, pare o servidor e apague `data/`. Os usuários de teste estão em `src/db/seeds/users.ts` e a API identifica o usuário pelo header `X-User-Id`.

## Testes

```bash
npm test
```

Inclui os golden tests do motor de margem (custo da hora R$ 24,2884 e R$ 23,45), o preço calculado da planilha Russa, permissões por perfil, invalidação de aprovação, filtro da proposta do cliente, formulário de uso único, CPF cifrado, webhook com HMAC, fila com reprocesso e o fluxo de ponta a ponta.

## Conectores

Pipedrive, Monday e Drive rodam em modo simulado (`*_MODE=mock` no `.env`). Cada um tem `interface.ts`, `mock.ts` e `real.ts` (esqueleto) em `src/connectors/`. O Clicksign não tem envio automático (decisão de 01/11): a plataforma gera o contrato e recebe o webhook em `/api/webhooks/clicksign`. Falhas de integração ficam em `GET /api/jobs` e são reprocessadas com `POST /api/jobs/:id/retry` (perfil Administração).
