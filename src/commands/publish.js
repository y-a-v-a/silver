// `silver publish`: print approved variants, release editions, rebuild and deploy the gallery.
import { createFactory } from '../factory.js';
import { publish } from '../publish.js';
import { deployVercel } from '../deploy.js';

export default async function publishCommand(_args, opts, ctx) {
  const factory = await createFactory();
  const { config, floor } = factory;
  const canDeploy = opts.deploy && Boolean(process.env.VERCEL_TOKEN);
  const limit = opts.limit === undefined ? undefined : Number(opts.limit);
  const result = await publish(
    {
      config,
      floor,
      llm: await factory.llm(),
      createRenderer: async () => (await import('../tools/render.js')).createRenderer(),
      deploy: canDeploy ? (deps) => deployVercel(deps) : null,
    },
    { limit, redeploy: Boolean(opts.redeploy) },
  );
  if (opts.json) {
    ctx.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  for (const w of result.printed) {
    const c = w.payload.printCheck;
    ctx.stdout.write(`printed  ${w.payload.canonId}  print check: ${c.verdict}${c.note ? ` (${c.note})` : ''}\n`);
  }
  for (const e of result.released) ctx.stdout.write(`edition  No. ${String(e.payload.edition).padStart(3, '0')}  ${e.payload.title}\n`);
  for (const f of result.failed) ctx.stderr.write(`not released yet: ${f.canonId} (${f.error})\n`);
  ctx.stdout.write(`site: ${result.site.works} works in ${result.site.dir}\n`);
  if (result.deployed) ctx.stdout.write(`deployed: ${result.deployed.payload.url}\n`);
  else if (result.deployError) ctx.stderr.write(`deploy failed: ${result.deployError}\n`);
  else if (!opts.deploy) ctx.stdout.write('not deployed (--no-deploy)\n');
  else if (!process.env.VERCEL_TOKEN) ctx.stdout.write('not deployed: VERCEL_TOKEN is not set in .env\n');
  else ctx.stdout.write('not deployed: nothing new\n');
}
