// Commissions: subjects the human brings to the floor. They skip the Scout and always
// get a series in the next shift (Phase 8 picks commissions first).
import { snapshotPage } from '../lib/snapshot.js';
import { keysOf } from '../lib/dedupe.js';
import { clip } from '../sources/http.js';

export const MAX_COMMISSION_CHARS = 4000;
const TITLE_CHARS = 140;

export const isUrl = (text) => /^https?:\/\/\S+$/i.test(text.trim());

/**
 * Post a commission as subject.posted (origin: commission, actor: human).
 * A repeat of an earlier subject is allowed (repetition is deliberate here) but reported.
 * @param {{floor: ReturnType<import('../floor.js').createFloor>, fetch?: typeof globalThis.fetch}} deps
 * @param {string} input  free text or a URL
 * @param {{why?: string}} [opts]
 * @returns {Promise<{event: import('../floor.js').FloorEvent, repeatOf: import('../floor.js').FloorEvent|null}>}
 */
export async function postCommission({ floor, fetch = globalThis.fetch }, input, { why } = {}) {
  const text = String(input ?? '').trim();
  if (!text) throw new CommissionError('a commission needs some text or a URL');
  if (text.length > MAX_COMMISSION_CHARS) throw new CommissionError(`a commission is at most ${MAX_COMMISSION_CHARS} characters`);

  let payload;
  const fetchedAt = new Date().toISOString();
  if (isUrl(text)) {
    const page = await snapshotPage(text, { fetch });
    payload = {
      title: page.title ? clip(page.title, TITLE_CHARS) : text,
      url: text,
      snapshot: { snippet: page.description ?? '', fetchedAt, meta: {}, page },
    };
  } else {
    payload = { title: clip(text, TITLE_CHARS), url: null, snapshot: { snippet: text, fetchedAt, meta: {}, page: null } };
  }

  const history = await floor.read({ shift: 'all', type: 'subject.posted' });
  const keys = new Set(keysOf(payload));
  const repeatOf = history.find((e) => keysOf(e.payload ?? {}).some((k) => keys.has(k))) ?? null;

  const event = await floor.append({
    type: 'subject.posted',
    actor: 'human',
    ref: repeatOf?.id ?? null,
    payload: { origin: 'commission', source: 'commission', why: why?.trim() || null, image: null, ...payload },
  });
  return { event, repeatOf };
}

export class CommissionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CommissionError';
  }
}

/** Commissions that have no series yet. A series claims its subject via series.started payload.subjectId. */
export async function pendingCommissions(floor) {
  const all = await floor.read({ shift: 'all', type: ['subject.posted', 'series.started'] });
  const started = new Set(all.filter((e) => e.type === 'series.started').map((e) => e.payload?.subjectId));
  return all.filter((e) => e.type === 'subject.posted' && e.payload?.origin === 'commission' && !started.has(e.id));
}
