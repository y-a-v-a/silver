// The supervisor keeps the admin running and running on the code as it is: it starts the
// server as a child process, watches the code, and restarts the child when a file changes.
// Before it does, it checks that the new code parses and the config loads, so a half-finished
// save never takes the page away: the old server keeps running and says what's wrong. If the
// child crashes at boot anyway, the supervisor serves a small page with the error, and tries
// again as soon as a file changes. Markdown and settings don't come through here at all: every
// process reads those fresh.
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, relative } from 'node:path';

const CHECK_TIMEOUT_MS = 20_000;
const STOP_TIMEOUT_MS = 12_000;

/** Which changed paths mean a restart: code, config, dependencies, secrets. Not roles or data. */
export function isCodeChange(rel) {
  const name = rel.split(/[\\/]/).join('/');
  if (name === 'silver.config.js' || name === 'package.json' || name === '.env') return true;
  return name.startsWith('src/') && /\.(js|mjs|json|html)$/.test(name) && !name.startsWith('src/admin/assets/');
}

/** Run a command; resolve with its output and whether it succeeded. */
function run(cmd, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), CHECK_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, out: out.trim() });
    });
    child.on('error', (err) => resolve({ ok: false, out: err.message }));
  });
}

/**
 * Parses a module without running it. `node --check` won't do: it lets ES modules with syntax
 * errors through. Compiling a SourceTextModule catches them, and evaluates nothing.
 */
const PARSE_MODULE = `
import { readFileSync } from 'node:fs';
import { SourceTextModule } from 'node:vm';
const file = process.argv[1];
try {
  new SourceTextModule(readFileSync(file, 'utf8'), { identifier: file });
} catch (err) {
  console.error(err.stack ?? err.message);
  process.exit(1);
}
`;

/**
 * Does this code stand up? Every changed JS file parses, and the config loads.
 * @param {{root: string, cli: string, files: string[], env: NodeJS.ProcessEnv}} o
 * @returns {Promise<string[]>} problems
 */
export async function preflight({ root, cli, files, env }) {
  const problems = [];
  for (const file of files.filter((f) => /\.m?js$/.test(f))) {
    const r = await run(process.execPath, ['--experimental-vm-modules', '--no-warnings', '--input-type=module', '-e', PARSE_MODULE, join(root, file)], { cwd: root, env });
    // A file deleted in the same save has nothing to parse.
    if (!r.ok && !/ENOENT/.test(r.out)) problems.push(`${file}: ${r.out.split('\n').slice(0, 6).join('\n')}`);
  }
  if (!problems.length) {
    const r = await run(process.execPath, [cli, 'config', '--check'], { cwd: root, env });
    if (!r.ok) problems.push(r.out.split('\n').slice(0, 8).join('\n'));
  }
  return problems;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * @param {object} o
 * @param {string} o.root            directory to watch
 * @param {string} o.cli             the silver CLI
 * @param {string[]} o.childArgs     how to start the server
 * @param {number} o.port
 * @param {NodeJS.ProcessEnv} [o.env]
 * @param {(line: string) => void} [o.log]
 * @param {number} [o.debounceMs]
 */
export function createSupervisor({ root, cli, childArgs, port, env = process.env, log = () => {}, debounceMs = 400 }) {
  let child = null;
  let stopping = false;
  let restartWanted = false;
  let fallback = null;
  let lastCrash = null;
  let crashes = 0;
  let timer = null;
  let changed = new Set();
  let exited = null;
  let starting = false;
  let checking = false;
  let watchingSince = 0;
  const watchers = [];

  const tell = (message) => {
    try {
      child?.connected && child.send(message);
    } catch {
      // The child is on its way out; it will hear the news when it comes back.
    }
  };

  function closeFallback() {
    return new Promise((resolve) => {
      if (!fallback) return resolve();
      fallback.close(() => resolve());
      fallback.closeAllConnections?.();
      fallback = null;
    });
  }

  /** When the server can't even boot, the address still answers, with what went wrong. */
  function openFallback() {
    if (fallback) return;
    fallback = createServer((_req, res) => {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Refresh: '5' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Silver: down</title><style>body{background:#0a0a09;color:#ece8df;font:14px/1.5 ui-monospace,Menlo,monospace;padding:32px;max-width:900px}pre{white-space:pre-wrap;color:#ef4a30}</style><h1>The admin doesn't start</h1><p>Shifts are not affected. As soon as you save a fix, it tries again and this page goes away.</p><pre>${esc(lastCrash ?? 'unknown error')}</pre>`);
    });
    fallback.on('error', () => {
      fallback = null;
    });
    fallback.listen(port, '127.0.0.1');
  }

  async function start() {
    // One child at a time: a second one would only find the port taken.
    if (starting || stopping) return;
    starting = true;
    await closeFallback();
    starting = false;
    if (stopping || child) return;
    let stderr = '';
    const c = spawn(process.execPath, [cli, ...childArgs], { cwd: root, env, stdio: ['ignore', 'inherit', 'pipe', 'ipc'] });
    child = c;
    const startedAt = Date.now();
    c.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-6000);
      process.stderr.write(d);
    });
    c.on('message', (m) => {
      if (m?.type === 'restart') restart('asked to from the page');
      if (m?.type === 'ready') crashes = 0;
    });
    exited = new Promise((resolve) => {
      c.on('exit', (code, signal) => {
        if (child === c) child = null;
        resolve();
        if (stopping) return;
        if (restartWanted) {
          restartWanted = false;
          return void start();
        }
        // It wasn't asked to stop. Back off, so a crash loop doesn't spin the machine.
        lastCrash = stderr || `exit code ${code}${signal ? `, signal ${signal}` : ''}`;
        crashes = Date.now() - startedAt > 30_000 ? 1 : crashes + 1;
        log(`admin stopped unexpectedly (${code ?? signal})`);
        if (crashes >= 3) {
          log('it keeps crashing: waiting for a file to change');
          return openFallback();
        }
        setTimeout(() => {
          if (!stopping && !child) start();
        }, 500 * crashes).unref();
      });
    });
  }

  function restart(why) {
    if (stopping || restartWanted) return;
    log(`restarting: ${why}`);
    if (!child) return void start();
    restartWanted = true;
    const c = child;
    c.kill('SIGTERM');
    const force = setTimeout(() => c.kill('SIGKILL'), STOP_TIMEOUT_MS);
    force.unref();
    c.once('exit', () => clearTimeout(force));
  }

  async function onChange() {
    if (stopping || !changed.size) return;
    // A save during a check waits for it: the check that counts is the one on the newest code.
    if (checking) {
      timer = setTimeout(onChange, debounceMs);
      return;
    }
    checking = true;
    const files = [...changed];
    changed = new Set();
    try {
      const problems = await preflight({ root, cli, files, env });
      if (stopping) return;
      if (problems.length) {
        log(`not restarting, the code doesn't stand up:\n${problems.join('\n')}`);
        tell({ type: 'preflight', ok: false, problems });
        return;
      }
      tell({ type: 'preflight', ok: true });
      crashes = 0;
      restart(files.join(', '));
    } finally {
      checking = false;
    }
  }

  async function noticed(rel) {
    if (!rel || !isCodeChange(rel)) return;
    // macOS reports changes from just before the watch began too; those are already running.
    const mtime = await stat(join(root, rel)).then((st) => st.mtimeMs, () => Infinity);
    if (mtime <= watchingSince) return;
    changed.add(rel);
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  }

  return {
    async start() {
      watchingSince = Date.now();
      await start();
      const dirs = [['src', true], ['.', false]];
      for (const [dir, recursive] of dirs) {
        const w = watch(join(root, dir), { recursive }, (_event, name) => noticed(dir === '.' ? name : name && relative('.', join(dir, name))));
        w.on('error', (err) => log(`watching ${dir}: ${err.message}`));
        watchers.push(w);
      }
    },
    restart,
    async stop() {
      stopping = true;
      clearTimeout(timer);
      for (const w of watchers) w.close();
      await closeFallback();
      if (child) {
        child.kill('SIGTERM');
        const force = setTimeout(() => child?.kill('SIGKILL'), STOP_TIMEOUT_MS);
        await exited;
        clearTimeout(force);
      }
    },
  };
}
