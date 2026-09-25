// The Scouts: pull ready-made subjects from mass media and post them as subject cards.
// Gather -> dedupe against the floor -> the Scout picks -> snapshot -> subject.posted.
import { gatherCandidates } from '../sources/index.js';
import { archiveCandidates } from '../sources/archive.js';
import { dedupe, subjectKeys } from '../lib/dedupe.js';
import { snapshotPage } from '../lib/snapshot.js';
import { clip } from '../sources/http.js';
import { shiftOf } from '../floor.js';

/** How many candidates the Scout sees at most (keeps the prompt bounded). */
export const MAX_CANDIDATES = 160;
/** How many recent subject titles the Scout is reminded of. */
export const RECENT_SUBJECTS = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Subjects posted within the last `days` days of `now`: the Scout's memory for repeats. */
export function withinWindow(events, days, now = new Date()) {
  const since = now.getTime() - days * DAY_MS;
  return events.filter((e) => Date.parse(e.ts) >= since);
}

/** The numbered candidate list shown to the Scout (1-based). */
export function formatCandidates(candidates) {
  return candidates.map((c, i) => `[${i + 1}] (${c.source}) ${c.title}\n    ${clip(c.snippet, 280) || '(no context)'}`).join('\n');
}

/**
 * The Scout's sensitivity flag, normalised to {flag, reason}. Anything malformed that is
 * not clearly `false` counts as flagged: a spurious warning costs less than a missing one.
 * @returns {{flag: boolean, reason: string|null}}
 */
export function normalizeSensitive(value) {
  if (value === undefined || value === null || value === false) return { flag: false, reason: null };
  if (value === true) return { flag: true, reason: null };
  if (typeof value === 'object') {
    const reason = typeof value.reason === 'string' && value.reason.trim() ? value.reason.trim() : null;
    return { flag: value.flag !== false, reason };
  }
  return { flag: true, reason: typeof value === 'string' && value.trim() ? value.trim() : null };
}

/**
 * Check the Scout's reply. Keeps valid, unique picks up to `count`; reports the rest.
 * @param {unknown} json
 * @param {number} candidateCount
 * @param {number} count
 * @returns {{picks: {index: number, why: string, image: string|null, sensitive: {flag: boolean, reason: string|null}}[], note: string|null, problems: string[]}}
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
    picks.push({
      index: n - 1,
      why: p.why.trim(),
      image: typeof p.image === 'string' && p.image.trim() ? p.image.trim() : null,
      sensitive: normalizeSensitive(p.sensitive),
    });
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
 * @param {Date} [opts.now]                      for the repeat window (default: now)
 * @param {boolean} [opts.dryRun]                picked by the cheap model: marked, and ignored by real shifts
 */
export async function runScouts({ config, floor, llm, fetch = globalThis.fetch }, { count = config.shift.subjectsPerShift, only, snapshot = true, now = new Date(), dryRun = false, rng = Math.random } = {}) {
  const archiveOnly = only?.length === 1 && only[0] === 'archive';
  const { candidates, report } = archiveOnly ? { candidates: [], report: [] } : await gatherCandidates(config, { fetch, only });
  // The Factory's own record as a source (Phase 7): rejects and diary lines, offered once each.
  const archiveMax = config.shift.maxArchiveSubjectsPerShift;
  const archive = archiveMax > 0 && (!only?.length || only.includes('archive')) ? await archiveCandidates({ config, floor }, { now, rng }) : [];
  if (archiveMax > 0) report.push({ source: 'archive', ok: true, count: archive.length });
  // Only subjects inside the repeat window count: older ones may come back. A real Scout
  // ignores what a dry run posted, so a test run never takes a headline away from it.
  const posted = (await floor.read({ shift: 'all', type: 'subject.posted' })).filter((e) => dryRun || !e.payload.dryRun);
  const history = withinWindow(posted, config.sources.repeatAfterDays, now);
  const { fresh, duplicates } = dedupe(candidates, subjectKeys(history));
  const shown = [...fresh.slice(0, MAX_CANDIDATES - archive.length), ...archive];
  const result = { report, candidates: candidates.length, duplicates: duplicates.length, shown: shown.length, posted: [], problems: [], note: null, callId: null, leftovers: [] };
  if (!shown.length) {
    result.problems.push('no fresh candidates: every source failed or everything was already on the floor');
    return result;
  }

  const recent = history.slice(-RECENT_SUBJECTS).map((e) => `- ${e.payload.title}`).join('\n') || '(none yet)';
  const res = await llm.call('scout', {
    vars: { today: shiftOf(), count: String(count), recent, candidates: formatCandidates(shown), archive_max: String(archiveMax) },
    prompt: `Choose up to ${count} ready-mades from the candidates. Reply with JSON only.`,
  });
  result.callId = res.id;
  const valid = validatePicks(res.json, shown.length, count);
  const { note, problems } = valid;
  result.problems.push(...problems);
  // At most archiveMax subjects from the archive; the rest of the Scout's archive picks are dropped.
  let fromArchive = 0;
  const picks = valid.picks.filter((p) => {
    if (shown[p.index].source !== 'archive') return true;
    if (++fromArchive <= archiveMax) return true;
    result.problems.push(`candidate ${p.index + 1}: more than ${archiveMax} from the archive, dropped`);
    return false;
  });
  result.note = note;
  // What the Scout passed over: the pile a superstar may rummage through (Phase 6).
  const picked = new Set(picks.map((p) => p.index));
  result.leftovers = shown.filter((_, i) => !picked.has(i));

  for (const pick of picks) {
    const c = shown[pick.index];
    const page = snapshot && c.url && c.source !== 'archive' ? await snapshotPage(c.url, { fetch }) : null;
    const event = await floor.append({
      type: 'subject.posted',
      actor: 'scout',
      ref: res.id, // the Scout call that chose it; its transcript holds the full candidate list
      payload: {
        origin: c.source === 'archive' ? 'archive' : 'scouted',
        ...(c.source === 'archive' ? { archive: c.meta } : {}),
        title: c.title,
        url: c.url,
        source: c.source,
        why: pick.why,
        image: pick.image,
        sensitive: pick.sensitive,
        snapshot: { snippet: c.snippet, fetchedAt: c.fetchedAt, meta: c.meta, page },
        ...(dryRun ? { dryRun: true } : {}),
      },
    });
    result.posted.push(event);
  }
  return result;
}
