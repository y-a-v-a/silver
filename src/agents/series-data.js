// A series, assembled from the floor: subject, variants (produced and failed), Warhol's
// shortlist and the human's decisions. Shared by Warhol, the review server and the shift.

export class SeriesNotFound extends Error {
  constructor(message) {
    super(message);
    this.name = 'SeriesNotFound';
  }
}

const SERIES_EVENTS = ['subject.posted', 'chatter.posted', 'series.started', 'variant.produced', 'variant.failed', 'series.completed', 'shortlist.proposed', 'review.decision'];

/**
 * @typedef {object} SeriesView
 * @property {string} seriesId
 * @property {object} started            series.started event
 * @property {object|null} completed     series.completed event
 * @property {object} subject            subject.posted event
 * @property {object[]} chatter          chatter.posted events about the subject
 * @property {{variant: string, technique: string, temperature: number, model: string|null, ok: boolean, png: string|null, html: string|null, reason: string|null, error: string|null}[]} variants
 * @property {object|null} shortlist    the latest shortlist.proposed
 * @property {Map<string, object>} decisions  latest review.decision per variant
 * @property {object|null} closed       the review.decision that closed the review, if any
 */

/** Build every series from one read of the floor. */
export function buildSeriesViews(events) {
  const subjects = new Map();
  const chatter = new Map();
  const views = new Map();
  for (const e of events) {
    const p = e.payload ?? {};
    switch (e.type) {
      case 'subject.posted':
        subjects.set(e.id, e);
        break;
      case 'chatter.posted':
        if (e.ref) (chatter.get(e.ref) ?? chatter.set(e.ref, []).get(e.ref)).push(e);
        break;
      case 'series.started':
        views.set(e.id, { seriesId: e.id, started: e, completed: null, subjectId: p.subjectId, variants: [], shortlist: null, decisions: new Map(), closed: null });
        break;
      case 'variant.produced':
      case 'variant.failed': {
        const v = views.get(p.seriesId);
        if (!v) break;
        const ok = e.type === 'variant.produced';
        v.variants.push({
          variant: p.variant,
          technique: p.technique,
          temperature: p.temperature,
          model: p.model ?? p.requestedModel ?? null,
          ok: ok && p.rendered !== false,
          png: ok ? p.png ?? null : null,
          html: p.path ?? null,
          reason: ok ? (p.rendered === false ? 'unrendered' : null) : p.stage,
          error: ok ? null : p.error ?? null,
        });
        break;
      }
      case 'series.completed':
        if (views.has(p.seriesId)) views.get(p.seriesId).completed = e;
        break;
      case 'shortlist.proposed':
        if (views.has(p.seriesId)) views.get(p.seriesId).shortlist = e;
        break;
      case 'review.decision': {
        const v = views.get(p.seriesId);
        if (!v) break;
        if (p.verdict === 'closed') v.closed = e;
        else if (p.variant) v.decisions.set(p.variant, e);
        break;
      }
    }
  }
  for (const v of views.values()) {
    v.subject = subjects.get(v.subjectId) ?? null;
    v.chatter = chatter.get(v.subjectId) ?? [];
    v.variants.sort((a, b) => a.variant.localeCompare(b.variant));
  }
  return [...views.values()];
}

/** All series, oldest first. */
export async function listSeries(floor) {
  return buildSeriesViews(await floor.read({ shift: 'all', type: SERIES_EVENTS }));
}

/** Completed series whose review is still open (not closed by the human). */
export const isPendingReview = (s) => s.completed !== null && s.closed === null;

/**
 * Find one series by full id, unique id suffix, or a keyword:
 * "latest" = newest completed series; "unlisted" = newest completed series without a shortlist.
 */
export async function findSeries(floor, ref) {
  const all = await listSeries(floor);
  const completed = all.filter((s) => s.completed);
  if (ref === 'latest' || ref === 'unlisted') {
    const pool = ref === 'latest' ? completed : completed.filter((s) => !s.shortlist);
    if (!pool.length) throw new SeriesNotFound(ref === 'latest' ? 'no completed series yet' : 'every completed series has a shortlist');
    return pool.at(-1);
  }
  const key = ref.toUpperCase();
  const matches = all.filter((s) => s.seriesId === key || s.seriesId.endsWith(key));
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw new SeriesNotFound(`no series matches "${ref}"`);
  throw new SeriesNotFound(`"${ref}" matches ${matches.length} series; use more characters`);
}
