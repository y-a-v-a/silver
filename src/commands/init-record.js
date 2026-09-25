// `silver init-record`: set up the private backup of the record (decision 2026-09-24).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfigFromEnv } from '../config.js';
import { initRecord, setRecordRemote, commitRecord, recordStatus, RecordError } from '../record.js';

const run = promisify(execFile);

export default async function initRecordCommand(_args, opts, ctx) {
  const config = await loadConfigFromEnv();
  const r = await initRecord(config);
  ctx.stdout.write(r.created ? `record created in .record/ (first commit ${r.commit?.slice(0, 7)})\n` : 'record already exists in .record/\n');

  if (opts.github) {
    const name = opts.github;
    if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)?$/.test(name)) throw new RecordError(`"${name}" is not a GitHub repository name`);
    if (!opts.yes) {
      ctx.stdout.write(`\nThis would create a PRIVATE GitHub repository "${name}" with gh and push the record to it:\n  gh repo create ${name} --private\nRun again with --yes to do it.\n`);
      return;
    }
    const { stdout } = await run('gh', ['repo', 'create', name, '--private', '--description', 'The Silver Factory record: floor, archive, canon, taste (private).']);
    const url = String(stdout).trim().split('\n').at(-1);
    // SSH, not HTTPS: the scheduled shift runs without a credential helper, and a key works there.
    const { stdout: ssh } = await run('gh', ['repo', 'view', name, '--json', 'sshUrl', '-q', '.sshUrl']);
    await setRecordRemote(config, String(ssh).trim());
    ctx.stdout.write(`created ${url} (private); pushing over SSH\n`);
  } else if (opts.remote) {
    await setRecordRemote(config, opts.remote);
    ctx.stdout.write(`remote set: ${opts.remote}\n`);
  }

  if (opts.github || opts.remote) {
    const c = await commitRecord(config, { message: 'Record: remote added' });
    ctx.stdout.write(c.pushed ? `pushed to ${c.remote}\n` : `not pushed: ${c.error ?? 'no remote'}\n`);
  }
  const s = await recordStatus(config);
  ctx.stdout.write(`\n${s.files} files, ${s.commits} commit(s), head ${s.commit}${s.dirty ? ', uncommitted changes' : ''}\nremote: ${s.remote ?? 'none (the Archivist commits locally; add one with --github <name> --yes or --remote <url>)'}\n`);
}
