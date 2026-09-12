// Dados de exemplo determinísticos (mesmo período => mesmos números), para
// desenvolver o app sem a API. Produtos/afiliados espelham a operação real.
import { eachDay, resolveRange } from './range.mjs';
import { delta, pct } from './normalize.mjs';

const PRODUCTS = [
  { name: 'AlkaPic', price: 69, weight: 1.0, refund: 0.028 },
  { name: 'Lasiberry', price: 79, weight: 0.8, refund: 0.031 },
  { name: 'AlphaSteel', price: 59, weight: 0.7, refund: 0.041 },
  { name: 'HoneyBoost', price: 49, weight: 0.6, refund: 0.022 },
  { name: 'JellyBlue', price: 89, weight: 0.5, refund: 0.036 },
  { name: 'PrimeAge', price: 99, weight: 0.4, refund: 0.019 },
];
const AFFILIATES = ['Gil Jardim', 'Kaplan Media', 'Squad AOV', 'North Traffic', 'Orgânico', 'Direct'];

// PRNG simples (mulberry32) semeado pela data para ser estável.
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

function dayStats(date) {
  const r = rng(seedOf(date));
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const weekend = dow === 0 || dow === 6 ? 0.78 : 1;
  const base = 240 * weekend * (0.85 + r() * 0.4);
  const byProduct = PRODUCTS.map((p) => {
    const orders = Math.round((base * p.weight) / 4 * (0.8 + r() * 0.4));
    const upsells = Math.round(orders * (0.22 + r() * 0.12));
    const revenue = orders * p.price + upsells * 39;
    const refunds = Math.round(orders * p.refund * (0.6 + r() * 0.8));
    const chargebacks = Math.round(orders * 0.006 * r() * 2);
    return { name: p.name, orders, upsells, revenue, refunds, refundAmount: refunds * p.price, chargebacks, chargebackAmount: chargebacks * p.price };
  });
  const attempts = byProduct.reduce((a, p) => a + p.orders, 0) / (0.72 + r() * 0.1);
  const byAffiliate = AFFILIATES.map((name, i) => {
    const share = [0.3, 0.22, 0.18, 0.13, 0.1, 0.07][i] * (0.85 + r() * 0.3);
    return { name, share };
  });
  return { byProduct, attempts, byAffiliate };
}

function aggregate(from, to) {
  const days = eachDay(from, to);
  const totals = { revenue: 0, orders: 0, upsells: 0, refunds: 0, refundAmount: 0, chargebacks: 0, chargebackAmount: 0, attempts: 0 };
  const products = new Map();
  const affiliates = new Map();
  const series = [];
  for (const date of days) {
    const d = dayStats(date);
    let dayRev = 0;
    let dayOrders = 0;
    for (const p of d.byProduct) {
      dayRev += p.revenue; dayOrders += p.orders;
      for (const k of ['revenue', 'orders', 'upsells', 'refunds', 'refundAmount', 'chargebacks', 'chargebackAmount']) totals[k] += p[k];
      const acc = products.get(p.name) || { name: p.name, revenue: 0, orders: 0, refunds: 0 };
      acc.revenue += p.revenue; acc.orders += p.orders; acc.refunds += p.refunds;
      products.set(p.name, acc);
    }
    totals.attempts += d.attempts;
    const shareSum = d.byAffiliate.reduce((a, x) => a + x.share, 0);
    for (const a of d.byAffiliate) {
      const acc = affiliates.get(a.name) || { name: a.name, revenue: 0, orders: 0 };
      acc.revenue += (dayRev * a.share) / shareSum;
      acc.orders += Math.round((dayOrders * a.share) / shareSum);
      affiliates.set(a.name, acc);
    }
    series.push({ date, revenue: Math.round(dayRev), orders: dayOrders });
  }
  return { totals, series, products: [...products.values()], affiliates: [...affiliates.values()] };
}

function recentTransactions(to, n = 30) {
  const r = rng(seedOf(`recent-${to}`));
  const statuses = ['approved', 'approved', 'approved', 'approved', 'approved', 'declined', 'refunded', 'pending', 'chargeback'];
  const out = [];
  let t = new Date(`${to}T23:59:00Z`).getTime();
  if (t > Date.now()) t = Date.now();
  for (let i = 0; i < n; i++) {
    t -= Math.round(r() * 14 * 60_000);
    const p = PRODUCTS[Math.floor(r() * PRODUCTS.length)];
    const hasUpsell = r() < 0.3;
    out.push({
      id: `PAG-${(seedOf(to) % 9000 + 1000 + i).toString()}`,
      time: new Date(t).toISOString(),
      product: p.name + (hasUpsell ? ' + Upsell' : ''),
      affiliate: AFFILIATES[Math.floor(r() * AFFILIATES.length)],
      amount: p.price + (hasUpsell ? 39 : 0),
      status: statuses[Math.floor(r() * statuses.length)],
    });
  }
  return out;
}

export async function mockDashboard(rangeKey) {
  const range = resolveRange(rangeKey);
  const cur = aggregate(range.from, range.to);
  const prev = aggregate(range.prevFrom, range.prevTo);
  const t = cur.totals;
  const aov = t.orders ? t.revenue / t.orders : 0;
  const prevAov = prev.totals.orders ? prev.totals.revenue / prev.totals.orders : 0;
  const approval = pct(t.orders, t.attempts);
  const prevApproval = pct(prev.totals.orders, prev.totals.attempts);
  return {
    source: 'mock',
    range: { key: range.key, from: range.from, to: range.to },
    kpis: {
      revenue: Math.round(t.revenue),
      orders: t.orders,
      aov: Math.round(aov * 100) / 100,
      approvalRate: Math.round(approval * 10) / 10,
      refunds: t.refunds,
      refundAmount: Math.round(t.refundAmount),
      chargebacks: t.chargebacks,
      chargebackAmount: Math.round(t.chargebackAmount),
      upsellTakeRate: Math.round(pct(t.upsells, t.orders) * 10) / 10,
    },
    deltas: {
      revenue: delta(t.revenue, prev.totals.revenue),
      orders: delta(t.orders, prev.totals.orders),
      aov: delta(aov, prevAov),
      approvalRate: delta(approval, prevApproval),
    },
    series: cur.series,
    products: cur.products
      .map((p) => ({ name: p.name, revenue: Math.round(p.revenue), orders: p.orders, refundRate: Math.round(pct(p.refunds, p.orders) * 10) / 10 }))
      .sort((a, b) => b.revenue - a.revenue),
    affiliates: cur.affiliates
      .map((a) => ({ name: a.name, revenue: Math.round(a.revenue), orders: a.orders }))
      .sort((a, b) => b.revenue - a.revenue),
    recent: recentTransactions(range.to),
    generatedAt: new Date().toISOString(),
  };
}
