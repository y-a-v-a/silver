// `silver review`: the contact sheet where the human approves or vetoes.
import { execFile } from 'node:child_process';
import { createFactory } from '../factory.js';
import { createReviewServer } from '../tools/review/server.js';
import { listSeries, isPendingReview } from '../agents/series-data.js';
import { ensureTaste } from '../lib/taste.js';

export default async function reviewCommand(_args, opts, ctx) {
  const { config, floor } = await createFactory();
  if (await ensureTaste(config.paths.taste)) ctx.stderr.write(`created ${config.paths.taste}: write what you like at the top\n`);
  const review = createReviewServer({ config, floor });
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
}
