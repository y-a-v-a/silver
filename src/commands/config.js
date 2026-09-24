// `silver config`: show the resolved config or just validate it.
import { loadConfig, ConfigError } from '../config.js';

export default async function config(_args, opts, ctx) {
  let cfg;
  try {
    cfg = await loadConfig();
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    ctx.stderr.write(err.message + '\n');
    process.exitCode = 1;
    return;
  }
  if (opts.check) {
    ctx.stdout.write('ok\n');
    return;
  }
  if (opts.json) {
    ctx.stdout.write(JSON.stringify(cfg, null, 2) + '\n');
    return;
  }
  const { models, budget, series, shift } = cfg;
  const lines = [
    `root          ${cfg.root}`,
    `budget        $${budget.dailyUsd}/day (chatter <= ${budget.chatterShare * 100}%)`,
    `series        ${series.variants} variants = ${series.modelsPerSeries} models x ${series.temperatures.length} temps x ${series.techniquesPerSeries} techniques`,
    `shift         daily at ${shift.at}, ${shift.subjectsPerShift} subjects, ${shift.seriesPerShift} series`,
    `studio        ${models.studio.join(', ')}`,
    ...Object.entries(models.roles).map(([role, model]) => `${role.padEnd(14)}${model}`),
    `techniques    ${Object.keys(cfg.techniques).join(', ')}`,
  ];
  ctx.stdout.write(lines.join('\n') + '\n');
}
