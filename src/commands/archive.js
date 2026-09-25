// `silver archive [date]`: the Archivist's check, by hand: every event's artifacts on disk,
// and the day's manifest in archive/manifests/.
import { createFactory } from '../factory.js';
import { buildManifest, writeManifest } from '../agents/archivist.js';
import { usd } from '../lib/format.js';

export default async function archiveCommand([date], opts, ctx) {
  const { config, floor } = await createFactory();
  const shift = date ?? floor.today();
  const m = await buildManifest(config, floor, shift);
  const path = await writeManifest(config, m);
  if (opts.json) return void ctx.stdout.write(JSON.stringify(m, null, 2) + '\n');
  ctx.stdout.write(`${shift}: ${m.events} events, ${m.subjects.length} subjects, ${m.series.length} series, ${usd(m.spend.usd)} on ${m.spend.calls} calls\n`);
  ctx.stdout.write(`artifacts: ${m.artifacts.checked} checked, ${m.artifacts.missing.length} missing\n`);
  for (const x of m.artifacts.missing.slice(0, 20)) ctx.stdout.write(`  missing  ${x.type} ${x.eventId.slice(-8)} ${x.key}: ${x.path}\n`);
  ctx.stdout.write(`manifest: ${path}\n`);
}
