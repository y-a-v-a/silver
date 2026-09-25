// The human's side of the review: approve or veto a variant (any variant, not only
// Warhol's picks: the veto works both ways), or close a series' review. Every decision
// is a review.decision on the floor and a line in taste.md, which Warhol reads next time.
import { appendTaste } from '../lib/taste.js';

export const VERDICTS = Object.freeze(['approved', 'vetoed']);
export const MAX_NOTE = 1000;

export class ReviewError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ReviewError';
    this.status = status;
  }
}

/**
 * Record a decision on one variant of a series view (see series-data.js).
 * @param {{config: object, floor: object}} deps
 * @param {import('./series-data.js').SeriesView} series
 * @param {{variant: string, verdict: string, note?: string}} decision
 * @returns {Promise<{duplicate: boolean, event: object}>}
 */
export async function recordDecision({ config, floor }, series, { variant, verdict, note = '' }) {
  if (!VERDICTS.includes(verdict)) throw new ReviewError(`verdict must be one of ${VERDICTS.join(', ')}`);
  const v = series.variants.find((x) => x.variant === variant);
  if (!v) throw new ReviewError(`series ${series.seriesId} has no variant "${variant}"`);
  if (!v.ok) throw new ReviewError(`${variant} failed (${v.reason}); there is nothing to ${verdict === 'approved' ? 'approve' : 'veto'}`);
  const text = String(note).trim();
  if (text.length > MAX_NOTE) throw new ReviewError(`a note is at most ${MAX_NOTE} characters`);

  // The same decision twice (a double click, a resubmitted form) is a no-op: it must not
  // add a second event or taste line, and later it must never print a work twice.
  const current = series.decisions.get(variant)?.payload;
  if (current && current.verdict === verdict && (current.note ?? '') === text) return { duplicate: true, event: series.decisions.get(variant) };

  const pick = series.shortlist?.payload.picks.find((p) => p.variant === variant) ?? null;
  const event = await floor.append({
    type: 'review.decision',
    actor: 'human',
    ref: series.seriesId,
    payload: {
      seriesId: series.seriesId,
      subjectId: series.subject?.id ?? null,
      variant,
      verdict,
      note: text || null,
      pickedByWarhol: Boolean(pick),
      warholNote: pick?.note ?? null,
      technique: v.technique,
      model: v.model,
      png: v.png,
      html: v.html,
    },
  });
  await appendTaste(config.paths.taste, {
    date: event.shift,
    verdict,
    variant,
    technique: v.technique,
    subject: series.subject?.payload.title ?? series.seriesId,
    pickedByWarhol: Boolean(pick),
    note: text,
  });
  return { duplicate: false, event };
}

/** Close a series' review: it leaves the pending list. Decisions stay as they are. */
export async function closeReview({ floor }, series, { note = '' } = {}) {
  if (series.closed) throw new ReviewError(`series ${series.seriesId} is already closed`, 409);
  return floor.append({
    type: 'review.decision',
    actor: 'human',
    ref: series.seriesId,
    payload: { seriesId: series.seriesId, subjectId: series.subject?.id ?? null, variant: null, verdict: 'closed', note: String(note).trim() || null },
  });
}
