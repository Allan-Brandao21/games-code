// Ranking de top afiliados por nicho e por oferta (produto) em 4 janelas:
// all time, 30 dias, 3 meses (90d) e 6 meses (180d).
//
//   node scripts/top-afiliados.mjs [--source mock|mcp|rest|sql] [--top 10] [--out out]
//
// Busca os pedidos uma vez (do início do all time até hoje) e recorta cada janela
// localmente. Fonte "sql" roda a query de TOP_SQL_FILE (padrão scripts/pedidos.sql)
// via psql em DATABASE_URL; as colunas seguem os mesmos aliases de normalize.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config } from '../server/env.mjs';
import { iso } from '../server/range.mjs';
import { localDate } from '../server/aov.mjs';
import { normalizeOrders, pct } from '../server/normalize.mjs';

const DAY = 86_400_000;
const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map((a) => { const [k, ...v] = a.trim().split(/\s+/); return [k, v.join(' ') || true]; }));
const source = String(args.source || config.dataSource);
const top = Number(args.top || 10);
const outDir = path.resolve(config.root, String(args.out || 'out'));
const allTimeFrom = String(args.from || process.env.TOP_ALLTIME_FROM || '2020-01-01');

const today = new Date();
const daysAgo = (n) => iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - (n - 1) * DAY));
const to = iso(today);
const WINDOWS = [
  { key: 'alltime', label: 'All time', from: allTimeFrom },
  { key: '30d', label: '30 dias', from: daysAgo(30) },
  { key: '90d', label: '3 meses', from: daysAgo(90) },
  { key: '180d', label: '6 meses', from: daysAgo(180) },
];

async function loadOrders(from) {
  switch (source) {
    case 'mock': {
      const { ordersBetween } = await import('../server/mock.mjs');
      return ordersBetween(from, to);
    }
    case 'mcp': {
      const { pickOrdersTool, fetchAllOrders, closeMcp } = await import('../server/mcp-bridge.mjs');
      try { return await fetchAllOrders(await pickOrdersTool(), from, to); } finally { await closeMcp(); }
    }
    case 'rest': {
      const { fetchOrders } = await import('../server/rest.mjs');
      return fetchOrders(from, to);
    }
    case 'sql': {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não definida');
      const file = path.resolve(config.root, process.env.TOP_SQL_FILE || 'scripts/pedidos.sql');
      const query = fs.readFileSync(file, 'utf8').trim().replace(/;\s*$/, '');
      const sql = `select coalesce(json_agg(t), '[]') from (${query}) t;`;
      const json = execFileSync('psql', [process.env.DATABASE_URL, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-v', `from=${from}`, '-v', `to=${to}`, '-f', '-'],
        { input: sql, maxBuffer: 1 << 30, encoding: 'utf8' });
      return normalizeOrders(JSON.parse(json));
    }
    default:
      throw new Error(`fonte inválida: ${source} (use mock, mcp, rest ou sql)`);
  }
}

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

// Receita líquida = só pedidos aprovados; reembolso/chargeback entram na taxa.
function stats(list) {
  const approved = list.filter((o) => o.status === 'approved');
  const lost = list.filter((o) => o.status === 'refunded' || o.status === 'chargeback').length;
  const revenue = approved.reduce((a, o) => a + o.total, 0);
  const us1 = approved.filter((o) => o.items.some((i) => i.step === 'us1')).length;
  return {
    orders: approved.length,
    revenue: round(revenue),
    aov: approved.length ? round(revenue / approved.length) : 0,
    us1Rate: round(pct(us1, approved.length), 1),
    refundRate: round(pct(lost, approved.length + lost), 1),
  };
}

function group(list, keyFn) {
  const m = new Map();
  for (const o of list) {
    const k = keyFn(o);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(o);
  }
  return m;
}

function ranking(list, keyFn, extra = () => ({})) {
  return [...group(list, keyFn)].map(([name, orders]) => {
    const total = stats(orders).revenue;
    const affiliates = [...group(orders, (o) => o.affiliate)]
      .map(([affiliate, l]) => ({ affiliate, ...stats(l) }))
      .filter((a) => a.orders > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, top)
      .map((a, i) => ({ rank: i + 1, ...a, share: round(pct(a.revenue, total), 1) }));
    return { name, ...extra(orders), revenue: total, affiliates };
  }).sort((a, b) => b.revenue - a.revenue);
}

const money = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function print(title, groups) {
  console.log(`\n=== ${title} ===`);
  for (const g of groups) {
    console.log(`\n${g.name}${g.niche ? ` (${g.niche})` : ''} · receita afiliados ${money(g.revenue)}`);
    console.table(g.affiliates.map((a) => ({
      '#': a.rank, afiliado: a.affiliate, pedidos: a.orders, receita: money(a.revenue), '%': a.share, AOV: money(a.aov), 'US1 %': a.us1Rate, 'reemb+cb %': a.refundRate,
    })));
  }
}

const csvCell = (v) => (/[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

const all = (await loadOrders(allTimeFrom)).filter((o) => o.traffic === 'affiliates');
console.log(`fonte: ${source} · ${all.length} pedidos de afiliados de ${allTimeFrom} a ${to}`);

const report = { source, generatedAt: new Date().toISOString(), to, top, windows: [] };
const rows = [];
for (const w of WINDOWS) {
  const list = all.filter((o) => localDate(o.time) >= w.from);
  const byNiche = ranking(list, (o) => o.niche);
  const byOffer = ranking(list, (o) => o.product, (l) => ({ niche: l[0]?.niche || '' }));
  report.windows.push({ ...w, to, orders: list.length, byNiche, byOffer });
  for (const [dim, groups] of [['nicho', byNiche], ['oferta', byOffer]]) {
    for (const g of groups) for (const a of g.affiliates) {
      rows.push([w.label, w.from, to, dim, g.name, a.rank, a.affiliate, a.orders, a.revenue, a.share, a.aov, a.us1Rate, a.refundRate]);
    }
  }
  print(`${w.label} · por nicho (${w.from} → ${to})`, byNiche);
  print(`${w.label} · por oferta (${w.from} → ${to})`, byOffer);
}

fs.mkdirSync(outDir, { recursive: true });
const header = ['periodo', 'de', 'ate', 'dimensao', 'grupo', 'rank', 'afiliado', 'pedidos', 'receita', 'share_pct', 'aov', 'us1_pct', 'reembolso_cb_pct'];
fs.writeFileSync(path.join(outDir, 'top-afiliados.csv'), [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n');
fs.writeFileSync(path.join(outDir, 'top-afiliados.json'), JSON.stringify(report, null, 2));
console.log(`\nsalvo em ${path.relative(config.root, outDir)}/top-afiliados.csv e .json`);
