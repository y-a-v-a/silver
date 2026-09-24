// Append-only JSONL helpers. Shared by the process log now and the floor later.
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Append one JSON object as a single line. Never rewrites existing lines.
 * @param {string} path
 * @param {object} record
 */
export async function appendLine(path, record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('appendLine expects a plain object');
  }
  const line = JSON.stringify(record);
  if (line.includes('\n')) {
    // JSON.stringify escapes newlines in strings, so this should be unreachable.
    throw new Error('serialised record contains a raw newline');
  }
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, line + '\n', 'utf8');
}

/**
 * Read every record from a JSONL file. A missing file is an empty log.
 * Blank lines are skipped; a malformed line throws with its line number.
 * @param {string} path
 * @returns {Promise<object[]>}
 */
export async function readLines(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const records = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    try {
      records.push(JSON.parse(lines[i]));
    } catch (err) {
      throw new Error(`${path}:${i + 1}: invalid JSON (${err.message})`);
    }
  }
  return records;
}
