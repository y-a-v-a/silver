// `silver cost`: spend per role and per model against the daily cap.
import { createFactory } from '../factory.js';
import { summarise } from '../budget.js';
import { usd, int, plural, table } from '../lib/format.js';
import { fetchKeyUsage, reconcile } from '../reconcile.js';
import { OPENROUTER_BASE_URL } from '../llm.js';

/** Print ledger vs billed usage (`--reconcile`). */
async function printReconcile(floor, ctx, opts) {
  const billed = await fetchKeyUsage({ apiKey: process.env.OPENROUTER_API_KEY, baseUrl: process.env.OPENROUTER_BASE_URL || OPENROUTER_BASE_URL });
  const r = reconcile(await floor.read({ shift: 'all', type: 'cost.recorded' }), billed);
  if (opts.json) {
    ctx.stdout.write(JSON.stringify(r, null, 2) + '\n');
    return;
  }
  const line = (label, x) => [label, usd(x.ledger), usd(x.billed), usd(x.gap)];
  ctx.stdout.write(`${table([['', 'ledger', 'billed', 'gap'], line(`UTC day ${r.utcDay}`, r.day), line('all time', r.total)], { indent: '' })}\n`);
  ctx.stdout.write('\nThe gap is billed spend that never reached the ledger: replies that timed out after\n' +
    'generation, calls made outside Silver with the same key, or requests made before the ledger existed.\n');
}

export default async function costCommand(_args, opts, ctx) {
  const { floor, budget } = await createFactory();
  if (opts.reconcile) return printReconcile(floor, ctx, opts);
  const shift = opts.shift ?? floor.today();
  const ledger = summarise(await floor.read({ shift, type: 'cost.recorded' }));

  if (opts.json) {
    ctx.stdout.write(JSON.stringify({ shift, cap: budget.dailyUsd, chatterCap: budget.chatterCap, ...ledger }, null, 2) + '\n');
    return;
  }

  const pct = (part, whole) => `${((part / whole) * 100).toFixed(1)}%`;
  const lines = [`shift ${shift}: ${plural(ledger.calls, 'call')}, ${int(ledger.promptTokens)} tokens in / ${int(ledger.completionTokens)} out`];
  if (shift !== 'all') {
    lines.push(
      `  spent    ${usd(ledger.total)} of ${usd(budget.dailyUsd)} (${pct(ledger.total, budget.dailyUsd)})`,
      `  chatter  ${usd(ledger.chatter)} of ${usd(budget.chatterCap)} (${pct(ledger.chatter, budget.chatterCap)})`,
    );
  } else {
    lines.push(`  spent    ${usd(ledger.total)} across all shifts`);
  }
  const rows = (bucket) =>
    Object.entries(bucket)
      .sort(([, a], [, b]) => b.usd - a.usd)
      .map(([name, r]) => [name, plural(r.calls, 'call'), `${int(r.promptTokens)} in`, `${int(r.completionTokens)} out`, usd(r.usd)]);
  if (ledger.calls) {
    lines.push('', 'by role', table(rows(ledger.byRole)), '', 'by model', table(rows(ledger.byModel)));
  }
  ctx.stdout.write(lines.join('\n') + '\n');
}
