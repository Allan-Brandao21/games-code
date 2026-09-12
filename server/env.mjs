// Carrega .env (sem dependências) e expõe a configuração do servidor.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadDotEnv(file = path.join(root, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv();

export const config = {
  root,
  publicDir: path.join(root, 'public'),
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  appToken: process.env.APP_TOKEN || '',
  dataSource: (process.env.DATA_SOURCE || 'mock').toLowerCase(),
  apiKey: process.env.PAGAMERICAN_API_KEY || '',
  mcp: {
    server: process.env.PAGAMERICAN_MCP_SERVER || '',
    ordersTool: process.env.PAGAMERICAN_MCP_ORDERS_TOOL || '',
    fromArg: process.env.PAGAMERICAN_MCP_FROM_ARG || 'from',
    toArg: process.env.PAGAMERICAN_MCP_TO_ARG || 'to',
    pageSize: Number(process.env.PAGAMERICAN_MCP_PAGE_SIZE || 500),
    maxPages: Number(process.env.PAGAMERICAN_MCP_MAX_PAGES || 40),
    comparePrevious: process.env.PAGAMERICAN_MCP_COMPARE_PREVIOUS !== '0',
  },
  rest: {
    baseUrl: process.env.PAGAMERICAN_API_URL || 'https://api.pagamerican.com',
    ordersPath: process.env.PAGAMERICAN_ORDERS_PATH || '/v1/orders',
  },
};
