// The daily spend cap. The ledger is derived from `cost.recorded` events on the floor,
// so it survives restarts. Reservations hold an estimate for in-flight calls, so
// parallel calls cannot all slip under the cap before any of them has been recorded.

export class BudgetExhausted extends Error {
  /** @param {{scope: 'daily'|'chatter', cap: number, spent: number, reserved: number, estimate: number}} info */
  constructor(info) {
    const { scope, cap, spent, reserved, estimate } = info;
    super(
      `${scope} budget exhausted: $${spent.toFixed(4)} spent + $${reserved.toFixed(4)} in flight` +
        ` + $${estimate.toFixed(4)} requested > $${cap.toFixed(2)} cap`,
    );
    this.name = 'BudgetExhausted';
    Object.assign(this, info);
  }
}

/**
 * Summarise cost.recorded events.
 * @param {import('./floor.js').FloorEvent[]} events
 */
export function summarise(events) {
  const ledger = { total: 0, chatter: 0, calls: 0, promptTokens: 0, completionTokens: 0, byRole: {}, byModel: {} };
  const bump = (bucket, key, p) => {
    const row = (bucket[key] ??= { calls: 0, usd: 0, promptTokens: 0, completionTokens: 0 });
    row.calls += 1;
    row.usd += p.usd ?? 0;
    row.promptTokens += p.promptTokens ?? 0;
    row.completionTokens += p.completionTokens ?? 0;
  };
  for (const { type, payload: p } of events) {
    if (type !== 'cost.recorded') continue;
    ledger.calls += 1;
    ledger.total += p.usd ?? 0;
    ledger.promptTokens += p.promptTokens ?? 0;
    ledger.completionTokens += p.completionTokens ?? 0;
    if (p.group === 'superstar') ledger.chatter += p.usd ?? 0;
    bump(ledger.byRole, p.role ?? 'unknown', p);
    bump(ledger.byModel, p.model ?? 'unknown', p);
  }
  return ledger;
}

/**
 * @param {{floor: ReturnType<import('./floor.js').createFloor>, dailyUsd: number, chatterShare: number}} opts
 */
export function createBudget({ floor, dailyUsd, chatterShare }) {
  const chatterCap = dailyUsd * chatterShare;
  const inFlight = new Map(); // token -> {usd, chatter}
  let nextToken = 0;
  let lock = Promise.resolve();

  const reservedUsd = (onlyChatter = false) =>
    [...inFlight.values()].filter((r) => !onlyChatter || r.chatter).reduce((sum, r) => sum + r.usd, 0);

  async function ledger(shift = floor.today()) {
    return summarise(await floor.read({ shift, type: 'cost.recorded' }));
  }

  /**
   * Throw BudgetExhausted if spending `estimateUsd` more would break a cap.
   * @param {number} [estimateUsd]
   * @param {{chatter?: boolean}} [opts]
   */
  async function check(estimateUsd = 0, { chatter = false } = {}) {
    const l = await ledger();
    const reserved = reservedUsd();
    // Strictly greater: spending exactly up to the cap is allowed, but once the cap is
    // reached even a zero-estimate call is refused.
    if (l.total >= dailyUsd || l.total + reserved + estimateUsd > dailyUsd) {
      throw new BudgetExhausted({ scope: 'daily', cap: dailyUsd, spent: l.total, reserved, estimate: estimateUsd });
    }
    if (chatter) {
      const reservedChatter = reservedUsd(true);
      if (l.chatter >= chatterCap || l.chatter + reservedChatter + estimateUsd > chatterCap) {
        throw new BudgetExhausted({ scope: 'chatter', cap: chatterCap, spent: l.chatter, reserved: reservedChatter, estimate: estimateUsd });
      }
    }
  }

  /**
   * Check, then hold `estimateUsd` until the returned release() is called
   * (after the call's real cost has been recorded on the floor).
   * @returns {Promise<() => void>}
   */
  function reserve(estimateUsd = 0, { chatter = false } = {}) {
    // Serialised: otherwise two callers could both pass check() before either holds its share.
    const attempt = lock.then(async () => {
      await check(estimateUsd, { chatter });
      const token = nextToken++;
      inFlight.set(token, { usd: estimateUsd, chatter });
      return () => inFlight.delete(token);
    });
    lock = attempt.catch(() => {});
    return attempt;
  }

  async function remaining() {
    const l = await ledger();
    return Math.max(0, dailyUsd - l.total - reservedUsd());
  }

  return { dailyUsd, chatterCap, ledger, check, reserve, remaining, inFlight: () => reservedUsd() };
}
