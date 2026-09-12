// Fonte REST direta, caso a PagAmerican exponha HTTP além do MCP.
import { config } from './env.mjs';
import { resolveRange } from './range.mjs';
import { normalizeOrders } from './normalize.mjs';
import { aggregate } from './aov.mjs';

async function fetchOrders(from, to) {
  const url = new URL(config.rest.ordersPath, config.rest.baseUrl);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.apiKey}`, 'X-API-Key': config.apiKey, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`REST ${res.status} ${res.statusText} em ${url.pathname}`);
  return normalizeOrders(await res.json());
}

export async function restDashboard(rangeKey, filters = {}) {
  if (!config.apiKey) throw new Error('PAGAMERICAN_API_KEY não definida');
  const range = resolveRange(rangeKey);
  const [orders, prevOrders] = await Promise.all([fetchOrders(range.from, range.to), fetchOrders(range.prevFrom, range.prevTo)]);
  return aggregate({ orders, prevOrders, range, filters, source: 'rest' });
}
