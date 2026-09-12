import { config } from './env.mjs';
import { mockDashboard } from './mock.mjs';
import { mcpDashboard } from './mcp-bridge.mjs';
import { restDashboard } from './rest.mjs';

const SOURCES = { mock: mockDashboard, mcp: mcpDashboard, rest: restDashboard };
const cache = new Map();
const TTL = 60_000;

export async function getDashboard(rangeKey, filters = {}, { source = config.dataSource, fresh = false } = {}) {
  const fn = SOURCES[source];
  if (!fn) throw new Error(`DATA_SOURCE inválido: ${source} (use mock, mcp ou rest)`);
  const key = `${source}:${rangeKey}:${JSON.stringify(filters)}`;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.data;
  const data = await fn(rangeKey, filters);
  cache.set(key, { at: Date.now(), data });
  return data;
}
