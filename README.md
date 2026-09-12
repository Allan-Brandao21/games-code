# Jarvis AOV — mobile

Dash de **AOV** (ticket médio) para o celular, alimentado pela API da
**PagAmerican** através do server MCP `pagamerican-data`.

O app parte de **pedidos** (front + order bump + upsells + downsell) e calcula
tudo no servidor, então a mesma tela serve para qualquer gateway que exponha
pedidos com line items.

## O que mostra

- **AOV** do período com variação vs. período anterior, **AOV só front** e
  **uplift por pedido** (quanto bump/upsells acrescentam sobre o front).
- **Take rate** de Order bump, Upsell 1, Upsell 2, Upsell 3 e Downsell 1,
  sempre sobre pedidos front.
- **AOV por dia** (linha) e **AOV por hora** (barras, horário de Brasília).
- **Funil de etapas**: pedidos, ticket, receita e participação de cada etapa.
- **Por produto**, **por nicho**, **por pote** (mix 1/3/6 unidades), **por
  afiliado** e **afiliados vs tráfego interno**, cada um com AOV, pedidos,
  receita e take rate de Upsell 1.
- **Últimos pedidos** com as etapas que cada um levou (Front · Bump · US1…).
- **Filtros**: período (hoje, ontem, 7 dias, 30 dias, mês), produto, tráfego e pote.
- Aba **API** lista os tools do server MCP e chama qualquer um direto do
  celular, para inspecionar o formato real dos pedidos.
- Abre como app (Adicionar à tela inicial) e funciona offline com o último
  dashboard carregado.

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
| `mock` | Pedidos de exemplo determinísticos. Padrão, para desenvolver sem a API. |
| `mcp`  | Sobe o server MCP da PagAmerican via stdio (mesmo comando do `claude mcp add`), busca os pedidos do período (com paginação) e agrega. |
| `rest` | Busca pedidos em `PAGAMERICAN_API_URL + PAGAMERICAN_ORDERS_PATH` por HTTP, se a PagAmerican expuser. |

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

O bridge lista os tools e escolhe o que tiver `order`, `pedido`, `transaction`
ou `sale` no nome. Se errar, fixe com `PAGAMERICAN_MCP_ORDERS_TOOL=nome_do_tool`.
Os argumentos de período são detectados pelo schema do tool (`from/to`,
`start_date/end_date`, `since/until`…) ou fixados com
`PAGAMERICAN_MCP_FROM_ARG` / `PAGAMERICAN_MCP_TO_ARG`. Paginação por
`page`/`offset`/`cursor` é seguida enquanto a resposta trouxer `has_more` ou
`next_cursor`.

## Como um pedido é lido

`server/normalize.mjs` converte cada registro da API em:

```jsonc
{
  "id": "PAG-123", "time": "2026-09-12T15:00:00Z",
  "product": "AlkaPic", "niche": "Disfunção Erétil",
  "affiliate": "Gil Jardim", "traffic": "affiliates",   // ou "internal"
  "units": 3,                                            // pote
  "status": "approved",                                  // refunded | chargeback | declined | pending
  "items": [{ "step": "front", "amount": 177 }, { "step": "us1", "amount": 147 }],
  "total": 324
}
```

Aceita chaves em inglês e português (`order_id`/`pedido_id`, `created_at`/`data`,
`product_name`/`produto`, `affiliate_name`/`afiliado`, `is_house_traffic`,
`quantity`/`potes`, `line_items`/`itens`…). A etapa de cada item é deduzida do
nome/sku/tipo (`Upsell 1`, `OTO2`, `Order Bump`, `Downsell`…) e colunas achatadas
como `upsell_1_amount` ou `bump_amount` também viram itens. Sem itens, o pedido
conta como só front.

Se a resposta real da PagAmerican usar outros nomes, ajuste `ALIASES`,
`STEP_RULES` e `extractOrders` em `server/normalize.mjs`. A aba **API** mostra a
resposta crua de cada tool para facilitar.

## Métricas (`server/aov.mjs`)

- **Pedidos** = pedidos com status diferente de recusado/pendente.
- **AOV** = receita total (todas as etapas) ÷ pedidos.
- **AOV só front** = receita do front ÷ pedidos. **Uplift** = AOV − AOV front.
- **Take rate** da etapa = pedidos que levaram a etapa ÷ pedidos.
- **AOV por hora** usa `HOUR_OFFSET` (padrão −3, Brasília).
- Variações comparam com o período imediatamente anterior de mesmo tamanho.

## Endpoints do servidor

| Rota | Descrição |
|------|-----------|
| `GET /api/health` | Fonte ativa e se o MCP está configurado. |
| `GET /api/dashboard?range=today\|yesterday\|7d\|30d\|mtd&product=&traffic=&pote=&fresh=1` | Dashboard agregado (cache de 60 s). |
| `GET /api/mcp/tools` | Tools expostos pelo server MCP. |
| `POST /api/mcp/call` `{ "name", "args" }` | Chama um tool e devolve o resultado. |

## Estrutura

```
server/
  index.mjs        servidor HTTP + rotas /api
  datasource.mjs   escolhe mock | mcp | rest (com cache)
  mcp-bridge.mjs   cliente MCP via stdio, com paginação
  rest.mjs         cliente HTTP direto
  mock.mjs         pedidos de exemplo
  normalize.mjs    resposta da API -> pedidos
  aov.mjs          pedidos -> métricas do dashboard
  range.mjs        períodos
public/
  index.html, app.js, styles.css, sw.js, manifest.webmanifest, icon.svg
```

## Testes

```bash
npm test
```
