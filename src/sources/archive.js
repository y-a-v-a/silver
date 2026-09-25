// The archive as a source (ARCHITECTURE principle 3, Phase 7): the Factory's own record is
// raw material. Two kinds of candidates: rejects from earlier series (vetoed by the human,
// or passed over by Warhol) and lines from the Archivist's diary. Each is offered to the
// Scout until it is used once; the Scout may post at most shift.maxArchiveSubjectsPerShift.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listSeries } from '../agents/series-data.js';

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

function sample(items, n, rng) {
  const pool = [...items];
  const out = [];
  while (pool.length && out.length < n) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

/** Diary sentences worth a second look: quotable, not the heading, not the money line. */
export function diaryLines(text) {
  return String(text)
    .replace(/^#.*$/gm, '')
    .split(/(?<=[.!?])\s+(?=[A-Z"“])/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 40 && s.length <= 220 && !/\$\d/.test(s));
}

/**
 * @param {object} deps
 * @param {object} deps.config
 * @param {ReturnType<import('../floor.js').createFloor>} deps.floor
 * @param {{now?: Date, rng?: () => number, rejects?: number, lines?: number, diaryDays?: number}} [opts]
 * @returns {Promise<import('./candidate.js').Candidate[]>}
 */
export async function archiveCandidates({ config, floor }, { now = new Date(), rng = Math.random, rejects = 3, lines = 2, diaryDays = 14 } = {}) {
  const today = floor.today();
  const used = await floor.read({ shift: 'all', type: 'subject.posted' });
  const usedRejects = new Set(used.filter((e) => e.payload.archive?.kind === 'reject').map((e) => `${e.payload.archive.seriesId}/${e.payload.archive.variant}`));
  const usedLines = new Set(used.filter((e) => e.payload.archive?.kind === 'diary').map((e) => e.payload.archive.line));
  const fetchedAt = now.toISOString();

  // The reject pile.
  const pile = [];
  for (const s of await listSeries(floor)) {
    if (s.started.payload.dryRun || s.started.shift >= today) continue;
    const picked = new Set((s.shortlist?.payload.picks ?? []).map((p) => p.variant));
    for (const v of s.variants) {
      if (!v.ok || !v.png || usedRejects.has(`${s.seriesId}/${v.variant}`)) continue;
      const decision = s.decisions.get(v.variant);
      const vetoed = decision?.payload.verdict === 'vetoed';
      const passedOver = s.shortlist && !picked.has(v.variant) && decision?.payload.verdict !== 'approved';
      if (!vetoed && !passedOver) continue;
      const title = s.subject?.payload.title ?? s.started.payload.subjectTitle ?? 'untitled';
      pile.push({
        source: 'archive',
        title: `The reject pile: "${clip(title, 90)}", ${v.variant} (${v.technique})`,
        url: s.subject?.payload.url ?? null,
        snippet: [
          vetoed ? `Vetoed by the human${decision.payload.note ? `: "${clip(decision.payload.note, 120)}"` : ''}.` : 'Passed over by Warhol.',
          s.shortlist?.payload.rejects && `Warhol on the rejects: "${clip(s.shortlist.payload.rejects, 160)}"`,
          `From a series made ${s.started.shift}.`,
        ]
          .filter(Boolean)
          .join(' '),
        fetchedAt,
        meta: { kind: 'reject', seriesId: s.seriesId, variant: v.variant, technique: v.technique, png: v.png, subjectId: s.subjectId, verdict: vetoed ? 'vetoed' : 'passed-over' },
      });
    }
  }

  // The diary.
  const said = [];
  const dir = join(config.paths.archive, 'diary');
  const since = new Date(now.getTime() - diaryDays * 86_400_000).toISOString().slice(0, 10);
  const files = (await readdir(dir).catch(() => [])).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f) && f.slice(0, 10) < today && f.slice(0, 10) >= since);
  for (const f of files) {
    const date = f.slice(0, 10);
    for (const line of diaryLines(await readFile(join(dir, f), 'utf8'))) {
      if (usedLines.has(line)) continue;
      said.push({ source: 'archive', title: `From the diary, ${date}: "${clip(line, 160)}"`, url: null, snippet: `A line from the Factory's own diary for ${date}.`, fetchedAt, meta: { kind: 'diary', date, line } });
    }
  }
  return [...sample(pile, rejects, rng), ...sample(said, lines, rng)];
}
