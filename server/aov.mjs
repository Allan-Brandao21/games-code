// Modelo de pedido e agregação de AOV. Toda fonte (mock, MCP, REST) vira uma
// lista de pedidos neste formato e passa por aggregate() para virar o dashboard.
//
// Pedido:
// {
//   id, time (ISO), product, niche, affiliate, traffic: 'affiliates'|'internal',
//   units: 1|3|6|12 (pote), gateway, status: 'approved'|'refunded'|'chargeback'|...,
//   items: [{ step: 'front'|'bump'|'us1'|'us2'|'us3'|'ds1', amount }],
//   total
// }
import { delta, pct } from './normalize.mjs';
import { eachDay } from './range.mjs';

export const STEPS = [
  { key: 'front', label: 'Front' },
  { key: 'bump', label: 'Order bump' },
  { key: 'us1', label: 'Upsell 1' },
  { key: 'us2', label: 'Upsell 2' },
  { key: 'us3', label: 'Upsell 3' },
  { key: 'ds1', label: 'Downsell 1' },
];
export const TRAFFIC = [
  { key: 'affiliates', label: 'Afiliados' },
  { key: 'internal', label: 'Interno' },
];
export const HOUR_OFFSET = Number(process.env.HOUR_OFFSET ?? -3); // Brasília

export function applyFilters(orders, { product, traffic, pote, niche } = {}) {
  return orders.filter((o) =>
    (!product || o.product === product)
    && (!niche || o.niche === niche)
    && (!traffic || o.traffic === traffic)
    && (!pote || Number(o.units) === Number(pote)));
}

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

function localHour(iso) {
  const d = new Date(iso);
  return ((d.getUTCHours() + HOUR_OFFSET) % 24 + 24) % 24;
}
export function localDate(iso) {
  return new Date(new Date(iso).getTime() + HOUR_OFFSET * 3_600_000).toISOString().slice(0, 10);
}

function summarize(orders) {
  const approved = orders.filter((o) => o.status !== 'declined' && o.status !== 'pending');
  const front = approved.length;
  const revenue = approved.reduce((a, o) => a + o.total, 0);
  const stepCount = Object.fromEntries(STEPS.map((s) => [s.key, 0]));
  const stepRevenue = Object.fromEntries(STEPS.map((s) => [s.key, 0]));
  for (const o of approved) {
    for (const it of o.items) {
      if (stepCount[it.step] === undefined) continue;
      stepCount[it.step] += 1;
      stepRevenue[it.step] += it.amount;
    }
  }
  const refunds = orders.filter((o) => o.status === 'refunded').length;
  const chargebacks = orders.filter((o) => o.status === 'chargeback').length;
  return {
    orders: front,
    revenue: round(revenue),
    aov: front ? round(revenue / front) : 0,
    aovFront: front ? round(stepRevenue.front / front) : 0,
    frontRevenue: round(stepRevenue.front),
    takeRates: Object.fromEntries(STEPS.filter((s) => s.key !== 'front').map((s) => [s.key, round(pct(stepCount[s.key], front), 1)])),
    stepCount,
    stepRevenue,
    refunds,
    chargebacks,
    refundRate: round(pct(refunds, front), 1),
  };
}

function groupBy(orders, keyFn) {
  const m = new Map();
  for (const o of orders) {
    const k = keyFn(o);
    if (k === undefined || k === null || k === '') continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(o);
  }
  return m;
}

export function aggregate({ orders, prevOrders = [], range, filters = {}, source, allOrders = orders }) {
  const cur = applyFilters(orders, filters);
  const prev = applyFilters(prevOrders, filters);
  const s = summarize(cur);
  const p = summarize(prev);

  const days = groupBy(cur, (o) => localDate(o.time));
  const series = eachDay(range.from, range.to).map((date) => {
    const d = summarize(days.get(date) || []);
    return { date, aov: d.aov, orders: d.orders, revenue: d.revenue };
  });

  const hours = groupBy(cur, (o) => localHour(o.time));
  const hourly = Array.from({ length: 24 }, (_, h) => {
    const d = summarize(hours.get(h) || []);
    return { hour: h, aov: d.aov, orders: d.orders, revenue: d.revenue };
  });

  const steps = STEPS.map((st) => ({
    key: st.key,
    label: st.label,
    count: s.stepCount[st.key],
    revenue: round(s.stepRevenue[st.key]),
    share: round(pct(s.stepRevenue[st.key], s.revenue), 1),
    takeRate: st.key === 'front' ? 100 : s.takeRates[st.key],
    avgTicket: s.stepCount[st.key] ? round(s.stepRevenue[st.key] / s.stepCount[st.key]) : 0,
  }));

  const rank = (map, extra = () => ({})) => [...map.entries()]
    .map(([name, list]) => { const d = summarize(list); return { name, aov: d.aov, orders: d.orders, revenue: d.revenue, us1Rate: d.takeRates.us1, bumpRate: d.takeRates.bump, refundRate: d.refundRate, ...extra(list) }; })
    .sort((a, b) => b.revenue - a.revenue);

  const products = rank(groupBy(cur, (o) => o.product), (list) => ({ niche: list[0]?.niche || '' }));
  const affiliates = rank(groupBy(cur, (o) => o.affiliate));
  const niches = rank(groupBy(cur, (o) => o.niche));

  const poteMap = groupBy(cur, (o) => Number(o.units) || 0);
  const potes = [...poteMap.entries()].sort(([a], [b]) => a - b).map(([units, list]) => {
    const d = summarize(list);
    return { units, orders: d.orders, share: round(pct(d.orders, s.orders), 1), aov: d.aov, revenue: d.revenue, us1Rate: d.takeRates.us1 };
  });

  const trafficMap = groupBy(cur, (o) => o.traffic);
  const traffic = TRAFFIC.map((t) => {
    const d = summarize(trafficMap.get(t.key) || []);
    return { key: t.key, label: t.label, aov: d.aov, orders: d.orders, revenue: d.revenue, share: round(pct(d.orders, s.orders), 1), us1Rate: d.takeRates.us1 };
  });

  const recent = [...cur].sort((a, b) => b.time.localeCompare(a.time)).slice(0, 40).map((o) => ({
    id: o.id, time: o.time, product: o.product, affiliate: o.affiliate, traffic: o.traffic, units: o.units,
    steps: o.items.map((i) => i.step), amount: round(o.total), status: o.status,
  }));

  const opts = (key) => [...new Set(allOrders.map((o) => o[key]).filter(Boolean))].sort();

  return {
    source,
    range: { key: range.key, from: range.from, to: range.to },
    filters: { product: filters.product || '', traffic: filters.traffic || '', pote: filters.pote ? Number(filters.pote) : '', niche: filters.niche || '' },
    options: { products: opts('product'), niches: opts('niche'), potes: [...new Set(allOrders.map((o) => Number(o.units)).filter(Boolean))].sort((a, b) => a - b), traffic: TRAFFIC },
    kpis: {
      aov: s.aov, aovFront: s.aovFront, orders: s.orders, revenue: s.revenue, frontRevenue: s.frontRevenue,
      upliftPerOrder: round(s.aov - s.aovFront), takeRates: s.takeRates, refunds: s.refunds, chargebacks: s.chargebacks, refundRate: s.refundRate,
    },
    deltas: {
      aov: delta(s.aov, p.aov), orders: delta(s.orders, p.orders), revenue: delta(s.revenue, p.revenue),
      us1: delta(s.takeRates.us1, p.takeRates.us1), bump: delta(s.takeRates.bump, p.takeRates.bump), aovFront: delta(s.aovFront, p.aovFront),
    },
    previous: { aov: p.aov, orders: p.orders, revenue: p.revenue },
    series, hourly, steps, products, niches, potes, affiliates, traffic, recent,
    generatedAt: new Date().toISOString(),
  };
}
