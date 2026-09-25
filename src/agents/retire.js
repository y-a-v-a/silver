// Retiring subjects: a subject.retired event takes a subject off the table without touching
// the append-only floor. Retired subjects are skipped by `series latest`, `subjects --open`,
// pending commissions and the shift (decision 2026-09-25).

export class RetireError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RetireError';
  }
}

/**
 * Subject ids claimed by a real series. A dry-run series is a test print: it never claims
 * its subject, so the subject can still get a real series.
 * @param {import('../floor.js').FloorEvent[]} events  series.started events (others are ignored)
 */
export function claimedSubjects(events) {
  return new Set(events.filter((e) => e.type === 'series.started' && !e.payload?.dryRun).map((e) => e.payload.subjectId));
}

/** Map of retired subject id -> the retiring event. */
export async function retiredSubjects(floor) {
  const events = await floor.read({ shift: 'all', type: 'subject.retired' });
  return new Map(events.map((e) => [e.payload.subjectId, e]));
}

/**
 * Retire a subject. Retiring twice is refused, so the reason on record stays the first one.
 * @param {ReturnType<import('../floor.js').createFloor>} floor
 * @param {import('../floor.js').FloorEvent} subject  a subject.posted event
 * @param {string} [reason]
 */
export async function retireSubject(floor, subject, reason) {
  if (subject?.type !== 'subject.posted') throw new RetireError('only subjects can be retired');
  const already = (await retiredSubjects(floor)).get(subject.id);
  if (already) throw new RetireError(`"${subject.payload.title}" was already retired on ${already.shift}`);
  return floor.append({
    type: 'subject.retired',
    actor: 'human',
    ref: subject.id,
    payload: { subjectId: subject.id, title: subject.payload.title, reason: reason?.trim() || null },
  });
}
