// The build's own diary: one JSONL line per finished task in process-log.jsonl.
// Not to be confused with the floor, which is the factory's runtime event log.
import { appendLine, readLines } from './jsonl.js';

export const STATUSES = Object.freeze(['done', 'started', 'blocked', 'note']);

/**
 * Validate and normalise a process-log entry.
 * @param {{phase: number|string, task: string, status?: string, summary?: string, files?: string[], ts?: string}} input
 */
export function makeEntry(input) {
  const { phase, task, status = 'done', summary = '', files = [], ts } = input ?? {};
  if (phase === undefined || phase === null || phase === '') {
    throw new Error('entry.phase is required');
  }
  if (typeof task !== 'string' || task.trim() === '') {
    throw new Error('entry.task is required');
  }
  if (!STATUSES.includes(status)) {
    throw new Error(`entry.status must be one of ${STATUSES.join(', ')}`);
  }
  if (!Array.isArray(files) || !files.every((f) => typeof f === 'string')) {
    throw new Error('entry.files must be an array of strings');
  }
  return {
    ts: ts ?? new Date().toISOString(),
    phase: String(phase),
    task: task.trim(),
    status,
    summary: summary.trim(),
    files,
  };
}

/** Append a validated entry and return it. */
export async function logProgress(path, input) {
  const entry = makeEntry(input);
  await appendLine(path, entry);
  return entry;
}

/** Read every entry, optionally filtered by phase. */
export async function readProgress(path, { phase } = {}) {
  const entries = await readLines(path);
  return phase === undefined ? entries : entries.filter((e) => e.phase === String(phase));
}
