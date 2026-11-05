// `silver pull [series]`: Warhol sends his first pick (or --variant) back to the hand that
// made it, for a second pull pushed further. The new print joins the series for review.
import { createFactory } from '../factory.js';
import { secondPull } from '../agents/pull.js';

export default async function pullCommand([seriesRef = 'latest'], opts, ctx) {
  const factory = await createFactory({ dryRun: Boolean(opts.dryRun) });
  const { createRenderer } = await import('../tools/render.js');
  const renderer = opts.render === false ? null : await createRenderer();
  try {
    const r = await secondPull({ config: factory.config, floor: factory.floor, llm: await factory.llm(), renderer }, seriesRef, { variant: opts.variant, note: opts.note, again: Boolean(opts.again) });
    if (opts.json) return void ctx.stdout.write(JSON.stringify(r.event, null, 2) + '\n');
    const p = r.event.payload;
    ctx.stdout.write(`${r.series.subject?.payload.title ?? r.series.seriesId} (series ${r.series.seriesId})\n\n`);
    ctx.stdout.write(`  ${r.variant}  second pull of ${r.pullOf} · ${p.technique} · ${p.model ?? p.requestedModel}  ${r.ok ? 'ok' : `${p.stage}: ${String(p.error).split('\n')[0]}`}\n`);
    if (p.note) ctx.stdout.write(`  ${p.note}\n`);
    ctx.stderr.write('\nreview it with: silver review\n');
  } finally {
    await renderer?.close();
  }
}
