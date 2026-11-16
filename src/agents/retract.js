// Retracting a work: the human takes a signed work back off the wall. Nothing is deleted. The
// work keeps its signature, its files and its place in the canon; a `work.retracted` event on the
// floor takes it off the gallery and out of the feed, and its edition number stays empty for
// good, so the gap is in the record too. `work.reinstated` puts it back, under the same number.
// The latest of the two counts. A retraction is not a veto: it teaches Warhol nothing (taste.md
// isn't touched), because the reason may have nothing to do with the picture.
import { readCanon, workName, writeCanonJson } from '../canon.js';

export const MAX_REASON = 1000;

export class RetractError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'RetractError';
    this.status = status;
  }
}

/**
 * Find a work by edition number ("17", "017", "No. 017") or, for one that has no number yet,
 * by its canon id.
 * @param {object[]} canon  from readCanon
 * @param {string|number} ref
 */
export function findWork(canon, ref) {
  const text = String(ref ?? '').trim();
  if (!text) throw new RetractError('which work? Give its edition number (e.g. 17) or its canon id');
  const number = text.replace(/^No\.?\s*/i, '');
  if (/^\d+$/.test(number)) {
    const edition = Number(number);
    const work = canon.find((w) => w.edition === edition);
    if (!work) throw new RetractError(`there is no edition No. ${String(edition).padStart(3, '0')}`, 404);
    return work;
  }
  const work = canon.find((w) => w.canonId === text);
  if (!work) throw new RetractError(`there is no work "${text}" in the canon`, 404);
  return work;
}

const day = (iso) => String(iso).slice(0, 10);

/**
 * Retract a work: off the gallery and the feed, with the reason on the floor. Retracting one
 * that is already retracted is refused, so the reason on record stays the one that counted.
 * A work with no number yet is retracted too: Fred Hughes then never numbers it.
 * @param {{config: object, floor: object}} deps
 * @param {{ref: string|number, reason?: string|null}} what
 * @returns {Promise<{event: object, work: object}>}
 */
export async function retractWork({ config, floor }, { ref, reason = null }) {
  const work = findWork(await readCanon(floor), ref);
  if (work.retracted) throw new RetractError(`${workName(work)} was already retracted on ${day(work.retracted.at)}`, 409);
  const text = String(reason ?? '').trim();
  if (text.length > MAX_REASON) throw new RetractError(`a reason is at most ${MAX_REASON} characters`);
  const event = await floor.append({
    type: 'work.retracted',
    actor: 'human',
    ref: work.workEventId,
    payload: { canonId: work.canonId, edition: work.edition, title: work.title ?? null, subjectTitle: work.subjectTitle ?? null, variant: work.variant ?? null, reason: text || null },
  });
  await writeCanonJson(config, await readCanon(floor));
  return { event, work };
}

/**
 * Put a retracted work back: on the wall again under its own number (or, if it never had one,
 * numbered by Fred Hughes on the next publish, like any new work).
 * @param {{config: object, floor: object}} deps
 * @param {{ref: string|number}} what
 * @returns {Promise<{event: object, work: object}>}
 */
export async function reinstateWork({ config, floor }, { ref }) {
  const work = findWork(await readCanon(floor), ref);
  if (!work.retracted) throw new RetractError(`${workName(work)} isn't retracted: ${work.edition !== null ? "it's on the wall" : "it's waiting for its label"}`, 409);
  const event = await floor.append({
    type: 'work.reinstated',
    actor: 'human',
    ref: work.workEventId,
    payload: { canonId: work.canonId, edition: work.edition, title: work.title ?? null, subjectTitle: work.subjectTitle ?? null, variant: work.variant ?? null, replaces: work.retracted.eventId },
  });
  await writeCanonJson(config, await readCanon(floor));
  return { event, work };
}
