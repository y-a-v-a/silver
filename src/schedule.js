// The daily schedule: a launchd user agent that runs `silver shift` at shift.at.
// launchd runs a missed StartCalendarInterval job when the Mac wakes from sleep; if the
// Mac was switched off at that time, the shift is skipped until the next day.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const LABEL = 'com.silver.shift';
export const ADMIN_LABEL = 'com.silver.admin';

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

/**
 * The admin's launchd plist: started at login and brought back if it dies. Its own supervisor
 * deals with code changes, so launchd only has to keep that process alive.
 * @param {{label?: string, node: string, cli: string, root: string, logDir: string, path?: string}} o
 */
export function buildAdminPlist({ label = ADMIN_LABEL, node, cli, root, logDir, path = '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin' }) {
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
    <string>admin</string>
    <string>--no-open</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(path)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(join(logDir, 'admin.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(join(logDir, 'admin.err.log'))}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
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

/**
 * Is the daily job installed, when does it run, and does it belong to this checkout? Reads the
 * plist instead of asking launchd, so it works the same in a test and costs nothing.
 * @returns {Promise<{installed: boolean, at?: string, root?: string, mine?: boolean, loaded?: boolean, path: string}>}
 */
export async function scheduleStatus(config, { home = homedir(), label = LABEL, uid = process.getuid(), run = null } = {}) {
  const path = plistPath(home, label);
  let xmlText;
  try {
    xmlText = await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { installed: false, path };
    throw err;
  }
  const int = (key) => xmlText.match(new RegExp(`<key>${key}</key>\\s*<integer>(\\d+)</integer>`))?.[1];
  const root = xmlText.match(/<key>WorkingDirectory<\/key>\s*<string>([^<]*)<\/string>/)?.[1];
  const [h, m] = [int('Hour'), int('Minute')];
  const status = { installed: true, at: h === undefined ? null : `${h.padStart(2, '0')}:${(m ?? '0').padStart(2, '0')}`, root, mine: root === config.root, path };
  // A plist on disk doesn't mean launchd has it, so with a way to ask, ask.
  if (run) status.loaded = await run('launchctl', ['print', `gui/${uid}/${label}`]).then(() => true, () => false);
  return status;
}

export const plistPath = (home = homedir(), label = LABEL) => join(home, 'Library', 'LaunchAgents', `${label}.plist`);

/** Load a plist. launchd may refuse for a moment while the old job winds down, so try a few times. */
async function bootstrap(run, uid, path, { tries = 4, waitMs = 500 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run('launchctl', ['bootstrap', `gui/${uid}`, path]);
    } catch (err) {
      if (attempt >= tries) throw new ScheduleError(`launchctl bootstrap failed: ${err.stderr?.trim() || err.message}`);
      await sleep(waitMs);
    }
  }
}

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
  await bootstrap(run, uid, path);
  return { path, logDir, at: config.shift.at };
}

/**
 * Install the launchd job that keeps the admin running.
 * @param {{config: {root: string, paths: {archive: string}}}} deps
 * @param {{home?: string, uid?: number, node?: string, run?: Function}} [opts]
 */
export async function installAdminService({ config }, { home = homedir(), uid = process.getuid(), node = process.execPath, run = promisify(execFile) } = {}) {
  const logDir = join(config.paths.archive, 'logs');
  const plist = buildAdminPlist({ node, cli: join(config.root, 'src', 'cli.js'), root: config.root, logDir });
  const path = plistPath(home, ADMIN_LABEL);
  await mkdir(logDir, { recursive: true });
  await mkdir(join(home, 'Library', 'LaunchAgents'), { recursive: true });
  await writeFile(path, plist);
  await run('launchctl', ['bootout', `gui/${uid}/${ADMIN_LABEL}`]).catch(() => {});
  await bootstrap(run, uid, path);
  return { path, logDir };
}

export const uninstallAdminService = (opts = {}) => uninstallSchedule({ ...opts, label: ADMIN_LABEL });

/** Unload and remove the agent. Returns whether a plist was there. */
export async function uninstallSchedule({ home = homedir(), uid = process.getuid(), run = promisify(execFile), label = LABEL } = {}) {
  await run('launchctl', ['bootout', `gui/${uid}/${label}`]).catch(() => {});
  const path = plistPath(home, label);
  try {
    await rm(path);
    return { path, removed: true };
  } catch (err) {
    if (err.code === 'ENOENT') return { path, removed: false };
    throw err;
  }
}
