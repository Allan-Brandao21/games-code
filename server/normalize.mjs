// Converte respostas "soltas" da API (tool MCP ou endpoint REST) em pedidos no
// formato de aov.mjs. Aceita chaves em inglês e português. Se a resposta real
// da PagAmerican usar outros nomes, ajuste os aliases aqui.

const ALIASES = {
  id: ['id', 'order_id', 'orderId', 'transaction_id', 'number', 'pedido_id'],
  time: ['created_at', 'createdAt', 'time', 'date', 'timestamp', 'dt_criacao', 'data', 'paid_at', 'order_date'],
  product: ['product', 'produto', 'product_name', 'productName', 'offer', 'oferta', 'funnel', 'funil'],
  niche: ['niche', 'nicho', 'category', 'categoria', 'vertical'],
  affiliate: ['affiliate', 'afiliado', 'affiliate_name', 'affiliateName', 'aff', 'aff_id', 'affid', 'utm_source'],
  traffic: ['traffic', 'trafego', 'traffic_type', 'channel', 'canal', 'is_house_traffic', 'is_internal', 'interno'],
  units: ['units', 'potes', 'pote', 'quantity', 'qty', 'qtd', 'bottles'],
  status: ['status', 'state', 'financial_status', 'payment_status'],
  total: ['total', 'total_price', 'amount', 'valor', 'value', 'revenue', 'gross', 'order_total'],
  items: ['items', 'line_items', 'lineItems', 'itens', 'products', 'steps', 'etapas'],
  step: ['step', 'etapa', 'type', 'tipo', 'kind', 'cd_tipo_item', 'position', 'sku', 'name', 'title'],
  amount: ['amount', 'price', 'total', 'valor', 'value', 'subtotal'],
  gateway: ['gateway', 'platform', 'plataforma'],
};

function pick(obj, key, fallback) {
  if (!obj || typeof obj !== 'object') return fallback;
  for (const a of ALIASES[key] || [key]) if (obj[a] !== undefined && obj[a] !== null && obj[a] !== '') return obj[a];
  return fallback;
}
export function num(v, fallback = 0) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = typeof v === 'string' ? Number(v.replace(/[^0-9.-]/g, '')) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
export function pct(part, whole) { return whole > 0 ? (part / whole) * 100 : 0; }
export function delta(cur, prev) {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

const STATUS_RULES = [
  [/refund|reembols|estorn/i, 'refunded'],
  [/chargeback|disput/i, 'chargeback'],
  [/declin|recus|fail|negad|error|cancel/i, 'declined'],
  [/pend|process|aguard|wait/i, 'pending'],
  [/approv|paid|pago|aprov|success|captur|complet|ok|^3$|^1$/i, 'approved'],
];
export function normalizeStatus(v) {
  const s = String(v ?? '').trim();
  for (const [re, out] of STATUS_RULES) if (re.test(s)) return out;
  return s ? 'approved' : 'approved';
}

const STEP_RULES = [
  [/bump|ob\b|order_bump/i, 'bump'],
  [/down.?sell.?1|ds1|downsell/i, 'ds1'],
  [/up.?sell.?1|us1|oto1|\bup1\b/i, 'us1'],
  [/up.?sell.?2|us2|oto2|\bup2\b/i, 'us2'],
  [/up.?sell.?3|us3|oto3|\bup3\b/i, 'us3'],
  [/front|main|principal|initial|^1$|^0$/i, 'front'],
];
export function normalizeStep(v, index = 0) {
  const s = String(v ?? '');
  for (const [re, out] of STEP_RULES) if (re.test(s)) return out;
  return index === 0 ? 'front' : `up${index}`.replace('up1', 'us1').replace('up2', 'us2').replace('up3', 'us3');
}

function normalizeTraffic(v, affiliate) {
  if (v === true || v === 1 || /^(1|true|yes|sim|interno|internal|house|inhouse|in-house)$/i.test(String(v ?? ''))) return 'internal';
  if (v === false || v === 0 || /^(0|false|no|nao|não|afiliad|affiliate)/i.test(String(v ?? ''))) return 'affiliates';
  if (!affiliate || /^(interno|internal|house|direct|—|-)$/i.test(String(affiliate))) return 'internal';
  return 'affiliates';
}

function toIso(v) {
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

// Um registro "solto" -> pedido. Se não houver itens, o pedido vira só front.
export function normalizeOrder(raw, i = 0) {
  const rawItems = pick(raw, 'items', []);
  let items = Array.isArray(rawItems)
    ? rawItems.map((it, idx) => ({ step: normalizeStep(pick(it, 'step', ''), idx), amount: num(pick(it, 'amount')) }))
    : [];
  const total = num(pick(raw, 'total', items.reduce((a, it) => a + it.amount, 0)));
  if (!items.length) items = [{ step: 'front', amount: total }];
  // colunas achatadas (upsell_1_amount, bump_amount…) também viram itens
  for (const [k, v] of Object.entries(raw || {})) {
    const m = /^(bump|order_bump|upsell_?([123])|us([123])|downsell_?1|ds1)(_amount|_price|_value|_total)?$/i.exec(k);
    if (m && num(v) > 0 && !items.some((it) => it.step === normalizeStep(m[1]))) items.push({ step: normalizeStep(m[1], 1), amount: num(v) });
  }
  const affiliate = String(pick(raw, 'affiliate', '') || 'Interno');
  return {
    id: String(pick(raw, 'id', `row-${i + 1}`)),
    time: toIso(pick(raw, 'time', Date.now())),
    product: String(pick(raw, 'product', '—')),
    niche: String(pick(raw, 'niche', '')),
    affiliate,
    traffic: normalizeTraffic(pick(raw, 'traffic'), affiliate),
    units: num(pick(raw, 'units', 1)) || 1,
    gateway: String(pick(raw, 'gateway', 'pagamerican')),
    status: normalizeStatus(pick(raw, 'status')),
    items,
    total: total || items.reduce((a, it) => a + it.amount, 0),
  };
}

// Acha a lista de pedidos dentro de uma resposta qualquer.
export function extractOrders(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  for (const k of ['orders', 'pedidos', 'transactions', 'transacoes', 'data', 'items', 'results', 'rows', 'records', 'list']) {
    const v = raw[k];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') { const inner = extractOrders(v); if (inner.length) return inner; }
  }
  return [];
}

export function normalizeOrders(raw) {
  return extractOrders(raw).map(normalizeOrder);
}
