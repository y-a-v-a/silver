// taste.md: what the human likes, in their own words (the header), followed by an
// append-only log of every review decision. Warhol reads both before each shortlist.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const DECISIONS_MARKER = '## Decisions';

export const DEFAULT_HEADER = `# Taste

Write here, in your own words, what you like and what you don't. Warhol reads this page
before every shortlist, together with your latest decisions below. Edit this part freely.

- Likes: (for example: flat colour, hard repetition, brand type, deadpan)
- Dislikes: (for example: gradients, "generative art" swirls, cute)
`;

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Create taste.md with the default header if it doesn't exist yet. Returns true if created. */
export async function ensureTaste(path) {
  try {
    await readFile(path);
    return false;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${DEFAULT_HEADER}\n${DECISIONS_MARKER}\n\n`, { flag: 'wx' }).catch((err) => {
    if (err.code !== 'EEXIST') throw err;
  });
  return true;
}

/**
 * One decision as a single markdown line.
 * @param {{date: string, verdict: string, variant: string, technique?: string, subject: string, pickedByWarhol?: boolean, note?: string}} d
 */
export function formatTasteEntry(d) {
  const parts = [d.date, d.verdict, `${d.variant}${d.technique ? ` (${d.technique})` : ''}`, `"${clean(d.subject)}"`];
  if (d.pickedByWarhol !== undefined) parts.push(d.pickedByWarhol ? "Warhol's pick" : 'not picked by Warhol');
  const note = clean(d.note);
  return `- ${parts.join(' · ')}${note ? `: ${note}` : ''}`;
}

/** Append a decision (creating the file first if needed). */
export async function appendTaste(path, decision) {
  await ensureTaste(path);
  const text = await readFile(path, 'utf8');
  const prefix = text.includes(DECISIONS_MARKER) ? (text.endsWith('\n') ? '' : '\n') : `\n${DECISIONS_MARKER}\n\n`;
  await appendFile(path, `${prefix}${formatTasteEntry(decision)}\n`);
}

/**
 * Read taste.md: the header (the human's own words) and the decision lines.
 * A missing file reads as empty.
 */
export async function readTaste(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { header: '', entries: [] };
    throw err;
  }
  const at = text.indexOf(DECISIONS_MARKER);
  const header = (at === -1 ? text : text.slice(0, at)).trim();
  const entries = at === -1 ? [] : text.slice(at + DECISIONS_MARKER.length).split('\n').filter((l) => l.startsWith('- '));
  return { header, entries };
}

/** The text Warhol gets: the header plus the last `n` decisions. */
export async function tasteForPrompt(path, n = 40) {
  const { header, entries } = await readTaste(path);
  const recent = n > 0 ? entries.slice(-n) : [];
  const parts = [];
  parts.push(header || '(The human has not written anything about their taste yet.)');
  parts.push(recent.length ? `Latest decisions (newest last):\n${recent.join('\n')}` : 'No decisions yet.');
  return parts.join('\n\n');
}
