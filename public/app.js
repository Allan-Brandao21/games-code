// Jarvis Mobile — lógica do app (sem dependências).
const CURRENCY = 'USD';
const LOCALE = 'pt-BR';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = {
  range: localStorage.getItem('jm.range') || '7d',
  view: localStorage.getItem('jm.view') || 'overview',
  txFilter: 'all',
  data: null,
  health: null,
};

const money = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, maximumFractionDigits: 2 });
const moneyCompact = new Intl.NumberFormat(LOCALE, { style: "currency", currency: CURRENCY, notation: "compact", maximumFractionDigits: 1 });
const int = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const fmtMoney = (v) => (Math.abs(v) >= 100_000 ? moneyCompact.format(v) : money.format(v));
const fmtPct = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `${v.toFixed(d).replace('.', ',')}%`);
const fmtTime = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || '';
  return d.toLocaleString(LOCALE, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const fmtDay = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}`;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS_LABEL = { approved: 'Aprovada', declined: 'Recusada', refunded: 'Refund', chargeback: 'Chargeback', pending: 'Pendente', unknown: '—' };

// ---------- rede ----------
async function api(path, opts) {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

async function loadHealth() {
  try { state.health = await api('/api/health'); } catch { state.health = null; }
}

async function loadDashboard({ fresh = false } = {}) {
  const btn = $('#refreshBtn');
  btn.classList.add('spin');
  renderSkeleton();
  try {
    state.data = await api(`/api/dashboard?range=${state.range}${fresh ? '&fresh=1' : ''}`);
    setStatus(state.data.source, null);
    render();
    hideState();
  } catch (err) {
    setStatus('error', err.message);
    showState(`Erro ao carregar: ${err.message}`, true);
    if (!state.data) renderEmpty();
  } finally {
    btn.classList.remove('spin');
  }
}

// ---------- status / toasts ----------
function setStatus(source, err) {
  const dot = $('#statusDot');
  const badge = $('#sourceBadge');
  dot.className = 'dot ' + (source === 'error' ? 'error' : source === 'mock' ? 'mock' : 'live');
  badge.textContent = source === 'error' ? 'erro' : source === 'mock' ? 'exemplo' : source === 'mcp' ? 'MCP' : source;
  dot.title = err || (source === 'mock' ? 'Dados de exemplo (configure DATA_SOURCE=mcp no .env)' : `Fonte: ${source}`);
}
let stateTimer;
function showState(msg, isError = false) {
  const el = $('#state');
  el.textContent = msg;
  el.hidden = false;
  el.classList.toggle('error', isError);
  clearTimeout(stateTimer);
  if (!isError) stateTimer = setTimeout(hideState, 3000);
}
function hideState() { $('#state').hidden = true; }

// ---------- render ----------
function deltaHtml(v, { invert = false } = {}) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '<span class="delta flat">—</span>';
  const up = v > 0.05, down = v < -0.05;
  const cls = !up && !down ? 'flat' : invert ? (up ? 'bad-up' : 'good-down') : (up ? 'up' : 'down');
  const arrow = up ? '▲' : down ? '▼' : '•';
  return `<span class="delta ${cls}" title="vs período anterior">${arrow} ${fmtPct(Math.abs(v))}</span>`;
}

function kpiTile({ label, value, delta, sub, wide = false, invert = false }) {
  return `<div class="kpi${wide ? ' wide' : ''}">
    <div class="label">${esc(label)}</div>
    <div class="value">${esc(value)}</div>
    <div class="sub">${delta !== undefined ? deltaHtml(delta, { invert }) : ''}${sub ? `<span>${esc(sub)}</span>` : ''}</div>
  </div>`;
}

function renderSkeleton() {
  if (state.data) return;
  $('#kpis').innerHTML = [1, 2, 3, 4, 5].map((i) => `<div class="kpi${i === 1 ? ' wide' : ''}"><div class="label skeleton">carregando</div><div class="value skeleton">0000</div></div>`).join('');
}

function renderEmpty() {
  $('#kpis').innerHTML = kpiTile({ label: 'Sem dados', value: '—', sub: 'verifique a fonte em .env', wide: true });
  $('#chart').innerHTML = '';
}

function render() {
  const d = state.data;
  if (!d) return;
  const k = d.kpis;
  $('#kpis').innerHTML = [
    kpiTile({ label: 'Receita', value: fmtMoney(k.revenue), delta: d.deltas.revenue, sub: `${d.range.from === d.range.to ? fmtDay(d.range.from) : `${fmtDay(d.range.from)} – ${fmtDay(d.range.to)}`}`, wide: true }),
    kpiTile({ label: 'Pedidos', value: int.format(k.orders), delta: d.deltas.orders }),
    kpiTile({ label: 'Ticket médio', value: money2.format(k.aov), delta: d.deltas.aov }),
    kpiTile({ label: 'Aprovação', value: fmtPct(k.approvalRate), delta: d.deltas.approvalRate }),
    kpiTile({ label: 'Take rate upsell', value: fmtPct(k.upsellTakeRate) }),
  ].join('');

  $('#seriesRange').textContent = d.series.length ? `${d.series.length} dia${d.series.length > 1 ? 's' : ''}` : '';
  renderChart(d.series);

  const refundRate = k.orders ? (k.refunds / k.orders) * 100 : null;
  const cbRate = k.orders ? (k.chargebacks / k.orders) * 100 : null;
  $('#health').innerHTML = [
    stat('Refunds', int.format(k.refunds), `${fmtPct(refundRate)} · ${fmtMoney(k.refundAmount)}`, refundRate > 5 ? 'crit' : refundRate > 3 ? 'warn' : ''),
    stat('Chargebacks', int.format(k.chargebacks), `${fmtPct(cbRate, 2)} · ${fmtMoney(k.chargebackAmount)}`, cbRate > 1 ? 'crit' : cbRate > 0.5 ? 'warn' : ''),
    stat('Líquido', fmtMoney(k.revenue - k.refundAmount - k.chargebackAmount), 'receita − refund − CB'),
  ].join('');

  $('#topProducts').innerHTML = rankedList(d.products.slice(0, 3), k.revenue, true);
  $('#products').innerHTML = rankedList(d.products, k.revenue, true) || '<li class="muted">Sem dados de produto</li>';
  $('#productsCount').textContent = d.products.length ? `${d.products.length} itens` : '';
  $('#affiliates').innerHTML = rankedList(d.affiliates, k.revenue, false) || '<li class="muted">Sem dados de afiliado</li>';
  $('#affiliatesCount').textContent = d.affiliates.length ? `${d.affiliates.length} itens` : '';
  renderTx();
}

function stat(label, value, sub, cls = '') {
  return `<div class="stat ${cls}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;
}

function rankedList(items, total, showRefund) {
  const max = Math.max(...items.map((i) => i.revenue), 1);
  return items.map((it, i) => `<li>
    <span class="rank">${i + 1}</span>
    <div><div class="name">${esc(it.name)}</div><div class="meta">${int.format(it.orders)} pedidos${showRefund && it.refundRate !== null && it.refundRate !== undefined ? ` · refund ${fmtPct(it.refundRate)}` : ''}</div></div>
    <div><div class="amt">${fmtMoney(it.revenue)}</div><div class="share">${total ? fmtPct((it.revenue / total) * 100, 0) : ''}</div></div>
    <div class="bar-bg"><div class="bar-fg" style="width:${(it.revenue / max) * 100}%"></div></div>
  </li>`).join('');
}

function renderTx() {
  const d = state.data;
  if (!d) return;
  const list = state.txFilter === 'all' ? d.recent : d.recent.filter((t) => t.status === state.txFilter);
  $('#tx').innerHTML = list.length
    ? list.map((t) => `<li>
        <div><div class="name">${esc(t.product)}</div><div class="meta">${esc(fmtTime(t.time))}${t.affiliate ? ` · ${esc(t.affiliate)}` : ''}${t.id ? ` · ${esc(t.id)}` : ''}</div></div>
        <div><div class="amt">${money2.format(t.amount)}</div><span class="status ${esc(t.status)}">${esc(STATUS_LABEL[t.status] || t.status)}</span></div>
      </li>`).join('')
    : '<li class="muted">Nenhuma transação neste filtro</li>';
}

// ---------- gráfico (SVG inline, barras, 1 série) ----------
function renderChart(series) {
  const host = $('#chart');
  const W = Math.max(host.clientWidth || 320, 240), H = host.clientHeight || 180;
  if (!series.length) { host.innerHTML = `<svg viewBox="0 0 ${W} ${H}"><text class="empty" x="${W / 2}" y="${H / 2}">Sem série diária</text></svg>`; return; }
  const max = Math.max(...series.map((p) => p.revenue), 1);
  const nice = niceMax(max);
  const ticks = [0, nice / 2, nice];
  const labelW = Math.max(...ticks.map((t) => moneyCompact.format(t).length)) * 6.4 + 10;
  const pad = { t: 8, r: 8, b: 22, l: Math.ceil(labelW) };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const n = series.length;
  const gap = 2;
  const bw = Math.max((iw - gap * (n - 1)) / n, 2);
  const y = (v) => pad.t + ih - (v / nice) * ih;
  const labelEvery = n <= 8 ? 1 : n <= 16 ? 2 : Math.ceil(n / 6);
  const r = Math.min(4, bw / 2);
  const bars = series.map((p, i) => {
    const x = pad.l + i * (bw + gap);
    const top = y(p.revenue);
    const h = Math.max(pad.t + ih - top, 0);
    const path = h > r
      ? `M${x},${pad.t + ih} V${top + r} a${r},${r} 0 0 1 ${r},-${r} H${x + bw - r} a${r},${r} 0 0 1 ${r},${r} V${pad.t + ih} Z`
      : `M${x},${pad.t + ih} h${bw} v-${h} h-${bw} Z`;
    return `<path class="bar" d="${path}"/><rect class="hit" data-i="${i}" x="${x - gap / 2}" y="${pad.t}" width="${bw + gap}" height="${ih}"/>`
      + (i % labelEvery === 0 ? `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${fmtDay(p.date)}</text>` : '');
  }).join('');
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Receita por dia">
    <g class="grid">${ticks.map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`).join('')}</g>
    ${ticks.map((t) => `<text class="ylab" x="${pad.l - 6}" y="${y(t) + 4}">${moneyCompact.format(t)}</text>`).join('')}
    <line class="baseline" x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}"/>
    ${bars}
  </svg>`;
  const tip = $('#tooltip');
  const barsEls = $$('.bar', host);
  const show = (e) => {
    const i = Number(e.target.dataset.i);
    if (Number.isNaN(i)) return;
    const p = series[i];
    barsEls.forEach((b, j) => b.classList.toggle('dim', j !== i));
    tip.innerHTML = `${fmtDay(p.date)}<br><b>${money.format(p.revenue)}</b> · ${int.format(p.orders)} pedidos`;
    tip.hidden = false;
    const pt = e.touches ? e.touches[0] : e;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = `${Math.min(Math.max(pt.clientX - tw / 2, 8), window.innerWidth - tw - 8)}px`;
    tip.style.top = `${Math.max(pt.clientY - th - 16, 8)}px`;
  };
  const hide = () => { tip.hidden = true; barsEls.forEach((b) => b.classList.remove('dim')); };
  host.onpointermove = show;
  host.onpointerdown = show;
  host.onpointerleave = hide;
  host.onpointerup = () => setTimeout(hide, 1200);
}
function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return m * p;
}

// ---------- explorar API (MCP) ----------
async function loadTools(fresh = false) {
  const host = $('#tools');
  host.innerHTML = '<p class="muted small">Conectando ao server MCP…</p>';
  try {
    const { tools } = await api(`/api/mcp/tools${fresh ? '?fresh=1' : ''}`);
    if (!tools.length) { host.innerHTML = '<p class="muted small">O server MCP não expôs nenhum tool.</p>'; return; }
    host.innerHTML = tools.map((t) => {
      const props = t.inputSchema?.properties || {};
      const example = {};
      for (const [k, v] of Object.entries(props)) example[k] = v.default ?? (v.type === 'number' || v.type === 'integer' ? 0 : v.type === 'boolean' ? false : v.enum?.[0] ?? '');
      return `<details class="tool" data-name="${esc(t.name)}">
        <summary><span>${esc(t.name)}</span></summary>
        <div class="desc">${esc(t.description || '')}</div>
        <textarea spellcheck="false">${esc(JSON.stringify(example, null, 2))}</textarea>
        <button class="btn">Chamar</button>
        <pre hidden></pre>
      </details>`;
    }).join('');
  } catch (err) {
    host.innerHTML = `<p class="small" style="color:var(--critical)">${esc(err.message)}</p>
      <p class="muted small">Defina <code>DATA_SOURCE=mcp</code>, <code>PAGAMERICAN_MCP_SERVER</code> e <code>PAGAMERICAN_API_KEY</code> no <code>.env</code> do servidor.</p>`;
  }
}

$('#tools').addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn');
  if (!btn) return;
  const det = btn.closest('.tool');
  const pre = $('pre', det);
  let args = {};
  try { args = JSON.parse($('textarea', det).value || '{}'); } catch { pre.hidden = false; pre.textContent = 'JSON inválido nos argumentos'; return; }
  btn.disabled = true; btn.textContent = 'Chamando…';
  try {
    const { result } = await api('/api/mcp/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: det.dataset.name, args }) });
    pre.hidden = false; pre.textContent = JSON.stringify(result, null, 2);
  } catch (err) {
    pre.hidden = false; pre.textContent = `Erro: ${err.message}`;
  } finally { btn.disabled = false; btn.textContent = 'Chamar'; }
});

// ---------- navegação ----------
function setView(v) {
  state.view = v;
  localStorage.setItem('jm.view', v);
  $$('.view').forEach((s) => s.classList.toggle('active', s.dataset.view === v));
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $('#ranges').style.display = v === 'explore' ? 'none' : '';
  window.scrollTo({ top: 0 });
  if (v === 'explore' && !$('#tools').children.length) loadTools();
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); });
document.addEventListener('click', (e) => { const b = e.target.closest('[data-goto]'); if (b) setView(b.dataset.goto); });
$('#ranges').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.range = b.dataset.range;
  localStorage.setItem('jm.range', state.range);
  $$('#ranges button').forEach((x) => x.classList.toggle('active', x === b));
  loadDashboard();
});
$('#txFilters').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.txFilter = b.dataset.status;
  $$('#txFilters button').forEach((x) => x.classList.toggle('active', x === b));
  renderTx();
});
$('#refreshBtn').addEventListener('click', () => loadDashboard({ fresh: true }));
$('#reloadTools').addEventListener('click', () => loadTools(true));
window.addEventListener('resize', () => state.data && renderChart(state.data.series));
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.data && Date.now() - new Date(state.data.generatedAt) > 120_000) loadDashboard(); });

// ---------- boot ----------
$$('#ranges button').forEach((x) => x.classList.toggle('active', x.dataset.range === state.range));
setView(state.view);
loadHealth().then(loadDashboard);
setInterval(() => { if (!document.hidden) loadDashboard(); }, 5 * 60_000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
