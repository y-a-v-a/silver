// The daily schedule: a launchd user agent that runs `silver shift` at shift.at.
// launchd runs a missed StartCalendarInterval job when the Mac wakes from sleep; if the
// Mac was switched off at that time, the shift is skipped until the next day.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const LABEL = 'com.silver.shift';

export class ScheduleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScheduleError';
  }
}

const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/**
 * The launchd plist.
 * @param {{label?: string, node: string, cli: string, root: string, at: string, logDir: string, path?: string}} o
 */
export function buildPlist({ label = LABEL, node, cli, root, at, logDir, path = '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin' }) {
  const [hour, minute] = at.split(':').map(Number);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(cli)}</string>
    <string>shift</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(root)}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(path)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(join(logDir, 'shift.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(join(logDir, 'shift.err.log'))}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
`;
}

/** Does .env set a non-empty OPENROUTER_API_KEY? (launchd jobs don't see your shell's variables.) */
export async function envHasKey(envFile) {
  try {
    // [ \t] rather than \s: an empty value must not borrow the next line's.
    return /^[ \t]*OPENROUTER_API_KEY[ \t]*=[ \t]*["']?[^\s"'#]+/m.test(await readFile(envFile, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

export const plistPath = (home = homedir(), label = LABEL) => join(home, 'Library', 'LaunchAgents', `${label}.plist`);

/**
 * @param {{config: {root: string, paths: {archive: string}, shift: {at: string}}}} deps
 * @param {{home?: string, uid?: number, node?: string, run?: Function, force?: boolean}} [opts]
 */
export async function installSchedule({ config }, { home = homedir(), uid = process.getuid(), node = process.execPath, run = promisify(execFile), force = false } = {}) {
  if (!force && !(await envHasKey(join(config.root, '.env')))) {
    throw new ScheduleError(
      `${join(config.root, '.env')} has no OPENROUTER_API_KEY. launchd jobs don't inherit your shell, so the shift would fail. ` +
        'Put the key in .env (see .env.example), or pass --force.',
    );
  }
  const logDir = join(config.paths.archive, 'logs');
  const plist = buildPlist({ node, cli: join(config.root, 'src', 'cli.js'), root: config.root, at: config.shift.at, logDir });
  const path = plistPath(home);
  await mkdir(logDir, { recursive: true });
  await mkdir(join(home, 'Library', 'LaunchAgents'), { recursive: true });
  await writeFile(path, plist);
  // Replace an older version if one is loaded; bootout fails harmlessly when none is.
  await run('launchctl', ['bootout', `gui/${uid}/${LABEL}`]).catch(() => {});
  try {
    await run('launchctl', ['bootstrap', `gui/${uid}`, path]);
  } catch (err) {
    throw new ScheduleError(`launchctl bootstrap failed: ${err.stderr?.trim() || err.message}`);
  }
  return { path, logDir, at: config.shift.at };
}

/** Unload and remove the agent. Returns whether a plist was there. */
export async function uninstallSchedule({ home = homedir(), uid = process.getuid(), run = promisify(execFile) } = {}) {
  await run('launchctl', ['bootout', `gui/${uid}/${LABEL}`]).catch(() => {});
  const path = plistPath(home);
  try {
    await rm(path);
    return { path, removed: true };
  } catch (err) {
    if (err.code === 'ENOENT') return { path, removed: false };
    throw err;
  }
}
