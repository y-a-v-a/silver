// `silver review`: the contact sheet where the human approves or vetoes.
import { execFile } from 'node:child_process';
import { createFactory } from '../factory.js';
import { createReviewServer } from '../tools/review/server.js';
import { listSeries, isPendingReview } from '../agents/series-data.js';
import { ensureTaste } from '../lib/taste.js';
import { publish, publishQueue } from '../publish.js';
import { deployVercel } from '../deploy.js';

export default async function reviewCommand(_args, opts, ctx) {
  const factory = await createFactory();
  const { config, floor } = factory;
  if (await ensureTaste(config.paths.taste)) ctx.stderr.write(`created ${config.paths.taste}: write what you like at the top\n`);
  // Approvals are printed and published in the background, one publish at a time.
  const queue = opts.publish
    ? publishQueue(
        async () =>
          publish({
            config,
            floor,
            llm: await factory.llm(),
            createRenderer: async () => (await import('../tools/render.js')).createRenderer(),
            deploy: process.env.VERCEL_TOKEN ? (deps) => deployVercel(deps) : null,
          }),
        (err, r) => {
          if (err) ctx.stderr.write(`publish failed: ${err.message}\n`);
          else ctx.stdout.write(`published: ${r.printed.length} printed, ${r.released.length} released, ${r.site.works} on the site${r.deployed ? `, live at ${r.deployed.payload.url}` : r.deployError ? ` (deploy failed: ${r.deployError})` : ''}\n`);
        },
      )
    : null;
  const review = createReviewServer({ config, floor, onApproved: queue ? () => queue.request() : undefined });
  const port = opts.port === undefined ? config.review.port : Number(opts.port);
  const url = await review.listen(port);
  const pending = (await listSeries(floor)).filter(isPendingReview).length;
  ctx.stdout.write(`review: ${url}  (${pending} series waiting; Ctrl-C to stop)\n`);
  if (opts.open) execFile('open', [url], () => {});
  await new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  await review.close();
  if (queue) {
    ctx.stderr.write('waiting for the running publish to finish...\n');
    await queue.idle();
  }
}
