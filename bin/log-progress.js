#!/usr/bin/env node
// Append an entry to process-log.jsonl, or list entries.
//
//   bin/log-progress.js --phase 0 --task "scaffold" --summary "..." [--status done] [--files a,b]
//   bin/log-progress.js --list [--phase 0]
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { logProgress, readProgress } from '../src/lib/process-log.js';

const LOG_PATH = resolve(fileURLToPath(import.meta.url), '../../process-log.jsonl');

const { values } = parseArgs({
  options: {
    phase: { type: 'string' },
    task: { type: 'string' },
    status: { type: 'string', default: 'done' },
    summary: { type: 'string', default: '' },
    files: { type: 'string', default: '' },
    list: { type: 'boolean', default: false },
  },
});

try {
  if (values.list) {
    const entries = await readProgress(LOG_PATH, { phase: values.phase });
    for (const e of entries) {
      console.log(`${e.ts}  [phase ${e.phase}] ${e.status.padEnd(7)} ${e.task}`);
    }
  } else {
    const files = values.files ? values.files.split(',').map((f) => f.trim()).filter(Boolean) : [];
    const entry = await logProgress(LOG_PATH, { ...values, files });
    console.log(JSON.stringify(entry));
  }
} catch (err) {
  console.error(`log-progress: ${err.message}`);
  process.exit(1);
}
