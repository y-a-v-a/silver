// Deploying the gallery to Vercel with the project's own CLI (a dev dependency).
// The first deploy links site/ to the configured project; later deploys reuse site/.vercel.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

export class DeployError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DeployError';
  }
}

/** The deployment URL: the last https:// URL the CLI printed. */
export function parseDeployUrl(output) {
  const urls = String(output ?? '').match(/https:\/\/[^\s"'<>]+/g);
  return urls?.at(-1) ?? null;
}

/**
 * @param {{config: {root: string, paths: {site: string}, deploy: {project: string}}}} deps
 * @param {{token?: string, run?: Function}} [opts]
 * @returns {Promise<{url: string, linked: boolean}>}
 */
export async function deployVercel({ config }, { token = process.env.VERCEL_TOKEN, run = promisify(execFile) } = {}) {
  if (!token) throw new DeployError('VERCEL_TOKEN is not set (put it in .env)');
  const vercel = join(config.root, 'node_modules', '.bin', 'vercel');
  const site = config.paths.site;
  const common = ['--yes', '--token', token, '--cwd', site];
  const cli = async (args) => {
    try {
      return await run(vercel, [...args, ...common], { cwd: config.root, maxBuffer: 16 * 1024 * 1024 });
    } catch (err) {
      // Never echo the token back in an error message.
      const msg = `${err.stderr || err.message}`.replaceAll(token, '***').trim().split('\n').slice(-3).join(' ');
      throw new DeployError(`vercel ${args[0]} failed: ${msg}`);
    }
  };

  let linked = false;
  try {
    await access(join(site, '.vercel', 'project.json'));
  } catch {
    await cli(['link', '--project', config.deploy.project]);
    linked = true;
  }
  const { stdout, stderr } = await cli(['deploy', '--prod']);
  const url = parseDeployUrl(stdout) ?? parseDeployUrl(stderr);
  if (!url) throw new DeployError('vercel deploy did not print a URL');
  return { url, linked };
}
