// `silver install-schedule` and `silver uninstall-schedule`: the daily launchd job.
import { join } from 'node:path';
import { loadConfigFromEnv } from '../config.js';
import { buildAdminPlist, buildPlist, installAdminService, installSchedule, uninstallAdminService, uninstallSchedule } from '../schedule.js';

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

export async function installAdmin(_args, opts, ctx) {
  const config = await loadConfigFromEnv();
  if (opts.print) {
    ctx.stdout.write(buildAdminPlist({ node: process.execPath, cli: join(config.root, 'src', 'cli.js'), root: config.root, logDir: join(config.paths.archive, 'logs') }));
    return;
  }
  if (process.platform !== 'darwin') throw new Error('this uses launchd, which is macOS only');
  const r = await installAdminService({ config });
  ctx.stdout.write(`installed: the admin starts at login, comes back if it dies, and restarts itself when the code changes\n  http://silver.localhost:${config.review.port}\n  ${r.path}\n  logs: ${r.logDir}\n`);
}

export async function uninstallAdminCommand(_args, _opts, ctx) {
  const r = await uninstallAdminService();
  ctx.stdout.write(r.removed ? `removed ${r.path}\n` : `nothing installed (${r.path} not found)\n`);
}

export default install;
