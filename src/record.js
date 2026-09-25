// The record: floor/, archive/, canon/ and taste.md, backed up as their own git repository
// (decision 2026-09-24). The code repo ignores them; the record's git directory lives in
// .record/ (also ignored) with the repository root as its work tree, and only the data
// paths are ever added. The Archivist commits after each shift and pushes to a
// private remote, if one is set. A failed push is recorded and simply retried next time.
import { execFile } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export class RecordError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RecordError';
  }
}

export const RECORD_DIR = '.record';
export const BRANCH = 'main';

/** What the record holds, relative to the repository root. */
export const DATA_PATHS = Object.freeze(['floor', 'archive', 'canon', 'taste.md']);

/**
 * Pathspecs for the data. The code repo's .gitignore ignores exactly these paths (and its
 * rules outrank info/exclude), so the record adds them with --force and keeps its own
 * exclusions here instead.
 */
async function dataSpecs(config) {
  const present = [];
  for (const p of DATA_PATHS) if (await exists(join(config.root, p))) present.push(p);
  return present.length ? ['--', ...present, ':(exclude)canon/.publish.lock', ':(exclude,glob)**/*.tmp', ':(exclude,glob)**/.DS_Store'] : null;
}

/** Only the data: everything else in the work tree is invisible to the record. */
export const EXCLUDE = `# The Silver record: only the Factory's data (see src/record.js).
/*
!/floor/
!/archive/
!/canon/
!/taste.md
/canon/.publish.lock
*.tmp
.DS_Store
`;

const exists = (p) => access(p).then(() => true, () => false);

/** git with the record's git dir and the repo root as work tree. */
export function recordGit(config, { run = execFileP } = {}) {
  const gitDir = join(config.root, RECORD_DIR);
  return async (...args) => {
    const { stdout } = await run('git', ['--git-dir', gitDir, '--work-tree', config.root, ...args], { cwd: config.root, maxBuffer: 64 * 1024 * 1024 });
    return String(stdout).trim();
  };
}

export async function hasRecord(config) {
  return exists(join(config.root, RECORD_DIR, 'HEAD'));
}

/**
 * Create the local record repository and its first commit. Idempotent: an existing
 * record is left alone. Creating the GitHub remote is a separate, confirmed step.
 * @returns {Promise<{created: boolean, commit: string|null}>}
 */
export async function initRecord(config, { run } = {}) {
  const gitDir = join(config.root, RECORD_DIR);
  if (await hasRecord(config)) return { created: false, commit: null };
  await mkdir(gitDir, { recursive: true });
  const raw = run ?? execFileP;
  await raw('git', ['init', '--quiet', '--bare', `--initial-branch=${BRANCH}`, gitDir], { cwd: config.root });
  const git = recordGit(config, { run });
  await git('config', 'core.bare', 'false');
  await git('config', 'user.name', 'Silver Archivist');
  await git('config', 'user.email', 'archivist@silver-factory.invalid');
  await mkdir(join(gitDir, 'info'), { recursive: true });
  await writeFile(join(gitDir, 'info', 'exclude'), EXCLUDE);
  const r = await commitRecord(config, { message: 'The record begins', run, push: false });
  return { created: true, commit: r.commit };
}

/**
 * Commit whatever changed in the data, then push if a remote is set.
 * @returns {Promise<{commit: string|null, committed: boolean, pushed: boolean, remote: string|null, error: string|null}>}
 */
export async function commitRecord(config, { message, run, push = true } = {}) {
  if (!(await hasRecord(config))) return { commit: null, committed: false, pushed: false, remote: null, error: 'no record yet: run silver init-record' };
  const git = recordGit(config, { run });
  const specs = await dataSpecs(config);
  if (specs) await git('add', '--all', '--force', ...specs);
  const staged = await git('diff', '--cached', '--name-only');
  let committed = false;
  if (staged) {
    await git('commit', '--quiet', '-m', message);
    committed = true;
  }
  const commit = await git('rev-parse', '--verify', '--quiet', 'HEAD').catch(() => null);
  const remote = (await git('remote')).split('\n').filter(Boolean)[0] ?? null;
  if (!push || !remote || !commit) return { commit, committed, pushed: false, remote, error: null };
  try {
    await git('push', '--quiet', remote, `HEAD:${BRANCH}`);
    return { commit, committed, pushed: true, remote, error: null };
  } catch (err) {
    return { commit, committed, pushed: false, remote, error: String(err.stderr || err.message).trim().split('\n').at(-1) };
  }
}

/** Point the record at a remote (e.g. the private GitHub repo). */
export async function setRecordRemote(config, url, { run } = {}) {
  const git = recordGit(config, { run });
  const remotes = (await git('remote')).split('\n').filter(Boolean);
  if (remotes.includes('origin')) await git('remote', 'set-url', 'origin', url);
  else await git('remote', 'add', 'origin', url);
}

/** Status for `silver init-record` and the shift summary. */
export async function recordStatus(config, { run } = {}) {
  if (!(await hasRecord(config))) return { exists: false };
  const git = recordGit(config, { run });
  const commit = await git('rev-parse', '--short', 'HEAD').catch(() => null);
  const commits = Number(await git('rev-list', '--count', 'HEAD').catch(() => '0'));
  const remote = (await git('remote', 'get-url', 'origin').catch(() => '')) || null;
  const specs = await dataSpecs(config);
  const dirty = Boolean(specs && (await git('add', '--dry-run', '--all', '--force', ...specs)));
  const files = Number((await git('ls-files')).split('\n').filter(Boolean).length);
  return { exists: true, commit, commits, remote, dirty, files };
}
