// `silver install-schedule` and `silver uninstall-schedule`: the daily launchd job.
import { join } from 'node:path';
import { loadConfigFromEnv } from '../config.js';
import { buildPlist, installSchedule, uninstallSchedule } from '../schedule.js';

export async function install(_args, opts, ctx) {
  const config = await loadConfigFromEnv();
  if (opts.print) {
    ctx.stdout.write(buildPlist({ node: process.execPath, cli: join(config.root, 'src', 'cli.js'), root: config.root, at: config.shift.at, logDir: join(config.paths.archive, 'logs') }));
    return;
  }
  if (process.platform !== 'darwin') throw new Error('the schedule uses launchd, which is macOS only');
  const r = await installSchedule({ config }, { force: opts.force });
  ctx.stdout.write(`installed: silver shift runs daily at ${r.at}\n  ${r.path}\n  logs: ${r.logDir}\n`);
  ctx.stdout.write('If the Mac is asleep at that time, the shift runs when it wakes; if it is off, that day is skipped.\n');
}

export async function uninstall(_args, _opts, ctx) {
  const r = await uninstallSchedule();
  ctx.stdout.write(r.removed ? `removed ${r.path}\n` : `nothing installed (${r.path} not found)\n`);
}

export default install;
