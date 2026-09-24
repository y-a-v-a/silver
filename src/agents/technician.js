// The Technician: in v1 the tools are hand-built, and the Technician only announces them.
// `silver release <tool>` asks for a release note and posts it as tool.released.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const exec = promisify(execFile);

/** The tools on the Technician's workbench, relative to the repository root. */
export const TOOLS = Object.freeze({
  'p5-template': 'src/tools/p5-template.html',
  renderer: 'src/tools/render.js',
  'contact-sheet': 'src/tools/contact-sheet.js',
});

export class ReleaseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReleaseError';
  }
}

/** Content hash of a tool file: its version. */
export async function toolVersion(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex').slice(0, 10);
}

/** Recent commit subjects touching a file, newest first (empty outside a git checkout). */
export async function gitChanges(root, file, { run = exec, limit = 5 } = {}) {
  try {
    const { stdout } = await run('git', ['log', `-${limit}`, '--format=%h %s', '--', file], { cwd: root });
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * Announce a tool on the floor, with the Technician's release note.
 * @param {{config: {root: string}, floor: object, llm: {call: Function}, run?: Function}} deps
 * @param {string} tool
 * @param {{changes?: string, force?: boolean}} [opts]
 */
export async function releaseTool({ config, floor, llm, run }, tool, { changes, force = false } = {}) {
  const file = TOOLS[tool];
  if (!file) throw new ReleaseError(`unknown tool "${tool}" (known: ${Object.keys(TOOLS).join(', ')})`);
  const version = await toolVersion(join(config.root, file));
  const previous = (await floor.read({ shift: 'all', type: 'tool.released' })).filter((e) => e.payload.tool === tool).at(-1) ?? null;
  if (previous?.payload.version === version && !force) {
    throw new ReleaseError(`${tool} ${version} was already released on ${previous.shift}; change it first, or use --force`);
  }
  const what = changes?.trim() || (await gitChanges(config.root, file, { run })) || '(no change log available)';
  const res = await llm.call('technician', {
    vars: { tool: `${tool} (${file}), version ${version}${previous ? `, previous ${previous.payload.version}` : ', first release'}`, changes: what },
    prompt: 'Write the release note now. Plain text, at most five lines.',
  });
  return floor.append({
    type: 'tool.released',
    actor: 'technician',
    ref: previous?.id ?? null,
    payload: { tool, file, version, previous: previous?.payload.version ?? null, changes: what, note: res.content.trim(), callId: res.id },
  });
}
