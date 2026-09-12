// Pedidos de exemplo determinísticos (mesma data => mesmos pedidos), para
// desenvolver o dash sem a API. Produtos/nichos/etapas espelham a operação.
import { resolveRange, eachDay } from './range.mjs';
import { aggregate } from './aov.mjs';

const PRODUCTS = [
  { name: 'AlkaPic', niche: 'Disfunção Erétil', front: { 1: 69, 3: 177, 6: 294 }, us1: 147, us2: 97, us3: 49, ds1: 67, bump: 19, weight: 1.0 },
  { name: 'JellyBlue', niche: 'Disfunção Erétil', front: { 1: 79, 3: 197, 6: 314 }, us1: 149, us2: 99, us3: 39, ds1: 69, bump: 19, weight: 0.6 },
  { name: 'Lasiberry', niche: 'Emagrecimento', front: { 1: 69, 3: 177, 6: 294 }, us1: 129, us2: 89, us3: 49, ds1: 59, bump: 17, weight: 0.8 },
  { name: 'AlphaSteel', niche: 'Pressão Alta', front: { 1: 59, 3: 147, 6: 234 }, us1: 119, us2: 79, us3: 39, ds1: 49, bump: 15, weight: 0.7 },
  { name: 'HoneyBoost', niche: 'Neuropatia', front: { 1: 49, 3: 127, 6: 204 }, us1: 99, us2: 69, us3: 39, ds1: 39, bump: 15, weight: 0.5 },
  { name: 'PrimeAge', niche: 'Diabetes', front: { 1: 99, 3: 237, 6: 354 }, us1: 179, us2: 119, us3: 59, ds1: 79, bump: 24, weight: 0.4 },
];
const AFFILIATES = [
  ['Gil Jardim', 0.26], ['Kaplan Media', 0.18], ['North Traffic', 0.14], ['Squad AOV', 0.12], ['Direct', 0.10],
  ['LeadPeak', 0.08], ['Orgânico', 0.07], ['MediaFlow', 0.05],
];
const HOUR_WEIGHT = [2, 1.5, 1, 0.8, 0.7, 0.8, 1.2, 2, 3, 4, 4.5, 4.5, 4, 4, 4.2, 4.5, 4.8, 5, 5.2, 5.5, 5.4, 4.8, 3.8, 2.8];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
function weighted(r, pairs) {
  const total = pairs.reduce((a, [, w]) => a + w, 0);
  let x = r() * total;
  for (const [v, w] of pairs) { x -= w; if (x <= 0) return v; }
  return pairs[pairs.length - 1][0];
}

export function ordersForDay(date) {
  const r = rng(seedOf(date));
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const weekend = dow === 0 || dow === 6 ? 0.8 : 1;
  const n = Math.round(230 * weekend * (0.85 + r() * 0.35));
  const hourPairs = HOUR_WEIGHT.map((w, h) => [h, w]);
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = weighted(r, PRODUCTS.map((x) => [x, x.weight]));
    const internal = r() < 0.22;
    const affiliate = internal ? 'Interno' : weighted(r, AFFILIATES);
    const units = weighted(r, [[1, 0.55], [3, 0.3], [6, 0.15]]);
    const hour = weighted(r, hourPairs);
    const minute = Math.floor(r() * 60);
    // horário local (Brasília, -3) -> UTC
    const t = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), hour + 3, minute, Math.floor(r() * 60)));
    const items = [{ step: 'front', amount: p.front[units] }];
    const boost = internal ? 1.15 : 1;
    if (r() < 0.31 * boost) items.push({ step: 'bump', amount: p.bump });
    const tookUs1 = r() < (0.24 + (units === 1 ? 0.06 : 0)) * boost;
    if (tookUs1) {
      items.push({ step: 'us1', amount: p.us1 });
      if (r() < 0.33) items.push({ step: 'us2', amount: p.us2 });
      if (r() < 0.18) items.push({ step: 'us3', amount: p.us3 });
    } else if (r() < 0.11) {
      items.push({ step: 'ds1', amount: p.ds1 });
    }
    const status = weighted(r, [['approved', 0.93], ['refunded', 0.045], ['chargeback', 0.007], ['declined', 0.018]]);
    out.push({
      id: `PAG-${date.replace(/-/g, '').slice(2)}-${String(i + 1).padStart(3, '0')}`,
      time: t.toISOString(),
      product: p.name,
      niche: p.niche,
      affiliate,
      traffic: internal ? 'internal' : 'affiliates',
      units,
      gateway: 'pagamerican',
      status,
      items,
      total: items.reduce((a, it) => a + it.amount, 0),
    });
  }
  return out;
}

export function ordersBetween(from, to) {
  return eachDay(from, to).flatMap(ordersForDay);
}

export async function mockDashboard(rangeKey, filters = {}) {
  const range = resolveRange(rangeKey);
  const orders = ordersBetween(range.from, range.to);
  const prevOrders = ordersBetween(range.prevFrom, range.prevTo);
  return aggregate({ orders, prevOrders, range, filters, source: 'mock' });
}
