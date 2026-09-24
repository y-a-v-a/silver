// The floor: a shared, noisy, append-only event bus (ARCHITECTURE.md, principle 1).
// One JSONL file per shift: floor/YYYY-MM-DD.jsonl. There is no update or delete.
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { monotonicFactory } from 'ulid';
import { appendLine, readLines } from './lib/jsonl.js';
import { validateEvent, typeMatches, EventError } from './events.js';

/** Local calendar date as YYYY-MM-DD: the shift an instant belongs to. */
export function shiftOf(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * @typedef {object} FloorEvent
 * @property {string} id      ULID, sortable by time
 * @property {string} ts      ISO timestamp
 * @property {string} shift   YYYY-MM-DD
 * @property {string} type    one of EVENT_TYPES
 * @property {string} actor   e.g. "scout", "superstar.brigid", "human"
 * @property {string|null} ref id of the event this one responds to
 * @property {object} payload
 */

/**
 * @param {{dir: string, now?: () => Date}} opts
 */
export function createFloor({ dir, now = () => new Date() }) {
  const nextId = monotonicFactory();
  const pathFor = (shift) => join(dir, `${shift}.jsonl`);
  // Serialise appends within this process so lines land in id order.
  let queue = Promise.resolve();

  /**
   * Append an event. Fills id, ts and shift; `id` may be supplied (e.g. to match a transcript).
   * @param {{type: string, actor: string, payload?: object, ref?: string|null, id?: string}} input
   * @returns {Promise<FloorEvent>}
   */
  function append({ type, actor, payload = {}, ref = null, id }) {
    const at = now();
    const event = { id: id ?? nextId(at.getTime()), ts: at.toISOString(), shift: shiftOf(at), type, actor, ref, payload };
    const errors = validateEvent(event);
    if (errors.length) return Promise.reject(new EventError(errors));
    const write = queue.then(() => appendLine(pathFor(event.shift), event));
    queue = write.catch(() => {});
    return write.then(() => event);
  }

  /** Every shift that has a floor file, oldest first. */
  async function shifts() {
    let names;
    try {
      names = await readdir(dir);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    return names.filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).map((n) => n.slice(0, 10)).sort();
  }

  /**
   * Read events, filtered.
   * @param {{shift?: string, type?: string|string[], actor?: string, since?: string, ref?: string}} [q]
   *   shift: a date, or 'all' for every shift. Default: today.
   *   type: exact type, 'prefix.*' or an array of either.
   *   since: only events with an id greater than this one.
   * @returns {Promise<FloorEvent[]>}
   */
  async function read({ shift = shiftOf(now()), type, actor, since, ref } = {}) {
    const days = shift === 'all' ? await shifts() : [shift];
    const patterns = type === undefined ? null : [].concat(type);
    const out = [];
    for (const day of days) {
      for (const e of await readLines(pathFor(day))) {
        if (patterns && !patterns.some((p) => typeMatches(p, e.type))) continue;
        if (actor !== undefined && e.actor !== actor) continue;
        if (since !== undefined && !(e.id > since)) continue;
        if (ref !== undefined && e.ref !== ref) continue;
        out.push(e);
      }
    }
    return out;
  }

  /**
   * Follow one shift's file: yields existing events (unless `fromEnd`), then new ones as they
   * are appended. Polls, because fs.watch is unreliable across platforms. Stops on `signal`.
   * @param {{shift?: string, type?: string|string[], fromEnd?: boolean, pollMs?: number, signal?: AbortSignal}} [opts]
   */
  async function* tail({ shift = shiftOf(now()), type, fromEnd = false, pollMs = 250, signal } = {}) {
    const path = pathFor(shift);
    const patterns = type === undefined ? null : [].concat(type);
    let offset = 0;
    let partial = '';
    if (fromEnd) {
      try {
        offset = (await stat(path)).size;
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
    while (!signal?.aborted) {
      const chunk = await readFrom(path, offset);
      if (chunk.length) {
        offset += chunk.length;
        const lines = (partial + chunk.toString('utf8')).split('\n');
        partial = lines.pop(); // incomplete last line waits for the next poll
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          if (!patterns || patterns.some((p) => typeMatches(p, e.type))) yield e;
        }
        continue;
      }
      try {
        await sleep(pollMs, undefined, { signal });
      } catch (err) {
        if (err.name === 'AbortError') return;
        throw err;
      }
    }
  }

  return { dir, append, read, tail, shifts, pathFor, today: () => shiftOf(now()) };
}

async function readFrom(path, offset) {
  let fh;
  try {
    fh = await open(path, 'r');
  } catch (err) {
    if (err.code === 'ENOENT') return Buffer.alloc(0);
    throw err;
  }
  try {
    const { size } = await fh.stat();
    if (size <= offset) return Buffer.alloc(0);
    const buf = Buffer.alloc(size - offset);
    await fh.read(buf, 0, buf.length, offset);
    return buf;
  } finally {
    await fh.close();
  }
}
