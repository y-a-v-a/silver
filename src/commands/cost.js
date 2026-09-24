// `silver cost`: spend per role and per model against the daily cap.
import { createFactory } from '../factory.js';
import { summarise } from '../budget.js';
import { usd, int, table } from '../lib/format.js';

export default async function costCommand(_args, opts, ctx) {
  const { floor, budget } = await createFactory();
  const shift = opts.shift ?? floor.today();
  const ledger = summarise(await floor.read({ shift, type: 'cost.recorded' }));

  if (opts.json) {
    ctx.stdout.write(JSON.stringify({ shift, cap: budget.dailyUsd, chatterCap: budget.chatterCap, ...ledger }, null, 2) + '\n');
    return;
  }

  const pct = (part, whole) => `${((part / whole) * 100).toFixed(1)}%`;
  const lines = [`shift ${shift}: ${ledger.calls} calls, ${int(ledger.promptTokens)} tokens in / ${int(ledger.completionTokens)} out`];
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
      .map(([name, r]) => [name, `${r.calls} calls`, `${int(r.promptTokens)} in`, `${int(r.completionTokens)} out`, usd(r.usd)]);
  if (ledger.calls) {
    lines.push('', 'by role', table(rows(ledger.byRole)), '', 'by model', table(rows(ledger.byModel)));
  }
  ctx.stdout.write(lines.join('\n') + '\n');
}
