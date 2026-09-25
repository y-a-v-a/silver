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
        vars: { edition: String(next), work: describeWork(work, subjects.get(work.subjectId)) },
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
      edition = next;
    } catch (err) {
      if (err.name === 'BudgetExhausted') throw err;
      failed.push({ canonId: work.canonId, error: err.message });
    }
  }
  if (released.length) await writeCanonJson(config, await readCanon(floor));
  return { released, failed };
}
