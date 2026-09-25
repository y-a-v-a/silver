import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchKeyUsage, reconcile, utcDayStart, ReconcileError } from '../src/reconcile.js';
import { routeFetch } from './helpers.js';

test('fetchKeyUsage reads usage, daily, weekly and monthly from /key', async () => {
  const fetch = routeFetch({ 'https://or.test/api/v1/key': { data: { usage: 0.9, usage_daily: 0.07, usage_weekly: 0.6, usage_monthly: 0.9 } } });
  assert.deepEqual(await fetchKeyUsage({ apiKey: 'k', baseUrl: 'https://or.test/api/v1', fetch }), { total: 0.9, daily: 0.07, weekly: 0.6, monthly: 0.9 });
  assert.equal(fetch.seen[0].headers.Authorization, 'Bearer k');
});

test('fetchKeyUsage fails clearly without a key, on HTTP errors and when offline', async () => {
  await assert.rejects(fetchKeyUsage({ apiKey: '' }), /not set/);
  await assert.rejects(fetchKeyUsage({ apiKey: 'k', baseUrl: 'https://or.test', fetch: routeFetch({ 'https://or.test/key': 401 }) }), (e) => e instanceof ReconcileError && /HTTP 401/.test(e.message));
  await assert.rejects(fetchKeyUsage({ apiKey: 'k', baseUrl: 'https://or.test', fetch: routeFetch({ 'https://or.test/key': new TypeError('offline') }) }), /could not reach/);
});

test('reconcile splits the ledger by UTC day and reports the gaps', () => {
  const now = new Date('2026-09-25T10:00:00Z');
  assert.equal(new Date(utcDayStart(now)).toISOString(), '2026-09-25T00:00:00.000Z');
  const ev = (ts, usd) => ({ ts, payload: { usd } });
  const r = reconcile([ev('2026-09-24T23:59:59Z', 0.5), ev('2026-09-25T00:00:00Z', 0.03), ev('2026-09-25T09:00:00Z', 0.02)], { total: 0.6, daily: 0.07 }, now);
  assert.equal(r.utcDay, '2026-09-25');
  assert.deepEqual({ l: +r.day.ledger.toFixed(2), b: r.day.billed, g: +r.day.gap.toFixed(2) }, { l: 0.05, b: 0.07, g: 0.02 });
  assert.equal(+r.total.gap.toFixed(2), 0.05);
});
