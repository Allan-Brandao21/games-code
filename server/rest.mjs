// Fonte REST direta, caso a PagAmerican exponha HTTP além do MCP.
import { config } from './env.mjs';
import { resolveRange } from './range.mjs';
import { normalizeLoose } from './normalize.mjs';

export async function restDashboard(rangeKey) {
  if (!config.apiKey) throw new Error('PAGAMERICAN_API_KEY não definida');
  const range = resolveRange(rangeKey);
  const url = new URL(config.rest.dashboardPath, config.rest.baseUrl);
  url.searchParams.set('from', range.from);
  url.searchParams.set('to', range.to);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.apiKey}`, 'X-API-Key': config.apiKey, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`REST ${res.status} ${res.statusText} em ${url.pathname}`);
  const raw = await res.json();
  return normalizeLoose(raw, { source: 'rest', range });
}
