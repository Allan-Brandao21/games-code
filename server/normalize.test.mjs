import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLoose, normalizeStatus, delta } from './normalize.mjs';
import { resolveRange, eachDay } from './range.mjs';
import { mockDashboard } from './mock.mjs';

test('resolveRange calcula 7 dias e período anterior', () => {
  const r = resolveRange('7d', new Date('2026-09-12T15:00:00Z'));
  assert.equal(r.from, '2026-09-06');
  assert.equal(r.to, '2026-09-12');
  assert.equal(r.prevFrom, '2026-08-30');
  assert.equal(r.prevTo, '2026-09-05');
  assert.equal(eachDay(r.from, r.to).length, 7);
});

test('normalizeStatus mapeia variações', () => {
  assert.equal(normalizeStatus('PAID'), 'approved');
  assert.equal(normalizeStatus('Reembolsado'), 'refunded');
  assert.equal(normalizeStatus('chargeback'), 'chargeback');
  assert.equal(normalizeStatus('declined'), 'declined');
});

test('delta', () => {
  assert.equal(delta(110, 100), 10);
  assert.equal(delta(10, 0), null);
});

test('normalizeLoose aceita chaves em pt e en', () => {
  const range = resolveRange('7d');
  const out = normalizeLoose({
    data: {
      summary: { receita: '1200.50', pedidos: 10, reembolsos: 1 },
      por_dia: [{ data: '2026-09-10', receita: 600, pedidos: 5 }, { data: '2026-09-11', receita: 600.5, pedidos: 5 }],
      produtos: [{ nome: 'AlkaPic', receita: 900, pedidos: 7 }],
      transacoes: [{ id: 1, created_at: '2026-09-11T10:00:00Z', produto: 'AlkaPic', total_price: 69, status: 'paid' }],
    },
  }, { source: 'mcp', range });
  assert.equal(out.kpis.revenue, 1200.5);
  assert.equal(out.kpis.orders, 10);
  assert.equal(out.kpis.aov, 120.05);
  assert.equal(out.series.length, 2);
  assert.equal(out.products[0].name, 'AlkaPic');
  assert.equal(out.recent[0].status, 'approved');
  assert.equal(out.recent[0].amount, 69);
});

test('mock é determinístico e coerente', async () => {
  const a = await mockDashboard('7d');
  const b = await mockDashboard('7d');
  assert.deepEqual(a.kpis, b.kpis);
  assert.equal(a.series.length, 7);
  assert.equal(a.series.reduce((s, p) => s + p.orders, 0), a.kpis.orders);
  assert.ok(a.kpis.approvalRate > 50 && a.kpis.approvalRate < 100);
});
