// Jarvis AOV — lógica do app (sem dependências).
const CURRENCY = 'USD';
const LOCALE = 'pt-BR';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const saved = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignora */ } };

const state = {
  range: saved('jm.range', '7d'),
  view: saved('jm.view', 'overview'),
  filters: { product: saved('jm.f.product', ''), traffic: saved('jm.f.traffic', ''), pote: saved('jm.f.pote', '') },
  txFilter: 'all',
  data: null,
};

const money = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, maximumFractionDigits: 2 });
const moneyCompact = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, notation: 'compact', maximumFractionDigits: 1 });
const int = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const fmtMoney = (v) => (Math.abs(v) >= 100_000 ? moneyCompact.format(v) : money.format(v));
const fmtPct = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `${v.toFixed(d).replace('.', ',')}%`);
const fmtTime = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso || '' : d.toLocaleString(LOCALE, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const fmtDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STEP_LABEL = { front: 'Front', bump: 'Bump', us1: 'US1', us2: 'US2', us3: 'US3', ds1: 'DS1' };
const STATUS_LABEL = { approved: 'Aprovado', declined: 'Recusado', refunded: 'Refund', chargeback: 'Chargeback', pending: 'Pendente' };

// ---------- rede ----------
async function api(path, opts) {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

function query({ fresh = false } = {}) {
  const q = new URLSearchParams({ range: state.range });
  for (const [k, v] of Object.entries(state.filters)) if (v) q.set(k, v);
  if (fresh) q.set('fresh', '1');
  return q.toString();
}

let reqSeq = 0;
async function loadDashboard({ fresh = false } = {}) {
  const btn = $('#refreshBtn');
  const seq = ++reqSeq;
  btn.classList.add('spin');
  $('#main').classList.add('loading');
  if (!state.data) renderSkeleton();
  try {
    const data = await api(`/api/dashboard?${query({ fresh })}`);
    if (seq !== reqSeq) return; // chegou uma resposta mais nova
    state.data = data;
    setStatus(data.source, null);
    render();
    hideState();
  } catch (err) {
    if (seq !== reqSeq) return;
    setStatus('error', err.message);
    showState(`Erro ao carregar: ${err.message}`, true);
    if (!state.data) renderEmpty();
  } finally {
    if (seq === reqSeq) { btn.classList.remove('spin'); $('#main').classList.remove('loading'); }
  }
}

// ---------- status ----------
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
  el.textContent = msg; el.hidden = false; el.classList.toggle('error', isError);
  clearTimeout(stateTimer);
  if (!isError) stateTimer = setTimeout(hideState, 3000);
}
function hideState() { $('#state').hidden = true; }

// ---------- helpers de render ----------
function deltaHtml(v, { invert = false, suffix = '' } = {}) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '<span class="delta flat">—</span>';
  const up = v > 0.05, down = v < -0.05;
  const cls = !up && !down ? 'flat' : invert ? (up ? 'bad-up' : 'good-down') : (up ? 'up' : 'down');
  const arrow = up ? '▲' : down ? '▼' : '•';
  return `<span class="delta ${cls}" title="vs período anterior">${arrow} ${fmtPct(Math.abs(v))}${suffix}</span>`;
}
function kpiTile({ label, value, delta, sub, wide = false, invert = false }) {
  return `<div class="kpi${wide ? ' wide' : ''}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>
    <div class="sub">${delta !== undefined ? deltaHtml(delta, { invert }) : ''}${sub ? `<span>${esc(sub)}</span>` : ''}</div></div>`;
}
function renderSkeleton() {
  $('#hero').innerHTML = '<div class="label skeleton">AOV</div><div class="value skeleton">US$ 000,00</div>';
  $('#kpis').innerHTML = [1, 2, 3, 4].map(() => '<div class="kpi"><div class="label skeleton">carregando</div><div class="value skeleton">0000</div></div>').join('');
}
function renderEmpty() {
  $('#hero').innerHTML = '<div class="label">Sem dados</div><div class="value">—</div><div class="row">verifique a fonte em .env</div>';
  $('#kpis').innerHTML = '';
  $('#chartDaily').innerHTML = ''; $('#chartHourly').innerHTML = '';
}
function periodLabel(r) { return r.from === r.to ? fmtDay(r.from) : `${fmtDay(r.from)} – ${fmtDay(r.to)}`; }

// ---------- render principal ----------
function render() {
  const d = state.data;
  if (!d) return;
  const k = d.kpis;
  syncFilterOptions(d);

  $('#hero').innerHTML = `
    <div class="label">AOV · ${esc(periodLabel(d.range))}${filterLabel(d)}</div>
    <div class="value">${money2.format(k.aov)}</div>
    <div class="row">${deltaHtml(d.deltas.aov)}<span>${int.format(k.orders)} pedidos · ${fmtMoney(k.revenue)}</span></div>
    <div class="split">
      <div><div class="k">AOV só front</div><div class="v">${money2.format(k.aovFront)}<small>${d.deltas.aovFront === null ? '' : deltaHtml(d.deltas.aovFront)}</small></div></div>
      <div><div class="k">Uplift por pedido</div><div class="v">+${money2.format(k.upliftPerOrder)}<small>${fmtPct(k.aovFront ? (k.upliftPerOrder / k.aovFront) * 100 : null, 0)} sobre o front</small></div></div>
    </div>`;

  const tr = k.takeRates;
  $('#kpis').innerHTML = [
    kpiTile({ label: 'Take rate Upsell 1', value: fmtPct(tr.us1), delta: d.deltas.us1 }),
    kpiTile({ label: 'Take rate Bump', value: fmtPct(tr.bump), delta: d.deltas.bump }),
    kpiTile({ label: 'Upsell 2 · 3', value: `${fmtPct(tr.us2)} · ${fmtPct(tr.us3)}`, sub: 'sobre pedidos front' }),
    kpiTile({ label: 'Downsell 1', value: fmtPct(tr.ds1), sub: 'sobre pedidos front' }),
    kpiTile({ label: 'Pedidos', value: int.format(k.orders), delta: d.deltas.orders }),
    kpiTile({ label: 'Refund', value: fmtPct(k.refundRate), sub: `${int.format(k.refunds)} refunds · ${int.format(k.chargebacks)} CB` }),
  ].join('');

  $('#seriesRange').textContent = `${d.series.length} dia${d.series.length > 1 ? 's' : ''} · média ${money.format(k.aov)}`;
  $('#hourlyNote').textContent = `Brasília · linha = média ${money.format(k.aov)}`;
  renderLine($('#chartDaily'), d.series.map((p) => ({ x: fmtDay(p.date), y: p.aov, tip: `${fmtDay(p.date)}<br><b>${money2.format(p.aov)}</b> · ${int.format(p.orders)} pedidos` })), k.aov);
  renderBars($('#chartHourly'), d.hourly.map((p) => ({ x: `${String(p.hour).padStart(2, '0')}h`, y: p.aov, tip: `${String(p.hour).padStart(2, '0')}h–${String((p.hour + 1) % 24).padStart(2, '0')}h<br><b>${money2.format(p.aov)}</b> · ${int.format(p.orders)} pedidos` })), { labelEvery: 3, avg: k.aov });

  const max = Math.max(...d.steps.map((s) => s.revenue), 1);
  $('#funnel').innerHTML = d.steps.map((s) => `<li class="${s.key}">
    <div><div class="name">${esc(s.label)}</div><div class="meta">${int.format(s.count)} · ticket ${money.format(s.avgTicket)} · ${fmtMoney(s.revenue)}</div></div>
    <div class="rate">${s.key === 'front' ? '100%' : fmtPct(s.takeRate)}<small>${fmtPct(s.share, 0)} da receita</small></div>
    <div class="bar-bg"><div class="bar-fg" style="width:${(s.revenue / max) * 100}%"></div></div></li>`).join('');

  $('#products').innerHTML = rankedAov(d.products, (p) => p.niche) || '<li class="muted">Sem dados</li>';
  $('#productsCount').textContent = d.products.length ? `${d.products.length} produtos` : '';
  $('#nichesCard').hidden = !d.niches.length || (d.niches.length === 1 && !d.niches[0].name);
  $('#niches').innerHTML = rankedAov(d.niches);
  $('#potes').innerHTML = d.potes.map((p, i) => `<li>
    <span class="rank">${i + 1}</span>
    <div><div class="name">${p.units} ${p.units === 1 ? 'pote' : 'potes'}</div><div class="meta">${int.format(p.orders)} pedidos · US1 ${fmtPct(p.us1Rate)}</div></div>
    <div><div class="amt">${money2.format(p.aov)}</div><div class="share">${fmtPct(p.share, 0)} do mix</div></div>
    <div class="bar-bg"><div class="bar-fg" style="width:${p.share}%"></div></div></li>`).join('') || '<li class="muted">Sem dados</li>';

  $('#traffic').innerHTML = d.traffic.map((t) => `<div class="box"><div class="k">${esc(t.label)}</div><div class="v">${money2.format(t.aov)}</div>
    <div class="s"><b>${int.format(t.orders)}</b> pedidos · ${fmtPct(t.share, 0)}</div><div class="s">US1 <b>${fmtPct(t.us1Rate)}</b> · ${fmtMoney(t.revenue)}</div></div>`).join('');
  $('#affiliates').innerHTML = rankedAov(d.affiliates) || '<li class="muted">Sem dados</li>';
  $('#affiliatesCount').textContent = d.affiliates.length ? `${d.affiliates.length} afiliados` : '';
  renderTx();
}

function filterLabel(d) {
  const parts = [];
  if (d.filters.product) parts.push(d.filters.product);
  if (d.filters.traffic) parts.push(d.filters.traffic === 'internal' ? 'interno' : 'afiliados');
  if (d.filters.pote) parts.push(`${d.filters.pote} pote${d.filters.pote > 1 ? 's' : ''}`);
  return parts.length ? ` · ${esc(parts.join(' · '))}` : '';
}

function rankedAov(items, subFn) {
  const max = Math.max(...items.map((i) => i.revenue), 1);
  return items.map((it, i) => `<li>
    <span class="rank">${i + 1}</span>
    <div><div class="name">${esc(it.name)}</div><div class="meta">${subFn && subFn(it) ? `${esc(subFn(it))} · ` : ''}${int.format(it.orders)} pedidos · US1 ${fmtPct(it.us1Rate)}</div></div>
    <div><div class="amt">${money2.format(it.aov)}</div><div class="sub2">${fmtMoney(it.revenue)}</div></div>
    <div class="bar-bg"><div class="bar-fg" style="width:${(it.revenue / max) * 100}%"></div></div></li>`).join('');
}

function renderTx() {
  const d = state.data;
  if (!d) return;
  const f = state.txFilter;
  const list = d.recent.filter((t) => f === 'all' || (f === 'us1' && t.steps.includes('us1')) || (f === 'front' && t.steps.length === 1) || (f === 'refunded' && ['refunded', 'chargeback'].includes(t.status)));
  $('#tx').innerHTML = list.length ? list.map((t) => `<li>
      <div><div class="name">${esc(t.product)} <span class="muted">· ${t.units} ${t.units === 1 ? 'pote' : 'potes'}</span></div>
        <div class="meta">${esc(fmtTime(t.time))} · ${esc(t.affiliate)}${t.id ? ` · ${esc(t.id)}` : ''}</div>
        <div class="steps">${t.steps.map((s) => `<span class="${esc(s)}">${esc(STEP_LABEL[s] || s)}</span>`).join('')}${t.status !== 'approved' ? `<span class="status ${esc(t.status)}">${esc(STATUS_LABEL[t.status] || t.status)}</span>` : ''}</div></div>
      <div class="amt">${money2.format(t.amount)}</div></li>`).join('')
    : '<li class="muted">Nenhum pedido neste filtro</li>';
}

// ---------- filtros ----------
function syncFilterOptions(d) {
  const fill = (sel, values, fmt) => {
    const cur = sel.value;
    const keep = sel.options[0].outerHTML;
    sel.innerHTML = keep + values.map((v) => `<option value="${esc(v)}">${esc(fmt ? fmt(v) : v)}</option>`).join('');
    sel.value = values.map(String).includes(String(cur)) ? cur : '';
  };
  fill($('#fProduct'), d.options.products);
  fill($('#fPote'), d.options.potes, (v) => `${v} ${v === 1 ? 'pote' : 'potes'}`);
  $('#fProduct').value = state.filters.product;
  $('#fTraffic').value = state.filters.traffic;
  $('#fPote').value = state.filters.pote;
  for (const sel of $$('#filters select')) sel.classList.toggle('on', Boolean(sel.value));
  $('#fClear').hidden = !Object.values(state.filters).some(Boolean);
}
$('#filters').addEventListener('change', (e) => {
  const map = { fProduct: 'product', fTraffic: 'traffic', fPote: 'pote' };
  const key = map[e.target.id];
  if (!key) return;
  state.filters[key] = e.target.value;
  save(`jm.f.${key}`, e.target.value);
  loadDashboard();
});
$('#fClear').addEventListener('click', () => {
  state.filters = { product: '', traffic: '', pote: '' };
  for (const k of Object.keys(state.filters)) save(`jm.f.${k}`, '');
  loadDashboard();
});

// ---------- gráficos (SVG inline) ----------
const tip = $('#tooltip');
function showTip(e, html) {
  tip.innerHTML = html; tip.hidden = false;
  const pt = e.touches ? e.touches[0] : e;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = `${Math.min(Math.max(pt.clientX - tw / 2, 8), window.innerWidth - tw - 8)}px`;
  tip.style.top = `${Math.max(pt.clientY - th - 18, 8)}px`;
}
function hideTip() { tip.hidden = true; }
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function niceStep(range) {
  const p = 10 ** Math.floor(Math.log10(range / 2 || 1));
  const f = range / 2 / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function frame(host, points, { zeroBased = true, extra = [] } = {}) {
  const W = Math.max(host.clientWidth || 320, 240), H = host.clientHeight || 180;
  const ys = points.map((p) => p.y).filter((y) => y > 0).concat(extra.filter(Boolean));
  let min = 0, max = niceMax(Math.max(...ys, 1) * 1.05), ticks;
  if (zeroBased || ys.length < 2) {
    ticks = [0, max / 2, max];
  } else {
    const lo = Math.min(...ys), hi = Math.max(...ys);
    const step = niceStep(Math.max(hi - lo, hi * 0.1));
    min = Math.max(0, Math.floor((lo - step * 0.3) / step) * step);
    max = Math.ceil((hi + step * 0.3) / step) * step;
    ticks = [min, (min + max) / 2, max];
  }
  const labelW = Math.max(...ticks.map((t) => moneyCompact.format(t).length)) * 6.4 + 10;
  const pad = { t: 10, r: 10, b: 22, l: Math.ceil(labelW) };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const y = (v) => pad.t + ih - ((v - min) / (max - min)) * ih;
  const axes = `<g class="grid">${ticks.map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`).join('')}</g>
    ${ticks.map((t) => `<text class="ylab" x="${pad.l - 6}" y="${y(t) + 4}">${moneyCompact.format(t)}</text>`).join('')}
    <line class="baseline" x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}"/>`;
  return { W, H, pad, iw, ih, y, axes };
}
function avgLine(f, avg) {
  if (!avg) return '';
  return `<line class="avg" x1="${f.pad.l}" x2="${f.W - f.pad.r}" y1="${f.y(avg)}" y2="${f.y(avg)}"/>`;
}

function renderLine(host, points, avg) {
  if (!points.length) { host.innerHTML = ''; return; }
  const f = frame(host, points, { zeroBased: false, extra: [avg] });
  const n = points.length;
  const x = (i) => f.pad.l + (n === 1 ? f.iw / 2 : (i / (n - 1)) * f.iw);
  const valid = points.map((p, i) => ({ ...p, i })).filter((p) => p.y > 0);
  const path = valid.map((p, j) => `${j ? 'L' : 'M'}${x(p.i)},${f.y(p.y)}`).join(' ');
  const area = valid.length > 1 ? `${path} L${x(valid[valid.length - 1].i)},${f.pad.t + f.ih} L${x(valid[0].i)},${f.pad.t + f.ih} Z` : '';
  const labelEvery = n <= 8 ? 1 : n <= 16 ? 2 : Math.ceil(n / 6);
  host.innerHTML = `<svg viewBox="0 0 ${f.W} ${f.H}" role="img" aria-label="AOV por dia">${f.axes}${avgLine(f, avg)}
    ${area ? `<path class="area" d="${area}"/>` : ''}<path class="line" d="${path}"/>
    <line class="crosshair" id="xh" x1="0" x2="0" y1="${f.pad.t}" y2="${f.pad.t + f.ih}" visibility="hidden"/>
    ${valid.map((p) => `<circle class="marker" data-i="${p.i}" cx="${x(p.i)}" cy="${f.y(p.y)}" r="${n > 20 ? 3 : 4}"/>`).join('')}
    ${points.map((p, i) => (i % labelEvery === 0 ? `<text x="${x(i)}" y="${f.H - 6}" text-anchor="middle">${esc(p.x)}</text>` : '')).join('')}
    ${points.map((p, i) => `<rect class="hit" data-i="${i}" x="${x(i) - f.iw / n / 2}" y="${f.pad.t}" width="${f.iw / n}" height="${f.ih}"/>`).join('')}
  </svg>`;
  wireHover(host, points, (i) => { $('#xh', host).setAttribute('x1', x(i)); $('#xh', host).setAttribute('x2', x(i)); $('#xh', host).setAttribute('visibility', 'visible'); },
    () => $('#xh', host)?.setAttribute('visibility', 'hidden'), '.marker');
}

function renderBars(host, points, { labelEvery = 1, avg } = {}) {
  if (!points.length) { host.innerHTML = ''; return; }
  const f = frame(host, points);
  const n = points.length, gap = 2;
  const bw = Math.max((f.iw - gap * (n - 1)) / n, 2);
  const r = Math.min(4, bw / 2);
  host.innerHTML = `<svg viewBox="0 0 ${f.W} ${f.H}" role="img" aria-label="AOV por hora">${f.axes}${avgLine(f, avg)}
    ${points.map((p, i) => {
      const xx = f.pad.l + i * (bw + gap), top = f.y(p.y), h = Math.max(f.pad.t + f.ih - top, 0);
      const d = h > r ? `M${xx},${f.pad.t + f.ih} V${top + r} a${r},${r} 0 0 1 ${r},-${r} H${xx + bw - r} a${r},${r} 0 0 1 ${r},${r} V${f.pad.t + f.ih} Z` : `M${xx},${f.pad.t + f.ih} h${bw} v-${h} h-${bw} Z`;
      return `<path class="bar" data-i="${i}" d="${d}"/><rect class="hit" data-i="${i}" x="${xx - gap / 2}" y="${f.pad.t}" width="${bw + gap}" height="${f.ih}"/>` + (i % labelEvery === 0 ? `<text x="${xx + bw / 2}" y="${f.H - 6}" text-anchor="middle">${esc(p.x)}</text>` : '');
    }).join('')}
  </svg>`;
  wireHover(host, points, null, null, '.bar');
}

function wireHover(host, points, onShow, onHide, markSel) {
  const marks = $$(markSel, host);
  const show = (e) => {
    const i = Number(e.target.dataset.i);
    if (Number.isNaN(i)) return;
    marks.forEach((m) => m.classList.toggle('dim', Number(m.dataset.i) !== i));
    showTip(e, points[i].tip);
    onShow?.(i);
  };
  const hide = () => { hideTip(); marks.forEach((m) => m.classList.remove('dim')); onHide?.(); };
  host.onpointermove = show; host.onpointerdown = show; host.onpointerleave = hide;
  host.onpointerup = () => setTimeout(hide, 1500);
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
      return `<details class="tool" data-name="${esc(t.name)}"><summary><span>${esc(t.name)}</span></summary>
        <div class="desc">${esc(t.description || '')}</div>
        <textarea spellcheck="false">${esc(JSON.stringify(example, null, 2))}</textarea>
        <button class="btn">Chamar</button><pre hidden></pre></details>`;
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
  } catch (err) { pre.hidden = false; pre.textContent = `Erro: ${err.message}`; }
  finally { btn.disabled = false; btn.textContent = 'Chamar'; }
});

// ---------- navegação ----------
function setView(v) {
  state.view = v; save('jm.view', v);
  $$('.view').forEach((s) => s.classList.toggle('active', s.dataset.view === v));
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  const hide = v === 'explore';
  $('#ranges').style.display = hide ? 'none' : '';
  $('#filters').style.display = hide ? 'none' : '';
  window.scrollTo({ top: 0 });
  if (v === 'explore' && !$('#tools').children.length) loadTools();
  if (v === 'overview' && state.data) render();
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); });
$('#ranges').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.range = b.dataset.range; save('jm.range', state.range);
  $$('#ranges button').forEach((x) => x.classList.toggle('active', x === b));
  loadDashboard();
});
$('#txFilters').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.txFilter = b.dataset.f;
  $$('#txFilters button').forEach((x) => x.classList.toggle('active', x === b));
  renderTx();
});
$('#refreshBtn').addEventListener('click', () => loadDashboard({ fresh: true }));
$('#reloadTools').addEventListener('click', () => loadTools(true));
window.addEventListener('resize', () => state.data && state.view === 'overview' && render());
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.data && Date.now() - new Date(state.data.generatedAt) > 120_000) loadDashboard(); });

// ---------- boot ----------
$$('#ranges button').forEach((x) => x.classList.toggle('active', x.dataset.range === state.range));
setView(state.view);
loadDashboard();
setInterval(() => { if (!document.hidden) loadDashboard(); }, 5 * 60_000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
