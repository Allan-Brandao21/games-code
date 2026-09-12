// Servidor do Jarvis Mobile: serve o PWA e expõe /api/* para o app.
// A chave da PagAmerican fica só aqui (env); o celular nunca a recebe.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './env.mjs';
import { RANGES } from './range.mjs';
import { getDashboard } from './datasource.mjs';
import { listTools, callTool, mcpConfigured, closeMcp } from './mcp-bridge.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function authorized(req, url) {
  if (!config.appToken) return true;
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const cookie = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith('jm_token='));
  const fromCookie = cookie ? decodeURIComponent(cookie.slice('jm_token='.length)) : '';
  return [bearer, url.searchParams.get('token'), fromCookie].includes(config.appToken);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

async function handleApi(req, url, res) {
  const p = url.pathname;
  if (p === '/api/health') {
    return json(res, 200, { ok: true, source: config.dataSource, mcpConfigured: mcpConfigured(), hasApiKey: Boolean(config.apiKey), ranges: RANGES });
  }
  if (p === '/api/dashboard') {
    const range = url.searchParams.get('range') || '7d';
    if (!RANGES.includes(range)) return json(res, 400, { error: `range inválido. Use: ${RANGES.join(', ')}` });
    const source = url.searchParams.get('source') || config.dataSource;
    const fresh = url.searchParams.get('fresh') === '1';
    const filters = {
      product: url.searchParams.get('product') || '',
      niche: url.searchParams.get('niche') || '',
      traffic: url.searchParams.get('traffic') || '',
      pote: url.searchParams.get('pote') || '',
    };
    try {
      const data = await getDashboard(range, filters, { source, fresh });
      return json(res, 200, data);
    } catch (err) {
      return json(res, 502, { error: String(err.message || err), source });
    }
  }
  if (p === '/api/mcp/tools') {
    try {
      const tools = await listTools(url.searchParams.get('fresh') === '1');
      return json(res, 200, { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    } catch (err) {
      return json(res, 502, { error: String(err.message || err) });
    }
  }
  if (p === '/api/mcp/call' && req.method === 'POST') {
    try {
      const { name, args } = await readBody(req);
      if (!name) return json(res, 400, { error: 'informe "name"' });
      const result = await callTool(name, args || {});
      return json(res, 200, { name, result });
    } catch (err) {
      return json(res, 502, { error: String(err.message || err) });
    }
  }
  return json(res, 404, { error: 'não encontrado' });
}

function serveStatic(url, res) {
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const abs = path.join(config.publicDir, file);
  if (!abs.startsWith(config.publicDir) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('não encontrado');
  }
  const ext = path.extname(abs);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' || file === '/sw.js' ? 'no-cache' : 'public, max-age=3600',
  });
  fs.createReadStream(abs).pipe(res);
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    if (!authorized(req, url)) return json(res, 401, { error: 'não autorizado' });
    return handleApi(req, url, res);
  }
  // Login por ?token= grava cookie e limpa a URL.
  if (config.appToken && url.searchParams.get('token') === config.appToken) {
    res.writeHead(302, { 'Set-Cookie': `jm_token=${encodeURIComponent(config.appToken)}; Path=/; Max-Age=31536000; SameSite=Lax`, Location: url.pathname });
    return res.end();
  }
  serveStatic(url, res);
});

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  server.listen(config.port, config.host, () => {
    console.log(`Jarvis AOV em http://${config.host}:${config.port}  (fonte: ${config.dataSource}${config.appToken ? ', com token' : ''})`);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => { await closeMcp(); server.close(); process.exit(0); });
  }
}
