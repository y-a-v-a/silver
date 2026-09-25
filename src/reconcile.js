// Reconciliation: what OpenRouter billed this key vs what reached our ledger
// (cost.recorded). A gap means billed calls we never recorded, such as replies that timed
// out after the provider had already generated them (decision 2026-09-25).
import { OPENROUTER_BASE_URL } from './llm.js';

export class ReconcileError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReconcileError';
  }
}

/**
 * OpenRouter's usage for the API key. `daily` is the current UTC day.
 * @returns {Promise<{total: number, daily: number, weekly: number, monthly: number}>}
 */
export async function fetchKeyUsage({ apiKey, baseUrl = OPENROUTER_BASE_URL, fetch = globalThis.fetch }) {
  if (!apiKey) throw new ReconcileError('OPENROUTER_API_KEY is not set');
  let res;
  try {
    res = await fetch(`${baseUrl}/key`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new ReconcileError(`could not reach OpenRouter: ${err.message}`);
  }
  if (!res.ok) throw new ReconcileError(`OpenRouter /key answered HTTP ${res.status}`);
  const { data } = await res.json();
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { total: num(data?.usage), daily: num(data?.usage_daily), weekly: num(data?.usage_weekly), monthly: num(data?.usage_monthly) };
}

/** Start of the UTC day containing `now`. */
export const utcDayStart = (now = new Date()) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

/**
 * Compare billed usage with the ledger.
 * @param {import('./floor.js').FloorEvent[]} costEvents  every cost.recorded event
 * @param {{total: number, daily: number}} billed
 * @param {Date} [now]
 */
export function reconcile(costEvents, billed, now = new Date()) {
  const since = utcDayStart(now);
  let ledgerTotal = 0;
  let ledgerDay = 0;
  for (const e of costEvents) {
    const usd = e.payload?.usd ?? 0;
    ledgerTotal += usd;
    if (Date.parse(e.ts) >= since) ledgerDay += usd;
  }
  const row = (ledger, bill) => ({ ledger, billed: bill, gap: bill - ledger });
  return { utcDay: new Date(since).toISOString().slice(0, 10), day: row(ledgerDay, billed.daily), total: row(ledgerTotal, billed.total) };
}
