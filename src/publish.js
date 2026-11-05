// Publishing: print approved variants, release their editions, rebuild the gallery and
// deploy it. One publish at a time (a lock file in canon/), because the review server
// triggers it on every approval and `silver publish` can run it by hand.
import { join } from 'node:path';
import { printApproved } from './agents/printer.js';
import { releaseEditions } from './agents/hughes.js';
import { approvalsToPrint } from './canon.js';
import { listSeries } from './agents/series-data.js';
import { buildSite } from './site.js';
import { withLock } from './lib/lock.js';

export class PublishBusy extends Error {
  constructor(pid) {
    super(`another publish is running (pid ${pid})`);
    this.name = 'PublishBusy';
  }
}

/** Hold canon/.publish.lock while `fn` runs. A lock left by a dead process is taken over. */
export async function withPublishLock(config, fn) {
  try {
    return await withLock(join(config.paths.canon, '.publish.lock'), fn);
  } catch (err) {
    if (err.name === 'LockBusy') throw new PublishBusy(err.pid);
    throw err;
  }
}

/**
 * Print -> editions -> site -> deploy.
 * @param {object} deps
 * @param {object} deps.config
 * @param {object} deps.floor
 * @param {{call: Function}|null} deps.llm
 * @param {() => Promise<{render: Function, hold: Function, close: Function}>} deps.createRenderer
 * @param {((opts: object) => Promise<{url: string}>)|null} deps.deploy   null: don't deploy
 * @param {{limit?: number, redeploy?: boolean}} [opts]  redeploy: even when the canon hasn't changed
 */
export async function publish({ config, floor, llm, createRenderer, deploy }, { limit, redeploy = false } = {}) {
  return withPublishLock(config, async () => {
    const result = { printed: [], released: [], failed: [], site: null, deployed: null, deployError: null };

    const todo = approvalsToPrint(await listSeries(floor), await floor.read({ shift: 'all', type: 'work.published' }));
    if (todo.length) {
      const renderer = await createRenderer();
      try {
        result.printed = await printApproved({ config, floor, llm, renderer }, { limit });
      } finally {
        await renderer.close();
      }
    }
    if (llm) {
      const editions = await releaseEditions({ config, floor, llm });
      result.released = editions.released;
      result.failed = editions.failed;
    }
    result.site = await buildSite({ config, floor });

    if (deploy && (redeploy || (await canonChangedSinceDeploy(floor)))) {
      try {
        const { url } = await deploy({ config });
        result.deployed = await floor.append({ type: 'site.deployed', actor: 'fred-hughes', payload: { url, works: result.site.works, provider: config.deploy.provider } });
      } catch (err) {
        result.deployError = err.message;
      }
    }
    return result;
  });
}

/** True when a work or edition (including a correction) reached the floor after the last deploy. */
async function canonChangedSinceDeploy(floor) {
  const last = (await floor.read({ shift: 'all', type: 'site.deployed' })).at(-1);
  if (!last) return true;
  return (await floor.read({ shift: 'all', type: ['work.published', 'edition.released'] })).some((e) => e.id > last.id);
}

/**
 * Run publishes one at a time: a request while one is running schedules exactly one more.
 * Used by the review server after approvals.
 * @param {() => Promise<object>} run
 * @param {(err: Error|null, result?: object) => void} [report]
 */
export function publishQueue(run, report = () => {}) {
  let running = null;
  let again = false;
  const loop = async () => {
    do {
      again = false;
      try {
        report(null, await run());
      } catch (err) {
        report(err);
      }
    } while (again);
    running = null;
  };
  return {
    request() {
      if (running) again = true;
      else running = loop();
      return running;
    },
    idle: () => running ?? Promise.resolve(),
  };
}
