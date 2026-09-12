// Contrato de dados que o app mobile consome. Toda fonte (mock, MCP, REST)
// passa por aqui para virar o mesmo formato.
//
// {
//   source: 'mock' | 'mcp' | 'rest',
//   range: { key, from, to },
//   kpis: { revenue, orders, aov, approvalRate, refunds, refundAmount,
//           chargebacks, chargebackAmount, upsellTakeRate },
//   deltas: { revenue, orders, aov, approvalRate }   // variação % vs período anterior
//   series: [{ date, revenue, orders }],
//   products: [{ name, revenue, orders, refundRate }],
//   affiliates: [{ name, revenue, orders }],
//   recent: [{ id, time, product, affiliate, amount, status }],
//   generatedAt
// }

const KEY_ALIASES = {
  revenue: ['revenue', 'receita', 'gross_revenue', 'total_revenue', 'total', 'amount', 'faturamento', 'vl_receita'],
  orders: ['orders', 'pedidos', 'order_count', 'count', 'qt_pedidos', 'transactions', 'sales'],
  aov: ['aov', 'ticket_medio', 'average_order_value', 'avg_order_value'],
  approvalRate: ['approval_rate', 'approvalRate', 'taxa_aprovacao', 'approved_rate'],
  refunds: ['refunds', 'refund_count', 'reembolsos', 'qt_refunds'],
  refundAmount: ['refund_amount', 'refundAmount', 'vl_refunds', 'refunded'],
  chargebacks: ['chargebacks', 'chargeback_count', 'qt_chargebacks'],
  chargebackAmount: ['chargeback_amount', 'chargebackAmount', 'vl_chargebacks'],
  upsellTakeRate: ['upsell_take_rate', 'upsellTakeRate', 'taxa_upsell', 'upsell_rate'],
  name: ['name', 'nome', 'product', 'produto', 'affiliate', 'afiliado', 'label', 'id'],
  date: ['date', 'data', 'day', 'dt', 'ds'],
  refundRate: ['refund_rate', 'refundRate', 'taxa_refund'],
  status: ['status', 'state', 'financial_status'],
  time: ['time', 'created_at', 'createdAt', 'date', 'timestamp', 'dt_criacao'],
  product: ['product', 'produto', 'product_name', 'sku'],
  affiliate: ['affiliate', 'afiliado', 'affiliate_name', 'aff'],
  amount: ['amount', 'total', 'valor', 'total_price', 'value', 'revenue'],
  id: ['id', 'order_id', 'transaction_id', 'number'],
};

function pick(obj, key, fallback = undefined) {
  if (!obj || typeof obj !== 'object') return fallback;
  for (const alias of KEY_ALIASES[key] || [key]) {
    if (obj[alias] !== undefined && obj[alias] !== null) return obj[alias];
  }
  return fallback;
}

function num(v, fallback = 0) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = typeof v === 'string' ? Number(v.replace(/[^0-9.-]/g, '')) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function firstArray(obj, names) {
  for (const n of names) {
    const v = obj?.[n];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object' && Array.isArray(v.items)) return v.items;
  }
  return [];
}

const STATUS_MAP = [
  [/approv|paid|pago|aprov|success|captur/i, 'approved'],
  [/refund|reembols|estorn/i, 'refunded'],
  [/chargeback|cb|disput/i, 'chargeback'],
  [/declin|recus|fail|negad|error/i, 'declined'],
  [/pend|process|aguard/i, 'pending'],
];

export function normalizeStatus(v) {
  const s = String(v ?? '').trim();
  for (const [re, out] of STATUS_MAP) if (re.test(s)) return out;
  return s ? s.toLowerCase() : 'unknown';
}

export function pct(part, whole) {
  return whole > 0 ? (part / whole) * 100 : 0;
}

export function delta(cur, prev) {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

// Recebe um objeto "solto" (resposta de um tool MCP ou endpoint REST) e tenta
// encaixar no contrato. O que não for encontrado fica zerado/vazio — o app
// mostra a fonte e o que faltou para o mapeamento ser ajustado.
export function normalizeLoose(raw, { source, range }) {
  const root = raw?.data && typeof raw.data === 'object' ? raw.data : raw || {};
  const k = root.kpis || root.summary || root.totals || root.metrics || root;

  const series = firstArray(root, ['series', 'daily', 'timeseries', 'by_day', 'days', 'por_dia']).map((p) => ({
    date: String(pick(p, 'date', '')).slice(0, 10),
    revenue: num(pick(p, 'revenue')),
    orders: num(pick(p, 'orders')),
  }));

  const products = firstArray(root, ['products', 'by_product', 'produtos', 'por_produto']).map((p) => ({
    name: String(pick(p, 'name', '—')),
    revenue: num(pick(p, 'revenue')),
    orders: num(pick(p, 'orders')),
    refundRate: num(pick(p, 'refundRate', null), null),
  }));

  const affiliates = firstArray(root, ['affiliates', 'by_affiliate', 'afiliados', 'por_afiliado']).map((p) => ({
    name: String(pick(p, 'name', '—')),
    revenue: num(pick(p, 'revenue')),
    orders: num(pick(p, 'orders')),
  }));

  const recent = firstArray(root, ['recent', 'transactions', 'orders', 'latest', 'transacoes', 'pedidos'])
    .slice(0, 50)
    .map((t) => ({
      id: String(pick(t, 'id', '')),
      time: String(pick(t, 'time', '')),
      product: String(pick(t, 'product', '—')),
      affiliate: String(pick(t, 'affiliate', '')),
      amount: num(pick(t, 'amount')),
      status: normalizeStatus(pick(t, 'status')),
    }));

  const revenue = num(pick(k, 'revenue', series.reduce((a, p) => a + p.revenue, 0)));
  const orders = num(pick(k, 'orders', series.reduce((a, p) => a + p.orders, 0)));
  const refunds = num(pick(k, 'refunds'));
  const chargebacks = num(pick(k, 'chargebacks'));

  const kpis = {
    revenue,
    orders,
    aov: num(pick(k, 'aov', orders ? revenue / orders : 0)),
    approvalRate: num(pick(k, 'approvalRate', null), null),
    refunds,
    refundAmount: num(pick(k, 'refundAmount')),
    chargebacks,
    chargebackAmount: num(pick(k, 'chargebackAmount')),
    upsellTakeRate: num(pick(k, 'upsellTakeRate', null), null),
  };

  const prev = root.previous || root.compare || root.prev || null;
  const deltas = prev
    ? {
        revenue: delta(kpis.revenue, num(pick(prev, 'revenue'))),
        orders: delta(kpis.orders, num(pick(prev, 'orders'))),
        aov: delta(kpis.aov, num(pick(prev, 'aov'))),
        approvalRate: delta(kpis.approvalRate, num(pick(prev, 'approvalRate'))),
      }
    : { revenue: null, orders: null, aov: null, approvalRate: null };

  return {
    source,
    range: { key: range.key, from: range.from, to: range.to },
    kpis,
    deltas,
    series,
    products,
    affiliates,
    recent,
    generatedAt: new Date().toISOString(),
    raw: undefined,
  };
}
