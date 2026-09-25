// `silver subjects`: the subjects on the floor, with short ids for `silver series`.
import { createFactory } from '../factory.js';
import { matchSubject } from '../agents/assistants.js';
import { retiredSubjects, retireSubject } from '../agents/retire.js';

/** Last 8 characters of a ULID: unique enough to type, and accepted by `silver series`. */
export const shortId = (id) => id.slice(-8);

export default async function subjectsCommand(_args, opts, ctx) {
  const { floor } = await createFactory();
  if (opts.retire) {
    const subjects = await floor.read({ shift: 'all', type: 'subject.posted' });
    const subject = matchSubject(subjects, opts.retire);
    const event = await retireSubject(floor, subject, opts.reason);
    ctx.stdout.write(`retired ${shortId(subject.id)}: ${subject.payload.title}${event.payload.reason ? ` (${event.payload.reason})` : ''}\n`);
    return;
  }
  const retired = await retiredSubjects(floor);
  const events = await floor.read({ shift: opts.shift ?? 'all', type: ['subject.posted', 'series.started'] });
  const all = await floor.read({ shift: 'all', type: 'series.started' });
  const seriesCount = new Map();
  for (const e of all) seriesCount.set(e.payload.subjectId, (seriesCount.get(e.payload.subjectId) ?? 0) + 1);

  let subjects = events.filter((e) => e.type === 'subject.posted');
  if (opts.open) subjects = subjects.filter((s) => !seriesCount.has(s.id) && !retired.has(s.id));
  if (opts.json) {
    ctx.stdout.write(JSON.stringify(subjects.map((s) => ({ id: s.id, short: shortId(s.id), shift: s.shift, series: seriesCount.get(s.id) ?? 0, retired: retired.has(s.id), ...s.payload })), null, 2) + '\n');
    return;
  }
  if (!subjects.length) {
    ctx.stderr.write('no subjects yet (try: silver scout, or silver commission "...")\n');
    return;
  }
  for (const s of subjects) {
    const p = s.payload;
    const series = seriesCount.get(s.id) ?? 0;
    const flags = `${p.origin === 'commission' ? 'C' : ' '}${p.sensitive?.flag ? '!' : ' '}${retired.has(s.id) ? 'R' : ' '}`;
    ctx.stdout.write(`${shortId(s.id)}  ${s.shift}  ${flags}  ${series ? `${series}x` : '--'}  ${p.title}\n`);
  }
  ctx.stderr.write('\nC = commission, ! = sensitive, R = retired, Nx = series made. Use: silver series <id>\n');
}
