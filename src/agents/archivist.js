// The Archivist (Billy Name, Pat Hackett): records everything. After each shift it checks
// that every event's artifacts (transcripts, sketches, screenshots, posters) are on disk,
// writes a manifest of the day, and has the diary written: Andy's morning call to Pat,
// typed up from the floor. It never deletes anything; the record is raw material.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

/** Payload keys that hold a path (relative to the repo root) to an artifact on disk. */
export const ARTIFACT_KEYS = Object.freeze(['transcript', 'path', 'png', 'contactSheet', 'sketch', 'poster', 'later', 'manifest']);

const exists = (p) => access(p).then(() => true, () => false);

/**
 * Check that every artifact the events point at exists.
 * @returns {Promise<{checked: number, missing: {eventId: string, type: string, key: string, path: string}[]}>}
 */
export async function checkArtifacts(config, events) {
  const missing = [];
  let checked = 0;
  for (const e of events) {
    for (const key of ARTIFACT_KEYS) {
      const p = e.payload?.[key];
      if (typeof p !== 'string' || !p || /^[a-z]+:\/\//i.test(p)) continue;
      checked++;
      if (!(await exists(join(config.root, p)))) missing.push({ eventId: e.id, type: e.type, key, path: p });
    }
  }
  return { checked, missing };
}

const count = (items, key) => items.reduce((m, x) => ((m[key(x)] = (m[key(x)] ?? 0) + 1), m), {});
const round = (n) => Math.round(n * 1e6) / 1e6;

/**
 * The day in numbers: events by type and actor, spend, series, decisions, editions, and the
 * artifact check. Written to archive/manifests/<shift>.json.
 */
export async function buildManifest(config, floor, shift) {
  const events = await floor.read({ shift });
  const costs = events.filter((e) => e.type === 'cost.recorded');
  const byId = new Map((await floor.read({ shift: 'all', type: 'subject.posted' })).map((e) => [e.id, e]));
  const series = events
    .filter((e) => e.type === 'series.started')
    .map((s) => {
      const mine = events.filter((e) => e.ref === s.id);
      return {
        seriesId: s.id,
        subject: byId.get(s.payload.subjectId)?.payload.title ?? s.payload.subjectTitle ?? null,
        dryRun: Boolean(s.payload.dryRun),
        chatterLines: s.payload.chatterLines ?? null,
        produced: mine.filter((e) => e.type === 'variant.produced').length,
        failed: mine.filter((e) => e.type === 'variant.failed').length,
        completed: mine.some((e) => e.type === 'series.completed'),
      };
    });
  const artifacts = await checkArtifacts(config, events);
  return {
    shift,
    generated: new Date().toISOString(),
    events: events.length,
    byType: count(events, (e) => e.type),
    byActor: count(events, (e) => e.actor),
    spend: { usd: round(costs.reduce((s, e) => s + (e.payload.usd ?? 0), 0)), calls: costs.length, byRole: Object.fromEntries(Object.entries(costs.reduce((m, e) => ((m[e.payload.role] = (m[e.payload.role] ?? 0) + (e.payload.usd ?? 0)), m), {})).map(([k, v]) => [k, round(v)])) },
    subjects: events.filter((e) => e.type === 'subject.posted').map((e) => ({ id: e.id, title: e.payload.title, origin: e.payload.origin, by: e.actor, dryRun: Boolean(e.payload.dryRun) })),
    series,
    decisions: count(events.filter((e) => e.type === 'review.decision'), (e) => e.payload.verdict),
    editions: events.filter((e) => e.type === 'edition.released').map((e) => ({ edition: e.payload.edition, title: e.payload.title, correction: Boolean(e.payload.correction) })),
    failures: events.filter((e) => e.type === 'llm.failed').length,
    artifacts,
  };
}

export async function writeManifest(config, manifest) {
  const dir = join(config.paths.archive, 'manifests');
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${manifest.shift}.json`);
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
  return relative(config.root, path);
}

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

/**
 * What happened on the floor, as plain notes for the diary: the events after the last diary
 * (so reviews done after yesterday's shift are in today's entry), dry runs left out.
 * @param {object[]} events   every event, oldest first
 * @param {{since?: string|null, maxChars?: number}} [opts]
 */
export function digest(events, { since = null, maxChars = 24_000 } = {}) {
  const subjects = new Map(events.filter((e) => e.type === 'subject.posted').map((e) => [e.id, e]));
  const seriesStarted = new Map(events.filter((e) => e.type === 'series.started').map((e) => [e.id, e]));
  const titleOf = (subjectId) => clip(subjects.get(subjectId)?.payload.title ?? '(unknown subject)', 90);
  const seriesTitle = (seriesId) => titleOf(seriesStarted.get(seriesId)?.payload.subjectId);
  const isDry = (e) => Boolean(e.payload?.dryRun) || Boolean(seriesStarted.get(e.ref)?.payload.dryRun) || Boolean(seriesStarted.get(e.payload?.seriesId)?.payload.dryRun);
  const recent = events.filter((e) => (!since || e.id > since) && !isDry(e));

  const out = [];
  const add = (line) => out.push(line);
  const costs = recent.filter((e) => e.type === 'cost.recorded');
  let lastShift = null;
  for (const e of recent) {
    const p = e.payload ?? {};
    if (e.shift !== lastShift) {
      add(`\n## ${e.shift}`);
      lastShift = e.shift;
    }
    const time = new Date(e.ts).toTimeString().slice(0, 5); // local time: the diary is the Factory's day, not UTC's
    switch (e.type) {
      case 'shift.started':
        add(`${time} the shift starts${p.again ? ' (another round)' : ''}.`);
        break;
      case 'subject.posted':
        add(`${time} ${p.origin === 'commission' ? 'the human commissions' : p.origin === 'superstar' ? `${p.proposedBy} pushes a subject onto the floor` : p.origin === 'archive' ? 'the Scout pulls something out of the archive' : 'the Scout brings in'}: "${clip(p.title, 120)}"${p.why ? ` (why: ${clip(p.why, 160)})` : ''}${p.sensitive?.flag ? ' [sensitive]' : ''}`);
        break;
      case 'subject.retired':
        add(`${time} the human retires "${titleOf(p.subjectId)}"${p.reason ? ` (${clip(p.reason, 100)})` : ''}.`);
        break;
      case 'chatter.posted':
        add(`${time} ${p.persona ?? e.actor} on "${titleOf(e.ref)}": ${clip(p.text, 240)}`);
        break;
      case 'series.started':
        add(`${time} the assistants start a series on "${titleOf(p.subjectId)}": ${p.variants} variants, techniques ${(p.techniques ?? []).join(', ')}.`);
        break;
      case 'series.completed': {
        const produced = recent.filter((x) => x.ref === e.ref && x.type === 'variant.produced').length;
        const failed = recent.filter((x) => x.ref === e.ref && x.type === 'variant.failed');
        const why = [...new Set(failed.map((f) => clip(f.payload.error ?? f.payload.stage, 80)))].slice(0, 3);
        add(`${time} series on "${seriesTitle(e.ref)}" done: ${produced} made, ${failed.length} died${why.length ? ` (${why.join('; ')})` : ''}.`);
        break;
      }
      case 'shortlist.proposed':
        add(`${time} Andy picks ${(p.picks ?? []).map((x) => `${x.variant} ("${clip(x.note, 140)}")`).join(', ') || 'nothing'} from "${seriesTitle(p.seriesId)}". The rest: ${clip(p.rejects, 200)}`);
        break;
      case 'review.decision':
        if (p.verdict === 'closed') add(`${time} the human closes the review of "${seriesTitle(p.seriesId)}".`);
        else add(`${time} the human ${p.verdict === 'approved' ? 'approves' : 'vetoes'} ${p.variant} of "${seriesTitle(p.seriesId)}"${p.note ? `: "${clip(p.note, 160)}"` : ''}.`);
        break;
      case 'work.published':
        add(`${time} the Printer signs ${p.variant} of "${clip(p.subjectTitle, 90)}"${p.printCheck?.verdict === 'concern' ? ` (print check: ${clip(p.printCheck.note, 140)})` : ''}.`);
        break;
      case 'edition.released':
        add(`${time} Fred Hughes ${p.correction ? `corrects the label of No. ${p.edition}: now` : `releases No. ${p.edition},`} "${clip(p.title, 90)}".`);
        break;
      case 'site.deployed':
        add(`${time} the gallery goes up (${p.works} works).`);
        break;
      case 'llm.failed':
        add(`${time} a call from ${p.role} fails (${clip(p.error, 100)}).`);
        break;
      case 'shift.ended':
        add(`${time} the shift ends${p.stoppedReason ? `, stopped early: ${clip(p.stoppedReason, 100)}` : ''}; ${p.waitingForReview ?? 0} series waiting for review.`);
        break;
      default:
        break;
    }
  }
  const spent = costs.reduce((s, e) => s + (e.payload.usd ?? 0), 0);
  add(`\nMoney: $${spent.toFixed(2)} on ${costs.length} model calls.`);
  let text = out.join('\n').trim();
  if (text.length > maxChars) text = `(the earliest notes are cut)\n…${text.slice(text.length - maxChars)}`;
  return { text, events: recent.length, usd: spent };
}

export class DiaryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DiaryError';
  }
}

/**
 * Write the diary entry for a shift from everything since the last entry.
 * @param {{config: object, floor: object, llm: {call: Function}}} deps
 * @param {{shift: string, force?: boolean}} opts
 * @returns {Promise<{event: object|null, path: string, skipped?: string}>}
 */
export async function writeDiary({ config, floor, llm }, { shift, force = false }) {
  const dir = join(config.paths.archive, 'diary');
  const path = join(dir, `${shift}.md`);
  const rel = relative(config.root, path);
  if (!force && (await exists(path))) return { event: null, path: rel, skipped: 'already written' };

  const all = await floor.read({ shift: 'all' });
  const last = all.filter((e) => e.type === 'diary.written' && e.payload.shift !== shift).at(-1);
  const d = digest(all, { since: last?.id ?? null });
  if (!d.events) return { event: null, path: rel, skipped: 'nothing happened since the last entry' };

  const res = await llm.call('archivist', {
    vars: { date: longDate(shift), notes: d.text },
    prompt: 'Type up the diary entry for this day. Markdown, no preamble.',
  });
  const body = String(res.content ?? '').trim();
  if (!body) throw new DiaryError('the Archivist returned an empty entry');
  await mkdir(dir, { recursive: true });
  await writeFile(path, `${body}\n`);
  const event = await floor.append({
    type: 'diary.written',
    actor: 'archivist',
    ref: res.id,
    payload: { shift, path: rel, words: body.split(/\s+/).length, covers: d.events, since: last?.id ?? null, callId: res.id },
  });
  return { event, path: rel };
}

export function longDate(shift) {
  const d = new Date(`${shift}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/**
 * The Archivist's end-of-shift round: manifest, then diary (not for dry runs).
 * A failed diary is a problem in the result, never a failed shift.
 */
export async function archiveShift({ config, floor, llm }, { shift, dryRun = false, diary = true }) {
  const result = { manifest: null, missing: 0, diary: null, problems: [] };
  const manifest = await buildManifest(config, floor, shift);
  result.manifest = await writeManifest(config, manifest);
  result.missing = manifest.artifacts.missing.length;
  if (result.missing) result.problems.push(`${result.missing} artifact(s) missing, e.g. ${manifest.artifacts.missing[0].path}`);
  if (dryRun || !diary) result.diary = { skipped: dryRun ? 'dry run' : 'diary off' };
  else {
    try {
      const d = await writeDiary({ config, floor, llm }, { shift });
      result.diary = d.event ? { path: d.path, words: d.event.payload.words } : { skipped: d.skipped, path: d.path };
    } catch (err) {
      if (err.name === 'BudgetExhausted') throw err;
      result.problems.push(`diary: ${err.message}`);
    }
  }
  await floor.append({
    type: 'shift.archived',
    actor: 'archivist',
    payload: { shift, manifest: result.manifest, events: manifest.events, artifactsChecked: manifest.artifacts.checked, missing: manifest.artifacts.missing.slice(0, 20), diary: result.diary, dryRun },
  });
  return result;
}

/** A diary entry, for `silver diary`. */
export async function readDiary(config, shift) {
  return readFile(join(config.paths.archive, 'diary', `${shift}.md`), 'utf8');
}
