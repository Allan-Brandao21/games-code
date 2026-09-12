// Bridge para o server MCP "pagamerican-data": sobe o processo via stdio
// (igual ao `claude mcp add pagamerican-data -- node .../server.js`), lista os
// tools, busca os pedidos do período e agrega em métricas de AOV.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { config } from './env.mjs';
import { resolveRange } from './range.mjs';
import { normalizeOrders } from './normalize.mjs';
import { aggregate } from './aov.mjs';

let clientPromise = null;
let toolsCache = { at: 0, tools: [] };

export function mcpConfigured() {
  return Boolean(config.mcp.server && config.apiKey);
}

async function connect() {
  if (!mcpConfigured()) {
    throw new Error('MCP não configurado: defina PAGAMERICAN_MCP_SERVER e PAGAMERICAN_API_KEY no .env');
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [config.mcp.server],
    env: { ...process.env, PAGAMERICAN_API_KEY: config.apiKey },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (d) => process.stderr.write(`[mcp] ${d}`));
  const client = new Client({ name: 'jarvis-aov-mobile', version: '0.2.0' });
  client.onclose = () => { clientPromise = null; toolsCache = { at: 0, tools: [] }; };
  await client.connect(transport);
  return client;
}

export async function getClient() {
  if (!clientPromise) clientPromise = connect().catch((err) => { clientPromise = null; throw err; });
  return clientPromise;
}

export async function listTools(force = false) {
  if (!force && toolsCache.tools.length && Date.now() - toolsCache.at < 60_000) return toolsCache.tools;
  const client = await getClient();
  const res = await client.listTools();
  toolsCache = { at: Date.now(), tools: res.tools || [] };
  return toolsCache.tools;
}

export async function callTool(name, args = {}) {
  const client = await getClient();
  const res = await client.callTool({ name, arguments: args });
  return unwrap(res);
}

function unwrap(res) {
  if (res?.structuredContent) return res.structuredContent;
  const texts = [];
  for (const c of res?.content || []) {
    if (c.type === 'text') {
      texts.push(c.text);
      try { return JSON.parse(c.text); } catch { /* segue */ }
    }
    if (c.type === 'resource' && c.resource?.text) {
      try { return JSON.parse(c.resource.text); } catch { /* segue */ }
    }
  }
  if (res?.isError) throw new Error(texts.join('\n') || 'tool retornou erro');
  return { text: texts.join('\n') };
}

const ORDERS_HINT = /order|pedido|transaction|transacao|transação|sale|venda|purchase/i;

export async function pickOrdersTool() {
  const tools = await listTools();
  if (config.mcp.ordersTool) {
    const t = tools.find((x) => x.name === config.mcp.ordersTool);
    if (!t) throw new Error(`tool "${config.mcp.ordersTool}" não existe. Disponíveis: ${tools.map((x) => x.name).join(', ')}`);
    return t;
  }
  const t = tools.find((x) => ORDERS_HINT.test(x.name)) || tools.find((x) => ORDERS_HINT.test(x.description || ''));
  if (!t) throw new Error(`nenhum tool parece listar pedidos. Defina PAGAMERICAN_MCP_ORDERS_TOOL. Disponíveis: ${tools.map((x) => x.name).join(', ')}`);
  return t;
}

function buildArgs(tool, from, to, extra = {}) {
  const props = tool.inputSchema?.properties || {};
  const args = {};
  const set = (cands, value) => { for (const c of cands) if (props[c] !== undefined) { args[c] = value; return true; } return false; };
  if (!set([config.mcp.fromArg, 'from', 'start', 'start_date', 'startDate', 'date_from', 'since', 'data_inicio'], from)) args[config.mcp.fromArg] = from;
  if (!set([config.mcp.toArg, 'to', 'end', 'end_date', 'endDate', 'date_to', 'until', 'data_fim'], to)) args[config.mcp.toArg] = to;
  set(['limit', 'per_page', 'page_size', 'pageSize'], config.mcp.pageSize);
  for (const [k, v] of Object.entries(extra)) if (props[k] !== undefined) args[k] = v;
  return args;
}

// Pagina enquanto o tool devolver next_cursor / next_page / has_more.
async function fetchAllOrders(tool, from, to) {
  const all = [];
  let cursor;
  let page = 1;
  for (let i = 0; i < config.mcp.maxPages; i++) {
    const extra = cursor ? { cursor, next_cursor: cursor, page_token: cursor } : { page, offset: all.length };
    const raw = await callTool(tool.name, buildArgs(tool, from, to, extra));
    const batch = normalizeOrders(raw);
    all.push(...batch);
    const next = raw?.next_cursor ?? raw?.nextCursor ?? raw?.cursor?.next ?? raw?.pagination?.next_cursor;
    const hasMore = raw?.has_more ?? raw?.hasMore ?? raw?.pagination?.has_more ?? Boolean(next);
    if (!batch.length || !hasMore) break;
    cursor = next || undefined;
    page += 1;
    if (!cursor && !(tool.inputSchema?.properties?.page || tool.inputSchema?.properties?.offset)) break;
  }
  return all;
}

export async function mcpDashboard(rangeKey, filters = {}) {
  const range = resolveRange(rangeKey);
  const tool = await pickOrdersTool();
  const [orders, prevOrders] = await Promise.all([
    fetchAllOrders(tool, range.from, range.to),
    config.mcp.comparePrevious ? fetchAllOrders(tool, range.prevFrom, range.prevTo) : [],
  ]);
  const data = aggregate({ orders, prevOrders, range, filters, source: 'mcp' });
  data.tool = tool.name;
  return data;
}

export async function closeMcp() {
  if (!clientPromise) return;
  try { (await clientPromise).close(); } catch { /* ignora */ }
  clientPromise = null;
}
