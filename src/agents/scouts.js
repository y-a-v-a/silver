// The Scouts: pull ready-made subjects from mass media and post them as subject cards.
// Gather -> dedupe against the floor -> the Scout picks -> snapshot -> subject.posted.
import { gatherCandidates } from '../sources/index.js';
import { dedupe, subjectKeys } from '../lib/dedupe.js';
import { snapshotPage } from '../lib/snapshot.js';
import { clip } from '../sources/http.js';
import { shiftOf } from '../floor.js';

/** How many candidates the Scout sees at most (keeps the prompt bounded). */
export const MAX_CANDIDATES = 160;
/** How many recent subject titles the Scout is reminded of. */
export const RECENT_SUBJECTS = 40;

/** The numbered candidate list shown to the Scout (1-based). */
export function formatCandidates(candidates) {
  return candidates.map((c, i) => `[${i + 1}] (${c.source}) ${c.title}\n    ${clip(c.snippet, 280) || '(no context)'}`).join('\n');
}

/**
 * Check the Scout's reply. Keeps valid, unique picks up to `count`; reports the rest.
 * @param {unknown} json
 * @param {number} candidateCount
 * @param {number} count
 * @returns {{picks: {index: number, why: string, image: string|null}[], note: string|null, problems: string[]}}
 */
export function validatePicks(json, candidateCount, count) {
  const problems = [];
  const raw = Array.isArray(json?.picks) ? json.picks : null;
  if (!raw) return { picks: [], note: null, problems: ['reply has no "picks" array'] };
  const picks = [];
  const used = new Set();
  for (const [i, p] of raw.entries()) {
    const n = Number(p?.n);
    if (!Number.isInteger(n) || n < 1 || n > candidateCount) {
      problems.push(`pick ${i + 1}: n=${JSON.stringify(p?.n)} is not a listed candidate`);
      continue;
    }
    if (used.has(n)) {
      problems.push(`pick ${i + 1}: candidate ${n} picked twice`);
      continue;
    }
    if (typeof p.why !== 'string' || !p.why.trim()) {
      problems.push(`pick ${i + 1}: candidate ${n} has no "why"`);
      continue;
    }
    if (picks.length >= count) {
      problems.push(`pick ${i + 1}: more than the ${count} asked for, dropped`);
      continue;
    }
    used.add(n);
    picks.push({ index: n - 1, why: p.why.trim(), image: typeof p.image === 'string' && p.image.trim() ? p.image.trim() : null });
  }
  const note = typeof json.note === 'string' && json.note.trim() ? json.note.trim() : null;
  return { picks, note, problems };
}

/**
 * Run the scouts once.
 * @param {object} deps
 * @param {object} deps.config                  loaded config
 * @param {ReturnType<import('../floor.js').createFloor>} deps.floor
 * @param {{call: Function}} deps.llm
 * @param {typeof globalThis.fetch} [deps.fetch] for sources and snapshots
 * @param {object} [opts]
 * @param {number} [opts.count]                  subjects to post (default shift.subjectsPerShift)
 * @param {string[]} [opts.only]                 run only these sources
 * @param {boolean} [opts.snapshot]              fetch page snapshots (default true)
 */
export async function runScouts({ config, floor, llm, fetch = globalThis.fetch }, { count = config.shift.subjectsPerShift, only, snapshot = true } = {}) {
  const { candidates, report } = await gatherCandidates(config, { fetch, only });
  const history = await floor.read({ shift: 'all', type: 'subject.posted' });
  const { fresh, duplicates } = dedupe(candidates, subjectKeys(history));
  const shown = fresh.slice(0, MAX_CANDIDATES);
  const result = { report, candidates: candidates.length, duplicates: duplicates.length, shown: shown.length, posted: [], problems: [], note: null, callId: null };
  if (!shown.length) {
    result.problems.push('no fresh candidates: every source failed or everything was already on the floor');
    return result;
  }

  const recent = history.slice(-RECENT_SUBJECTS).map((e) => `- ${e.payload.title}`).join('\n') || '(none yet)';
  const res = await llm.call('scout', {
    vars: { today: shiftOf(), count: String(count), recent, candidates: formatCandidates(shown) },
    prompt: `Choose up to ${count} ready-mades from the candidates. Reply with JSON only.`,
  });
  result.callId = res.id;
  const { picks, note, problems } = validatePicks(res.json, shown.length, count);
  result.problems.push(...problems);
  result.note = note;

  for (const pick of picks) {
    const c = shown[pick.index];
    const page = snapshot && c.url ? await snapshotPage(c.url, { fetch }) : null;
    const event = await floor.append({
      type: 'subject.posted',
      actor: 'scout',
      ref: res.id, // the Scout call that chose it; its transcript holds the full candidate list
      payload: {
        origin: 'scouted',
        title: c.title,
        url: c.url,
        source: c.source,
        why: pick.why,
        image: pick.image,
        snapshot: { snippet: c.snippet, fetchedAt: c.fetchedAt, meta: c.meta, page },
      },
    });
    result.posted.push(event);
  }
  return result;
}
