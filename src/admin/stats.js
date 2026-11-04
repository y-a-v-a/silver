// What the record says about what works: per technique, model and superstar, how much was
// made, how much died, what Warhol picked and what you approved. This is the evidence for
// steering, so it sits next to the controls.

const row = () => ({ made: 0, failed: 0, picked: 0, approved: 0, vetoed: 0, usd: 0, priced: 0 });

/**
 * @param {import('../agents/series-data.js').SeriesView[]} views
 * @param {{since?: string}} [opts]  only series from this shift on (YYYY-MM-DD)
 */
export function computeStats(views, { since = '' } = {}) {
  const techniques = new Map();
  const models = new Map();
  const superstars = new Map();
  const dares = new Map();
  const bump = (map, key) => (map.get(key) ?? map.set(key, row()).get(key));
  for (const s of views) {
    if (s.started.payload.dryRun || s.started.shift < since) continue;
    const picks = new Set((s.shortlist?.payload.picks ?? []).map((p) => p.variant));
    for (const v of s.variants) {
      const verdict = s.decisions.get(v.variant)?.payload.verdict;
      const rows = [bump(techniques, v.technique), v.model && bump(models, v.model), v.brief && bump(superstars, v.brief.from), v.dare && bump(dares, v.dare)].filter(Boolean);
      for (const r of rows) {
        if (v.ok) r.made++;
        // A refusal for lack of credit says nothing about the model or the procedure.
        else if (!/credits|budget/i.test(`${v.reason} ${v.error}`)) r.failed++;
        if (picks.has(v.variant)) r.picked++;
        if (verdict === 'approved') r.approved++;
        if (verdict === 'vetoed') r.vetoed++;
        if (typeof v.usd === 'number') {
          r.usd += v.usd;
          r.priced++;
        }
      }
    }
  }
  return { techniques, models, superstars, dares };
}

/** Average spend of the last real shifts that ran to the end, as the honest forecast for the next. */
export function shiftCost(events, n = 7) {
  const ended = events.filter((e) => e.type === 'shift.ended' && !e.payload?.dryRun && !e.payload?.stoppedReason).slice(-n);
  if (!ended.length) return null;
  return ended.reduce((sum, e) => sum + (e.payload.spentUsd ?? 0), 0) / ended.length;
}

/** Average cost of a variant across the recent record, for the "what would this cost" line. */
export function variantCost(stats) {
  let usd = 0;
  let priced = 0;
  for (const r of stats.models.values()) {
    usd += r.usd;
    priced += r.priced;
  }
  return priced ? usd / priced : null;
}
