// The floor's event vocabulary (ACTIONS.md → Floor events) and envelope validation.

export const EVENT_TYPES = Object.freeze([
  'shift.started',
  'shift.ended',
  'subject.posted',
  'subject.retired',
  'chatter.posted',
  'tool.released',
  'series.started',
  'variant.produced',
  'variant.failed',
  'series.completed',
  'shortlist.proposed',
  'review.decision',
  'work.published',
  'edition.released',
  'site.deployed',
  'cost.recorded',
  'llm.failed',
  'diary.written',
]);

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const SHIFT = /^\d{4}-\d{2}-\d{2}$/;
const ACTOR = /^[a-z0-9]+([-.][a-z0-9]+)*$/;

/** True if `pattern` matches `type`: exact, `prefix.*`, or `*`. */
export function typeMatches(pattern, type) {
  if (pattern === '*') return true;
  if (pattern.endsWith('.*')) return type.startsWith(pattern.slice(0, -1));
  return pattern === type;
}

/**
 * Validate a complete envelope. Returns a list of problems (empty when valid).
 * @param {unknown} e
 */
export function validateEvent(e) {
  const errors = [];
  if (e === null || typeof e !== 'object' || Array.isArray(e)) return ['event must be an object'];
  const allowed = ['id', 'ts', 'shift', 'type', 'actor', 'ref', 'payload'];
  for (const key of Object.keys(e)) if (!allowed.includes(key)) errors.push(`unknown envelope field "${key}"`);
  if (!ULID.test(e.id ?? '')) errors.push('id must be a ULID');
  if (typeof e.ts !== 'string' || Number.isNaN(Date.parse(e.ts))) errors.push('ts must be an ISO timestamp');
  if (!SHIFT.test(e.shift ?? '')) errors.push('shift must be YYYY-MM-DD');
  if (!EVENT_TYPES.includes(e.type)) errors.push(`unknown event type ${JSON.stringify(e.type)}`);
  if (!ACTOR.test(e.actor ?? '')) errors.push('actor must be a lowercase id like "scout" or "superstar.brigid"');
  if (e.ref !== null && !ULID.test(e.ref ?? '')) errors.push('ref must be null or a ULID');
  if (e.payload === null || typeof e.payload !== 'object' || Array.isArray(e.payload)) errors.push('payload must be an object');
  return errors;
}

export class EventError extends Error {
  constructor(errors) {
    super(`invalid event: ${errors.join('; ')}`);
    this.name = 'EventError';
    this.errors = errors;
  }
}
