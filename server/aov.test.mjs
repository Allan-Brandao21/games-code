import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, applyFilters } from './aov.mjs';
import { normalizeOrders, normalizeStep, normalizeStatus } from './normalize.mjs';
import { resolveRange, eachDay } from './range.mjs';
import { mockDashboard, ordersForDay } from './mock.mjs';

const range = resolveRange('7d', new Date('2026-09-12T15:00:00Z'));

test('resolveRange calcula 7 dias e período anterior', () => {
  assert.equal(range.from, '2026-09-06');
  assert.equal(range.to, '2026-09-12');
  assert.equal(range.prevFrom, '2026-08-30');
  assert.equal(eachDay(range.from, range.to).length, 7);
});

test('aggregate calcula AOV e take rates a partir de pedidos', () => {
  const orders = [
    { id: '1', time: '2026-09-10T15:00:00Z', product: 'A', niche: 'N', affiliate: 'X', traffic: 'affiliates', units: 1, status: 'approved', items: [{ step: 'front', amount: 100 }, { step: 'us1', amount: 50 }], total: 150 },
    { id: '2', time: '2026-09-10T16:00:00Z', product: 'A', niche: 'N', affiliate: 'Interno', traffic: 'internal', units: 3, status: 'approved', items: [{ step: 'front', amount: 200 }], total: 200 },
    { id: '3', time: '2026-09-11T16:00:00Z', product: 'B', niche: 'N', affiliate: 'X', traffic: 'affiliates', units: 1, status: 'declined', items: [{ step: 'front', amount: 100 }], total: 100 },
  ];
  const d = aggregate({ orders, prevOrders: [], range, source: 'test' });
  assert.equal(d.kpis.orders, 2);
  assert.equal(d.kpis.revenue, 350);
  assert.equal(d.kpis.aov, 175);
  assert.equal(d.kpis.aovFront, 150);
  assert.equal(d.kpis.upliftPerOrder, 25);
  assert.equal(d.kpis.takeRates.us1, 50);
  assert.equal(d.steps.find((s) => s.key === 'us1').revenue, 50);
  assert.equal(d.hourly[12].orders, 1); // 15h UTC = 12h Brasília
  assert.equal(d.traffic.find((t) => t.key === 'internal').aov, 200);
  assert.equal(d.potes.length, 2);
  assert.equal(d.series.length, 7);
  assert.equal(d.series.find((x) => x.date === '2026-09-10').orders, 2);
  assert.equal(applyFilters(orders, { pote: 3 }).length, 1);
  assert.equal(applyFilters(orders, { traffic: 'internal' }).length, 1);
});

test('normalizeOrders aceita itens aninhados e colunas achatadas', () => {
  const out = normalizeOrders({
    data: [
      { order_id: 'A1', created_at: '2026-09-11T10:00:00Z', product_name: 'AlkaPic', affiliate_name: 'Gil', qty: 3, status: 'paid', line_items: [{ title: 'Front 3 units', price: '177.00' }, { title: 'Upsell 1', price: 147 }, { sku: 'ORDER_BUMP', price: 19 }] },
      { id: 2, date: 1789000000, produto: 'JellyBlue', total_price: 148, upsell_1_amount: 69, is_house_traffic: 1, financial_status: 3 },
    ],
  });
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].items.map((i) => i.step), ['front', 'us1', 'bump']);
  assert.equal(out[0].total, 343);
  assert.equal(out[0].units, 3);
  assert.equal(out[0].traffic, 'affiliates');
  assert.equal(out[1].traffic, 'internal');
  assert.equal(out[1].status, 'approved');
  assert.ok(out[1].items.some((i) => i.step === 'us1' && i.amount === 69));
  assert.equal(normalizeStep('OTO2'), 'us2');
  assert.equal(normalizeStep('downsell'), 'ds1');
  assert.equal(normalizeStatus('Reembolsado'), 'refunded');
});

test('mock é determinístico e coerente', async () => {
  assert.deepEqual(ordersForDay('2026-09-10')[0], ordersForDay('2026-09-10')[0]);
  const a = await mockDashboard('7d');
  assert.equal(a.series.length, 7);
  assert.equal(a.hourly.length, 24);
  assert.ok(a.kpis.aov > a.kpis.aovFront);
  assert.ok(a.kpis.takeRates.us1 > 10 && a.kpis.takeRates.us1 < 60);
  assert.equal(a.steps.reduce((s, x) => s + x.revenue, 0).toFixed(0), a.kpis.revenue.toFixed(0));
  const f = await mockDashboard('7d', { traffic: 'internal', pote: 1 });
  assert.ok(f.kpis.orders < a.kpis.orders);
  assert.ok(f.recent.every((r) => r.traffic === 'internal' && r.units === 1));
});
