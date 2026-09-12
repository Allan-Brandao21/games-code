// Bridge para o server MCP "pagamerican-data": sobe o processo via stdio
// (igual ao `claude mcp add pagamerican-data -- node .../server.js`), lista os
// tools e chama o que devolve o resumo do dashboard.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { config } from './env.mjs';
import { resolveRange } from './range.mjs';
import { normalizeLoose } from './normalize.mjs';

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
  const client = new Client({ name: 'jarvis-mobile', version: '0.1.0' });
  client.onclose = () => { clientPromise = null; toolsCache = { at: 0, tools: [] }; };
  await client.connect(transport);
  return client;
}

export async function getClient() {
  if (!clientPromise) {
    clientPromise = connect().catch((err) => { clientPromise = null; throw err; });
  }
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

// Respostas MCP vêm como content[] (text/json). Extrai o primeiro JSON válido.
function unwrap(res) {
  if (res?.structuredContent) return res.structuredContent;
  const parts = res?.content || [];
  const texts = [];
  for (const c of parts) {
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

const DASH_HINT = /dashboard|summary|resumo|overview|metrics|metricas|kpi|stats/i;

export async function pickDashboardTool() {
  const tools = await listTools();
  if (config.mcp.dashboardTool) {
    const t = tools.find((x) => x.name === config.mcp.dashboardTool);
    if (!t) throw new Error(`tool "${config.mcp.dashboardTool}" não existe. Disponíveis: ${tools.map((x) => x.name).join(', ')}`);
    return t;
  }
  const t = tools.find((x) => DASH_HINT.test(x.name) || DASH_HINT.test(x.description || ''));
  if (!t) {
    throw new Error(`nenhum tool parece ser o dashboard. Defina PAGAMERICAN_MCP_DASHBOARD_TOOL. Disponíveis: ${tools.map((x) => x.name).join(', ')}`);
  }
  return t;
}

function buildArgs(tool, range) {
  const props = tool.inputSchema?.properties || {};
  const args = {};
  const set = (candidates, value) => {
    for (const c of candidates) if (props[c] !== undefined) { args[c] = value; return true; }
    return false;
  };
  if (!set([config.mcp.fromArg, 'from', 'start', 'start_date', 'startDate', 'date_from', 'since'], range.from)) args[config.mcp.fromArg] = range.from;
  if (!set([config.mcp.toArg, 'to', 'end', 'end_date', 'endDate', 'date_to', 'until'], range.to)) args[config.mcp.toArg] = range.to;
  set(['period', 'range'], range.key);
  return args;
}

export async function mcpDashboard(rangeKey) {
  const range = resolveRange(rangeKey);
  const tool = await pickDashboardTool();
  const raw = await callTool(tool.name, buildArgs(tool, range));
  const data = normalizeLoose(raw, { source: 'mcp', range });
  data.tool = tool.name;
  return data;
}

export async function closeMcp() {
  if (!clientPromise) return;
  try { (await clientPromise).close(); } catch { /* ignora */ }
  clientPromise = null;
}
