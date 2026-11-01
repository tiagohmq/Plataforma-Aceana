# Protótipo v14 — Plataforma ACEANA (visual Neone)

Arquivo único: `plataforma-aceana-v14.html`. Abra com dois cliques no navegador. Não precisa de servidor.

Origem: cópia do "Plataforma Java" (v13) com tema escuro preto e amarelo e uma landing na frente. Regras, textos e cálculos são os mesmos do original.

## Verificação automática

```bash
node --test prototipo/check-v14.test.mjs
```

Por padrão o teste compara com o original guardado em `prototipo/referencia/plataforma-java-v13.html`. Para usar outro caminho, defina `ORIG`.

Confere: o JS de negócio é o do original (linhas trocadas só as de `ALLOWED_CHANGED`, linhas novas fora dos blocos NEONE só as de `ALLOWED_ADDED`, mesmo número de `<script>`, blocos NEONE sem redefinir nomes do original); contraste AA dos tokens; nenhuma cor hex fora do `:root`; cards sem `backdrop-filter`; e o shader só anima na landing.

## Como servir localmente (opcional)

Para testar num navegador automatizado, que não interage com `file://`:

```bash
python -m http.server 5174 --directory prototipo
```

Depois abra `http://localhost:5174/plataforma-aceana-v14.html`.

## Roteiro de verificação visual

1. `#inicio` (landing): onda amarela animada, javali, botão "Entrar na plataforma".
2. `#painel`, `#propostas`, `#aprovacoes`, `#catalogo`, `#integracoes`, `#administracao`, `#auditoria`, `#cliente`.
3. Uma proposta (`#proposta-ACE-2026-015`), passando por todas as abas.
4. Modal "+ Nova proposta", um toast e a troca de perfil.
5. Console sem erros; em 375 px, sem rolagem lateral.
6. Comparar com o original: mesmos textos e valores nas mesmas telas (na verificação de 01/11, as 32 telas bateram).
