// direction.md: what the human is after right now, in their own words, one section per
// audience. Taste is what they liked; direction is what they want next. Each process reads it
// when it needs it, so an edit reaches the very next call with no restart. Local, like
// taste.md, and backed up with the record.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from './atomic.js';

export const DIRECTION_FILE = 'direction.md';
export const AUDIENCES = Object.freeze(['scouts', 'superstars', 'studio', 'warhol']);

export const directionPath = (root) => join(root, DIRECTION_FILE);

const PREAMBLE = `# Direction

What the human is after right now, one section per audience. Leave a section empty for no
steer. Every call reads this page, so a change counts from the next call on.`;

/** What the prompts say when the human has nothing to add. */
export const NO_DIRECTION = '(nothing from the human today)';

/** @param {string} text */
export function parseDirection(text) {
  const out = Object.fromEntries(AUDIENCES.map((a) => [a, '']));
  const parts = String(text ?? '').split(/^##[ \t]+(.+?)[ \t]*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const key = parts[i].trim().toLowerCase();
    if (AUDIENCES.includes(key)) out[key] = parts[i + 1].trim();
  }
  return out;
}

export function formatDirection(direction) {
  const sections = AUDIENCES.map((a) => `## ${a.charAt(0).toUpperCase()}${a.slice(1)}\n\n${String(direction[a] ?? '').trim()}`.trim());
  return `${PREAMBLE}\n\n${sections.join('\n\n')}\n`;
}

/** A missing file reads as no direction at all. */
export async function readDirection(root) {
  try {
    return parseDirection(await readFile(directionPath(root), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return parseDirection('');
    throw err;
  }
}

export async function writeDirection(root, direction) {
  await writeFileAtomic(directionPath(root), formatDirection(direction));
}

/** The direction for one audience as prompt text, with anything extra (a note for one series) after it. */
export function directionFor(direction, audience, extra = null) {
  return [direction?.[audience], extra].map((s) => String(s ?? '').trim()).filter(Boolean).join('\n\n') || NO_DIRECTION;
}
