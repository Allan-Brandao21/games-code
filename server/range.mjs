// Converte o seletor de período do app em datas ISO (UTC).
const DAY = 86_400_000;

export const RANGES = ['today', 'yesterday', '7d', '30d', 'mtd'];

export function resolveRange(key = '7d', now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let start = end;
  let days = 1;
  switch (key) {
    case 'today':
      start = end; days = 1; break;
    case 'yesterday':
      start = new Date(end.getTime() - DAY);
      return build('yesterday', start, start, 1);
    case '30d':
      days = 30; start = new Date(end.getTime() - (days - 1) * DAY); break;
    case 'mtd':
      start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
      days = Math.round((end - start) / DAY) + 1; break;
    case '7d':
    default:
      key = '7d'; days = 7; start = new Date(end.getTime() - (days - 1) * DAY); break;
  }
  return build(key, start, end, days);
}

function build(key, start, end, days) {
  const prevEnd = new Date(start.getTime() - DAY);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * DAY);
  return {
    key,
    days,
    from: iso(start),
    to: iso(end),
    prevFrom: iso(prevStart),
    prevTo: iso(prevEnd),
  };
}

export function iso(d) {
  return d.toISOString().slice(0, 10);
}

export function eachDay(from, to) {
  const out = [];
  let d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(iso(d));
    d = new Date(d.getTime() + DAY);
  }
  return out;
}
