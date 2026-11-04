// `silver admin`: the Factory's back room on this machine. By default a supervisor keeps it
// running on the latest code; `--no-supervise` runs the server directly in this process.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createFactory } from '../factory.js';
import { createFloor } from '../floor.js';
import { createPricing } from '../pricing.js';
import { DEFAULT_CONFIG_PATH, loadConfigFromEnv, loadRawConfig, ROOT } from '../config.js';
import { OPENROUTER_BASE_URL } from '../llm.js';
import { createAdminServer, LOCAL_NAME } from '../admin/server.js';
import { createJobs } from '../admin/jobs.js';
import { createCreditWatch, shiftInProgress } from '../admin/status.js';
import { createSupervisor } from '../admin/supervisor.js';
import { ensureTaste } from '../lib/taste.js';
import { installSchedule, scheduleStatus, uninstallSchedule } from '../schedule.js';
import { listSeries, isPendingReview } from '../agents/series-data.js';

const CLI = fileURLToPath(new URL('../cli.js', import.meta.url));

/** The server itself: runs in this process, under a supervisor or not. */
async function serve(opts, ctx, { startPath = '/' } = {}) {
  const env = process.env;
  // A broken studio.json mustn't lock you out of the page that fixes it.
  let configProblem = null;
  const describe = (err) => `studio.json doesn't work, so these settings aren't in use here, and the shift won't run until it's fixed or reset on System: ${err.errors.join('; ')}`;
  let start;
  try {
    start = await createFactory();
  } catch (err) {
    if (err.name !== 'ConfigError') throw err;
    start = await createFactory({ overlay: false });
    configProblem = describe(err);
  }
  const { config, floor } = start;
  if (await ensureTaste(config.paths.taste)) ctx.stderr.write(`created ${config.paths.taste}: write what you like at the top\n`);
  const baseUrl = env.OPENROUTER_BASE_URL || OPENROUTER_BASE_URL;
  const pricing = createPricing({ baseUrl });
  const jobs = createJobs({ config, env, externalShift: () => shiftInProgress(createFloor({ dir: config.paths.floor })) });
  const supervised = typeof process.send === 'function';

  let live = config;
  const getConfig = async () => {
    try {
      live = await loadConfigFromEnv(env);
      configProblem = null;
    } catch (err) {
      if (err.name !== 'ConfigError') throw err;
      configProblem = describe(err);
    }
    return live;
  };

  const preflightProblems = [];
  const notes = {
    list: () => [...(configProblem ? [{ level: 'bad', text: configProblem }] : []), ...preflightProblems.map((text) => ({ level: 'bad', text: `The code you just saved doesn't load, so this admin keeps running the last good version:\n${text}` }))],
  };
  process.on('message', (m) => {
    if (m?.type === 'preflight') {
      preflightProblems.length = 0;
      if (!m.ok) preflightProblems.push(...m.problems);
    }
  });

  const schedule = {
    status: (c) => scheduleStatus(c),
    /** Point the plist at the current time, but only one that belongs to this checkout. */
    async sync() {
      const c = await getConfig();
      const st = await scheduleStatus(c);
      if (st.installed && st.mine && st.at !== c.shift.at) await installSchedule({ config: c });
    },
    install: async () => {
      const c = await getConfig();
      if (c.root !== ROOT) throw Object.assign(new Error('a sandbox can\'t install the real schedule'), { name: 'ScheduleError' });
      return installSchedule({ config: c });
    },
    remove: () => uninstallSchedule(),
  };

  const admin = createAdminServer({
    config,
    floor,
    jobs,
    getConfig,
    notices: notes,
    onApproved: opts.publish === false ? undefined : () => jobs.enqueue('publish', {}, { coalesce: true }),
    extra: {
      env,
      pricing,
      credit: createCreditWatch({ apiKey: env.OPENROUTER_API_KEY, baseUrl }),
      schedule,
      rawConfig: () => loadRawConfig(env.SILVER_CONFIG || DEFAULT_CONFIG_PATH),
      restart: supervised ? () => process.send({ type: 'restart' }) : null,
    },
  });
  const url = await admin.listen(opts.port === undefined ? config.review.port : Number(opts.port));
  const port = new URL(url).port;
  const pending = (await listSeries(floor)).filter(isPendingReview).length;
  ctx.stdout.write(`admin: http://${LOCAL_NAME}:${port}${startPath === '/' ? '' : startPath}  (also ${url}; ${pending} series waiting; Ctrl-C to stop)\n`);
  if (supervised) process.send({ type: 'ready' });
  else if (opts.open) execFile('open', [`http://${LOCAL_NAME}:${port}${startPath}`], () => {});
  await new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
    process.once('disconnect', resolve);
  });
  await admin.close();
  // The IPC channel to the supervisor would keep this process alive by itself.
  if (supervised) process.exit(0);
}

export default async function adminCommand(_args, opts, ctx) {
  const startPath = opts.startPath ?? '/';
  // Under a supervisor, or told not to use one: just serve.
  if (opts.supervise === false || typeof process.send === 'function') return serve(opts, ctx, { startPath });

  const config = await loadConfigFromEnv(process.env, { overlay: false });
  const port = opts.port === undefined ? config.review.port : Number(opts.port);
  const childArgs = ['admin', '--no-supervise', '--no-open', '--port', String(port), ...(opts.publish === false ? ['--no-publish'] : [])];
  // What this process read from .env is left out of the child's environment, so a restart
  // after editing .env reads the new values (a variable already set would win over the file).
  const env = { ...process.env };
  try {
    const dotenv = parseEnv(readFileSync(join(ROOT, '.env'), 'utf8'));
    for (const [key, value] of Object.entries(dotenv)) if (env[key] === value) delete env[key];
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const supervisor = createSupervisor({
    root: ROOT,
    cli: CLI,
    childArgs,
    port,
    env,
    log: (line) => ctx.stderr.write(`supervisor: ${line}\n`),
  });
  await supervisor.start();
  if (opts.open) {
    const url = `http://${LOCAL_NAME}:${port}${startPath}`;
    setTimeout(() => execFile('open', [url], () => {}), 800);
  }
  await new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  await supervisor.stop();
}

/** `silver review`: the same room, starting at the contact sheet. */
export async function reviewCommand(args, opts, ctx) {
  return adminCommand(args, { ...opts, startPath: '/review' }, ctx);
}
