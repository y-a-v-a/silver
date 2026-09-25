// `silver shift`: run (or resume) today's shift. This is what launchd runs every day.
import { createFactory } from '../factory.js';
import { runShift } from '../shift.js';
import { fetchKeyUsage, reconcile } from '../reconcile.js';
import { notify } from '../lib/notify.js';
import { usd } from '../lib/format.js';

export default async function shiftCommand(_args, opts, ctx) {
  const factory = await createFactory({ dryRun: Boolean(opts.dryRun) });
  const { config, floor, budget } = factory;
  const result = await runShift(
    {
      config,
      floor,
      budget,
      llm: await factory.llm(),
      createRenderer: async () => (await import('../tools/render.js')).createRenderer(),
      reconcile: async () => {
        const billed = await fetchKeyUsage({ apiKey: process.env.OPENROUTER_API_KEY, baseUrl: process.env.OPENROUTER_BASE_URL || undefined });
        return reconcile(await floor.read({ shift: 'all', type: 'cost.recorded' }), billed);
      },
      notify: opts.notify ? (title, message) => notify(title, message) : undefined,
    },
    { dryRun: Boolean(opts.dryRun), again: Boolean(opts.again) },
  );

  if (opts.json) {
    ctx.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  if (result.status === 'already-done') {
    ctx.stdout.write(`the ${result.shift} shift already ended at ${result.ended.ts}; use --again to run another round\n`);
    return;
  }
  const p = result.ended.payload;
  ctx.stdout.write(`shift ${result.shift}${p.dryRun ? ' (dry run)' : ''}: ${result.status}\n`);
  for (const s of p.steps) {
    const detail = s.reason ?? s.error ?? (s.posted !== undefined ? `${s.posted} subjects` : s.series ? `${s.series.length} series` : s.shortlisted ? `${s.shortlisted.length} shortlisted` : '');
    ctx.stdout.write(`  ${s.step.padEnd(11)} ${s.status.padEnd(8)} ${detail}\n`);
  }
  for (const s of p.series) ctx.stdout.write(`    series ${s.seriesId}: ${s.produced}/${s.of} produced (${s.origin})\n`);
  ctx.stdout.write(`spent ${usd(p.spentUsd)} today, ${usd(p.budgetRemaining)} left; ${p.waitingForReview} series waiting for review\n`);
  if (p.reconcile?.day) {
    // OpenRouter's usage lags by a few minutes, so a small negative gap just means "not billed yet".
    const gap = p.reconcile.day.gap < 0 ? 'billing still catching up' : `gap ${usd(p.reconcile.day.gap)}`;
    ctx.stdout.write(`reconcile (UTC day): ${usd(p.reconcile.day.ledger)} recorded vs ${usd(p.reconcile.day.billed)} billed (${gap})\n`);
  }
  if (p.reconcile?.error) ctx.stderr.write(`reconcile unavailable: ${p.reconcile.error}\n`);
  if (p.stoppedReason) ctx.stderr.write(`stopped early: ${p.stoppedReason}\n`);
}
