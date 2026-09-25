// `silver shortlist <series>`: Warhol looks at a finished series and proposes his picks.
import { createFactory } from '../factory.js';
import { shortlistSeries } from '../agents/warhol.js';

export default async function shortlistCommand([seriesRef = 'unlisted'], opts, ctx) {
  const factory = await createFactory({ dryRun: Boolean(opts.dryRun) });
  const { series, event, problems } = await shortlistSeries({ config: factory.config, floor: factory.floor, llm: await factory.llm() }, seriesRef, { force: opts.force });
  const p = event.payload;
  if (opts.json) {
    ctx.stdout.write(JSON.stringify(event, null, 2) + '\n');
    return;
  }
  ctx.stdout.write(`${series.subject?.payload.title ?? series.seriesId} (series ${series.seriesId})\n\n`);
  for (const pick of p.picks) ctx.stdout.write(`  ${pick.variant}${pick.offTechnique ? '  (off technique)' : ''}  ${pick.note}\n`);
  if (p.rejects) ctx.stdout.write(`\n  the rest: ${p.rejects}\n`);
  for (const problem of problems) ctx.stderr.write(`problem: ${problem}\n`);
  ctx.stderr.write('\nreview it with: silver review\n');
}
