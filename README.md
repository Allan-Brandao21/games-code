# Jarvis Mobile

Versão mobile (PWA) do dash **Jarvis**, alimentada pela API da **PagAmerican**
através do server MCP `pagamerican-data` que eles liberaram.

- Abre no celular como app (Adicionar à tela inicial), tema escuro, navegação por abas.
- KPIs: receita, pedidos, ticket médio, aprovação, take rate de upsell, refunds,
  chargebacks e líquido, com variação vs. período anterior.
- Gráfico de receita por dia, ranking de produtos e afiliados, últimas transações
  com filtro por status.
- Aba **API** lista os tools do server MCP e chama qualquer um direto do celular
  (útil para descobrir o formato dos dados e ajustar o mapeamento).
- Funciona offline com o último dashboard carregado.

A chave da PagAmerican fica **só no servidor** (`.env`). O celular nunca a recebe.

## Rodando

```bash
npm install
cp .env.example .env     # preencha PAGAMERICAN_API_KEY e o caminho do server MCP
npm start                # http://localhost:3000
```

No celular, acesse o IP da máquina na mesma rede (ex.: `http://192.168.0.10:3000`)
ou publique atrás de um túnel/host (Tailscale, Cloudflare Tunnel, Railway, Fly…).
Defina `APP_TOKEN` no `.env` e abra `http://host:3000/?token=SEU_TOKEN` uma vez para
gravar o cookie de acesso.

## Fontes de dados (`DATA_SOURCE`)

| Valor  | O que faz |
|--------|-----------|
| `mock` | Dados de exemplo determinísticos. Padrão, para desenvolver sem a API. |
| `mcp`  | Sobe o server MCP da PagAmerican via stdio (mesmo comando do `claude mcp add`) e chama o tool de dashboard. |
| `rest` | Chama `PAGAMERICAN_API_URL + PAGAMERICAN_DASHBOARD_PATH` direto por HTTP, se a PagAmerican expuser. |

### Configurando o MCP

O comando que a PagAmerican passou:

```bash
claude mcp add pagamerican-data \
  --env PAGAMERICAN_API_KEY=pag_your_key \
  -- node /absolute/path/to/mcp/dist/server.js
```

vira, no `.env`:

```
DATA_SOURCE=mcp
PAGAMERICAN_API_KEY=pag_your_key
PAGAMERICAN_MCP_SERVER=/absolute/path/to/mcp/dist/server.js
```

O bridge lista os tools e escolhe automaticamente o que tiver `dashboard`,
`summary`, `metrics`, `overview` ou `kpi` no nome/descrição. Se errar, fixe com
`PAGAMERICAN_MCP_DASHBOARD_TOOL=nome_do_tool`. Os argumentos de período são
detectados pelo schema do tool (`from/to`, `start_date/end_date`, `since/until`…)
ou fixados com `PAGAMERICAN_MCP_FROM_ARG` / `PAGAMERICAN_MCP_TO_ARG`.

## Contrato de dados

Toda fonte é normalizada em `server/normalize.mjs` para o formato que o app usa:

```jsonc
{
  "source": "mcp",
  "range": { "key": "7d", "from": "2026-09-06", "to": "2026-09-12" },
  "kpis": { "revenue": 0, "orders": 0, "aov": 0, "approvalRate": 0, "refunds": 0,
            "refundAmount": 0, "chargebacks": 0, "chargebackAmount": 0, "upsellTakeRate": 0 },
  "deltas": { "revenue": 0, "orders": 0, "aov": 0, "approvalRate": 0 },   // % vs período anterior
  "series": [{ "date": "2026-09-06", "revenue": 0, "orders": 0 }],
  "products": [{ "name": "", "revenue": 0, "orders": 0, "refundRate": 0 }],
  "affiliates": [{ "name": "", "revenue": 0, "orders": 0 }],
  "recent": [{ "id": "", "time": "", "product": "", "affiliate": "", "amount": 0, "status": "approved" }]
}
```

O normalizador aceita chaves em inglês e português (`revenue`/`receita`,
`orders`/`pedidos`, `by_day`/`por_dia`, `transactions`/`transacoes`…). Se a
resposta real da PagAmerican usar nomes diferentes, ajuste `KEY_ALIASES` e as
listas de `firstArray` em `server/normalize.mjs`. A aba **API** do app mostra a
resposta crua de cada tool para facilitar esse ajuste.

## Endpoints do servidor

| Rota | Descrição |
|------|-----------|
| `GET /api/health` | Fonte ativa e se o MCP está configurado. |
| `GET /api/dashboard?range=today\|yesterday\|7d\|30d\|mtd&fresh=1` | Dashboard normalizado (cache de 60 s). |
| `GET /api/mcp/tools` | Tools expostos pelo server MCP. |
| `POST /api/mcp/call` `{ "name", "args" }` | Chama um tool e devolve o resultado. |

## Estrutura

```
server/
  index.mjs        servidor HTTP + rotas /api
  datasource.mjs   escolhe mock | mcp | rest (com cache)
  mcp-bridge.mjs   cliente MCP via stdio
  rest.mjs         cliente HTTP direto
  mock.mjs         dados de exemplo
  normalize.mjs    contrato de dados
  range.mjs        períodos
public/
  index.html, app.js, styles.css, sw.js, manifest.webmanifest, icon.svg
```

## Testes

```bash
npm test
```
