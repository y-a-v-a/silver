import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureTaste, appendTaste, readTaste, tasteForPrompt, formatTasteEntry, DECISIONS_MARKER } from '../src/lib/taste.js';

const tmp = async () => join(await mkdtemp(join(tmpdir(), 'silver-taste-')), 'taste.md');

test('ensureTaste creates the file once, with an editable header and the decisions marker', async () => {
  const path = await tmp();
  assert.equal(await ensureTaste(path), true);
  assert.equal(await ensureTaste(path), false);
  const text = await readFile(path, 'utf8');
  assert.match(text, /^# Taste/);
  assert.ok(text.includes(DECISIONS_MARKER));
});

test('formatTasteEntry makes one line, with whitespace in notes collapsed', () => {
  assert.equal(
    formatTasteEntry({ date: '2026-09-25', verdict: 'approved', variant: 'v03', technique: 'halftone', subject: 'Soup', pickedByWarhol: true, note: 'flat\n and loud ' }),
    '- 2026-09-25 · approved · v03 (halftone) · "Soup" · Warhol\'s pick: flat and loud',
  );
  assert.equal(formatTasteEntry({ date: 'd', verdict: 'vetoed', variant: 'v01', subject: 's' }), '- d · vetoed · v01 · "s"');
});

test('appendTaste keeps the human header and appends decisions below the marker', async () => {
  const path = await tmp();
  await writeFile(path, '# Taste\n\n- Likes: soup cans\n- Dislikes: swirls\n');
  await appendTaste(path, { date: 'd1', verdict: 'approved', variant: 'v01', subject: 'A' });
  await appendTaste(path, { date: 'd2', verdict: 'vetoed', variant: 'v02', subject: 'B', note: 'too pretty' });
  const { header, entries } = await readTaste(path);
  assert.equal(header, '# Taste\n\n- Likes: soup cans\n- Dislikes: swirls');
  assert.deepEqual(entries, ['- d1 · approved · v01 · "A"', '- d2 · vetoed · v02 · "B": too pretty']);
});

test('tasteForPrompt gives the header and the last n decisions; a missing file is fine', async () => {
  const path = await tmp();
  assert.match(await tasteForPrompt(path), /has not written anything[\s\S]*No decisions yet/);
  await ensureTaste(path);
  for (let i = 1; i <= 5; i++) await appendTaste(path, { date: `d${i}`, verdict: 'approved', variant: `v0${i}`, subject: 'S' });
  const text = await tasteForPrompt(path, 2);
  assert.match(text, /^# Taste/);
  assert.doesNotMatch(text, /d3/);
  assert.match(text, /Latest decisions \(newest last\):\n- d4[^\n]*\n- d5/);
});
