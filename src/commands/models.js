// `silver models`: audit configured models against OpenRouter's live catalogue.
import { createFactory } from '../factory.js';
import { auditModels } from '../model-audit.js';
import { table } from '../lib/format.js';

export default async function modelsCommand(_args, opts, ctx) {
  const factory = await createFactory();
  const catalogue = await factory.pricing.load();
  if (!catalogue) {
    ctx.stderr.write('silver models: could not reach the OpenRouter model list\n');
    process.exitCode = 1;
    return;
  }
  const roles = await factory.roles();
  const { rows, problems } = await auditModels(factory.config, roles.list(), factory.pricing.get);

  if (opts.json) {
    ctx.stdout.write(JSON.stringify({ rows, problems }, null, 2) + '\n');
  } else {
    const money = (n) => (n === null ? '-' : n.toFixed(2));
    const vision = (r) => (r.vision === null ? '-' : r.vision ? 'yes' : r.needsVision ? 'NO' : 'no');
    const header = ['use', 'model', 'found', 'images', '$/M in', '$/M out'];
    const body = rows.map((r) => [r.use, r.model, r.exists ? 'yes' : 'NO', vision(r), money(r.promptPerM), money(r.completionPerM)]);
    ctx.stdout.write(table([header, ...body], { indent: '' }) + '\n');
    ctx.stdout.write(problems.length ? `\n${problems.map((p) => `problem: ${p}`).join('\n')}\n` : '\nall models found; image roles are on vision models\n');
  }
  if (problems.length) process.exitCode = 1;
}
