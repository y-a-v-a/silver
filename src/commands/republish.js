// After a change by hand to the canon (`silver retitle`, `silver retract`): the usual publish,
// so the gallery shows it. Anything approved in the meantime is printed and labelled too. Not a
// command of its own; the commands that change the canon share it.
import { publishWhenFree } from '../publish.js';
import { deployVercel } from '../deploy.js';

/**
 * @param {{config: object, floor: object, llm: object|null}} deps
 * @param {{stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream}} ctx
 * @param {{wait?: object}} [opts]  wait: passed to publishWhenFree (tests shorten it)
 */
export async function republish({ config, floor, llm }, ctx, { wait = {} } = {}) {
  const canDeploy = Boolean(process.env.VERCEL_TOKEN);
  let result;
  try {
    result = await publishWhenFree(
      {
        config,
        floor,
        llm,
        createRenderer: async () => (await import('../tools/render.js')).createRenderer(),
        deploy: canDeploy ? (deps) => deployVercel(deps) : null,
      },
      {},
      { onWait: (err) => ctx.stderr.write(`waiting for the publish that is running (pid ${err.pid}) to finish, then publishing after it…\n`), ...wait },
    );
  } catch (err) {
    if (err.name !== 'PublishBusy') throw err;
    // The change itself is on the floor already; only the gallery is behind.
    ctx.stderr.write(`the change is recorded, but the gallery isn't updated: ${err.message} after waiting. Run \`silver publish\` once it has finished.\n`);
    process.exitCode = 1;
    return null;
  }
  for (const f of result.failed) ctx.stderr.write(`not released yet: ${f.canonId} (${f.error})\n`);
  if (result.deployed) ctx.stdout.write(`deployed: ${result.deployed.payload.url}\n`);
  else if (result.deployError) {
    ctx.stderr.write(`deploy failed: ${result.deployError}\n`);
    process.exitCode = 1;
  } else if (!canDeploy) ctx.stdout.write(`site rebuilt in ${result.site.dir} (not deployed: VERCEL_TOKEN is not set)\n`);
  else ctx.stdout.write(`site rebuilt in ${result.site.dir} (not deployed: nothing new)\n`);
  return result;
}
