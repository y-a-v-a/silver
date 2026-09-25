// Fred Hughes: gives each signed work its edition number, an English title and wall text,
// and releases it to the site. If his call fails, the work stays unreleased and is picked
// up by the next publish, rather than going out with a placeholder title.
import { readCanon, writeCanonJson } from '../canon.js';

export const MAX_TITLE = 80;
export const MAX_WALL_TEXT = 700;

const clean = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim().replace(/^["“”']+|["“”']+$/g, '');
  return t ? (t.length > max ? t.slice(0, max - 1) + '…' : t) : null;
};

/** The facts Fred Hughes may use, as prompt text. */
export function describeWork(work, subject) {
  const p = subject?.payload ?? {};
  const host = work.sourceUrl ? (() => { try { return new URL(work.sourceUrl).hostname.replace(/^www\./, ''); } catch { return null; } })() : null;
  return [
    `Headline / subject: ${work.subjectTitle}`,
    host && `Source: ${host}`,
    (p.why || p.scoutWhy) && `Why it is a ready-made: ${[p.why, p.scoutWhy].filter(Boolean).join(' / ')}`,
    `Technique: ${work.technique}`,
    work.warholNote && `Warhol's note: ${work.warholNote}`,
    work.humanNote && `The human's note: ${work.humanNote}`,
    `Signed: ${work.publishedAt.slice(0, 10)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Titles already released for the same subject (or series), as prompt text. */
export function takenTitles(canon, work) {
  const same = canon.filter((w) => w.canonId !== work.canonId && w.edition !== null && w.title && ((work.subjectId && w.subjectId === work.subjectId) || w.seriesId === work.seriesId));
  return same.length ? same.map((w) => `- ${w.title} (No. ${String(w.edition).padStart(3, '0')})`).join('\n') : '(none yet)';
}

/**
 * Release every signed work that has no edition yet, in the order they were signed.
 * @param {{config: object, floor: object, llm: {call: Function}}} deps
 * @returns {Promise<{released: object[], failed: {canonId: string, error: string}[]}>}
 */
export async function releaseEditions({ config, floor, llm }) {
  const canon = await readCanon(floor);
  const subjects = new Map((await floor.read({ shift: 'all', type: 'subject.posted' })).map((e) => [e.id, e]));
  let edition = Math.max(0, ...canon.map((w) => w.edition ?? 0));
  const todo = canon.filter((w) => w.edition === null).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  const released = [];
  const failed = [];

  for (const work of todo) {
    const next = edition + 1;
    try {
      const res = await llm.call('fred-hughes', {
        vars: { edition: String(next), work: describeWork(work, subjects.get(work.subjectId)), taken: takenTitles(canon, work) },
        prompt: 'Title and wall text, please. JSON only.',
        ref: work.workEventId,
      });
      const title = clean(res.json?.title, MAX_TITLE);
      const wallText = clean(res.json?.wallText, MAX_WALL_TEXT);
      if (!title || !wallText) throw new Error('reply is missing a title or wall text');
      released.push(
        await floor.append({
          type: 'edition.released',
          actor: 'fred-hughes',
          ref: work.workEventId,
          payload: { canonId: work.canonId, edition: next, title, wallText, channel: 'site', callId: res.id },
        }),
      );
      Object.assign(work, { edition: next, title }); // the next work in this run sees the title as taken
      edition = next;
    } catch (err) {
      if (err.name === 'BudgetExhausted') throw err;
      failed.push({ canonId: work.canonId, error: err.message });
    }
  }
  if (released.length) await writeCanonJson(config, await readCanon(floor));
  return { released, failed };
}

export class RetitleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RetitleError';
  }
}

/**
 * Correct a released edition's label (decision 2026-09-25): a new `edition.released` for the
 * same work and number, marked as a correction. With a title and/or wall text given, those
 * are used as they are (the other is kept); otherwise Fred Hughes rewrites both, told what
 * was wrong. The edition number never changes, and the old label stays on the floor.
 * @param {{config: object, floor: object, llm: {call: Function}|null}} deps
 * @param {{edition: number, title?: string, wallText?: string, note?: string}} change
 * @returns {Promise<object>} the correcting edition.released event
 */
export async function retitleEdition({ config, floor, llm }, { edition, title, wallText, note }) {
  const canon = await readCanon(floor);
  const work = canon.find((w) => w.edition === edition);
  if (!work) throw new RetitleError(`there is no edition No. ${String(edition).padStart(3, '0')}`);
  let next = { title: clean(title, MAX_TITLE) ?? work.title, wallText: clean(wallText, MAX_WALL_TEXT) ?? work.wallText };
  let callId = null;
  if (!title && !wallText) {
    if (!llm) throw new RetitleError('give --title and/or --wall, or let Fred Hughes rewrite it (needs a model)');
    const subjects = new Map((await floor.read({ shift: 'all', type: 'subject.posted' })).map((e) => [e.id, e]));
    const res = await llm.call('fred-hughes', {
      vars: { edition: String(edition), work: describeWork(work, subjects.get(work.subjectId)), taken: takenTitles(canon, work) },
      prompt: [
        'This is a correction of a label that is already on the wall.',
        `Current title: ${work.title}`,
        `Current wall text: ${work.wallText}`,
        note ? `What is wrong with it, from the human: ${note}` : 'The human asked for a new label.',
        'The human\'s correction outranks every other note above. Keep what is right, fix what is wrong, and add nothing that is not in the facts. Title and wall text, please. JSON only.',
      ].join('\n'),
      ref: work.editionEventId,
    });
    next = { title: clean(res.json?.title, MAX_TITLE), wallText: clean(res.json?.wallText, MAX_WALL_TEXT) };
    if (!next.title || !next.wallText) throw new RetitleError('Fred Hughes replied without a title or wall text');
    callId = res.id;
  }
  if (next.title === work.title && next.wallText === work.wallText) throw new RetitleError('nothing to change: the label is the same');
  const event = await floor.append({
    type: 'edition.released',
    actor: title || wallText ? 'human' : 'fred-hughes',
    ref: work.workEventId,
    payload: { canonId: work.canonId, edition, title: next.title, wallText: next.wallText, channel: 'site', callId, correction: true, replaces: work.editionEventId, note: note ?? null },
  });
  await writeCanonJson(config, await readCanon(floor));
  return event;
}
