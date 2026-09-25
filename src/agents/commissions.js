// Commissions: subjects the human brings to the floor. They skip the Scout and always
// get a series in the next shift (Phase 8 picks commissions first).
import { snapshotPage } from '../lib/snapshot.js';
import { keysOf } from '../lib/dedupe.js';
import { clip } from '../sources/http.js';
import { normalizeSensitive } from './scouts.js';
import { retiredSubjects, claimedSubjects } from './retire.js';

export const MAX_COMMISSION_CHARS = 4000;
const TITLE_CHARS = 140;

export const isUrl = (text) => /^https?:\/\/\S+$/i.test(text.trim());

/**
 * Ask the Scout for its notes on a commission: why it's a ready-made, the image, and a
 * sensitivity flag. Never throws: a failed call returns {ok: false, error}. (LLM failures
 * are already recorded on the floor as llm.failed by the client.)
 * @param {{call: Function}} llm
 * @param {{title: string, url: string|null, why: string|null, snapshot: object}} subject
 */
export async function annotateCommission(llm, subject) {
  const page = subject.snapshot.page;
  const text = [page?.description, page?.text, subject.url ? null : subject.snapshot.snippet].filter(Boolean).join('\n\n') || '(nothing beyond the title)';
  try {
    const res = await llm.call('scout-annotate', {
      vars: { title: subject.title, url: subject.url ?? '(none: a text commission)', human_why: subject.why ?? '(none)', text: text.length > 3000 ? text.slice(0, 2999) + '…' : text },
      prompt: 'Write the notes for this commission. Reply with JSON only.',
    });
    const j = res.json ?? {};
    const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return { ok: true, callId: res.id, why: str(j.why), image: str(j.image), sensitive: normalizeSensitive(j.sensitive) };
  } catch (err) {
    return { ok: false, error: `${err.name}: ${err.message}` };
  }
}

/**
 * Post a commission as subject.posted (origin: commission, actor: human).
 * A repeat of an earlier subject is allowed (repetition is deliberate here) but reported.
 * With `llm`, the Scout annotates it first (scoutWhy, image, sensitive); the human's
 * own `why` is never overwritten, and a failed annotation never blocks the commission.
 * @param {{floor: ReturnType<import('../floor.js').createFloor>, fetch?: typeof globalThis.fetch, llm?: {call: Function}}} deps
 * @param {string} input  free text or a URL
 * @param {{why?: string, annotate?: boolean}} [opts]
 * @returns {Promise<{event: import('../floor.js').FloorEvent, repeatOf: import('../floor.js').FloorEvent|null, annotation: object|null}>}
 */
export async function postCommission({ floor, fetch = globalThis.fetch, llm }, input, { why, annotate = true } = {}) {
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

  const humanWhy = why?.trim() || null;
  const annotation = llm && annotate ? await annotateCommission(llm, { ...payload, why: humanWhy }) : null;
  const notes = annotation?.ok
    ? { scoutWhy: annotation.why, image: annotation.image, sensitive: annotation.sensitive, annotation: { callId: annotation.callId } }
    : { scoutWhy: null, image: null, sensitive: { flag: false, reason: null }, annotation: annotation ? { error: annotation.error } : null };

  const event = await floor.append({
    type: 'subject.posted',
    actor: 'human',
    ref: repeatOf?.id ?? null,
    payload: { origin: 'commission', source: 'commission', why: humanWhy, ...notes, ...payload },
  });
  return { event, repeatOf, annotation };
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
  const started = claimedSubjects(all);
  const retired = await retiredSubjects(floor);
  return all.filter((e) => e.type === 'subject.posted' && e.payload?.origin === 'commission' && !started.has(e.id) && !retired.has(e.id));
}
