import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFloor } from '../src/floor.js';
import { createBudget, summarise, BudgetExhausted } from '../src/budget.js';

async function setup({ dailyUsd = 1, chatterShare = 0.1 } = {}) {
  const floor = createFloor({ dir: await mkdtemp(join(tmpdir(), 'silver-budget-')) });
  const budget = createBudget({ floor, dailyUsd, chatterShare });
  const spend = (usd, extra = {}) =>
    floor.append({
      type: 'cost.recorded',
      actor: extra.group === 'superstar' ? 'superstar.brigid' : 'scout',
      payload: { role: 'scout', group: 'role', model: 'x/m', usd, promptTokens: 10, completionTokens: 5, ...extra },
    });
  return { floor, budget, spend };
}

test('summarise totals cost events by role and model and ignores others', () => {
  const ev = (payload, type = 'cost.recorded') => ({ type, payload });
  const l = summarise([
    ev({ role: 'scout', group: 'role', model: 'a/1', usd: 0.1, promptTokens: 100, completionTokens: 10 }),
    ev({ role: 'brigid', group: 'superstar', model: 'b/2', usd: 0.02, promptTokens: 50, completionTokens: 5 }),
    ev({ role: 'scout', group: 'role', model: 'b/2', usd: 0.3, promptTokens: 1, completionTokens: 1 }),
    ev({ usd: 99 }, 'chatter.posted'),
  ]);
  assert.equal(l.calls, 3);
  assert.equal(l.total.toFixed(2), '0.42');
  assert.equal(l.chatter, 0.02);
  assert.equal(l.byRole.scout.calls, 2);
  assert.equal(l.byModel['b/2'].usd.toFixed(2), '0.32');
  assert.equal(l.promptTokens, 151);
});

test('check passes under the cap and throws BudgetExhausted over it', async () => {
  const { budget, spend } = await setup({ dailyUsd: 1 });
  await spend(0.6);
  await budget.check(0.4); // exactly up to the cap is fine
  await assert.rejects(budget.check(0.41), (err) => {
    assert.ok(err instanceof BudgetExhausted);
    assert.equal(err.scope, 'daily');
    assert.equal(err.spent, 0.6);
    return true;
  });
});

test('once the cap is reached, even a zero-estimate call is refused', async () => {
  const { budget, spend } = await setup({ dailyUsd: 1 });
  await spend(1);
  await assert.rejects(budget.check(0), BudgetExhausted);
  assert.equal(await budget.remaining(), 0);
});

test('chatter has its own share of the cap', async () => {
  const { budget, spend } = await setup({ dailyUsd: 1, chatterShare: 0.1 });
  await spend(0.08, { group: 'superstar', role: 'brigid' });
  await budget.check(0.5); // non-chatter still fine
  await budget.check(0.02, { chatter: true });
  await assert.rejects(budget.check(0.03, { chatter: true }), (err) => err.scope === 'chatter');
});

test('reservations hold budget for in-flight calls until released', async () => {
  const { budget } = await setup({ dailyUsd: 1 });
  const release = await budget.reserve(0.7);
  assert.equal(budget.inFlight(), 0.7);
  await assert.rejects(budget.reserve(0.4), BudgetExhausted);
  release();
  assert.equal(budget.inFlight(), 0);
  (await budget.reserve(0.4))();
});

test('concurrent reservations cannot oversubscribe the cap', async () => {
  const { budget } = await setup({ dailyUsd: 1 });
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => budget.reserve(0.3)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason instanceof BudgetExhausted));
});

test('remaining accounts for spend and reservations; ledger is per shift', async () => {
  const { budget, spend } = await setup({ dailyUsd: 5 });
  await spend(1.25);
  const release = await budget.reserve(0.75);
  assert.equal(await budget.remaining(), 3);
  release();
  assert.equal((await budget.ledger('1999-01-01')).total, 0);
});
