// End to end: the real CLI against a mock OpenRouter server, in a temporary SILVER_ROOT.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, readdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roleFile, completion, mockOpenRouter } from './helpers.js';

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

let mock;
let baseUrl;
let requests;
const defaultReply = () => completion('Wires, lights, projector. That is me.', { cost: 0.00042, model: 'anthropic/claude-sonnet-5' });

before(async () => {
  mock = await mockOpenRouter({ reply: defaultReply });
  ({ baseUrl, requests } = mock);
});

after(() => mock.close());

async function tmpRoot() {
  const root = await mkdtemp(join(tmpdir(), 'silver-cli-'));
  await mkdir(join(root, 'roles', 'superstars'), { recursive: true });
  await writeFile(join(root, 'roles', 'technician.md'), roleFile('technician', { reasoning: 'off' }, 'You are the Technician. Tool: {{tool}}.'));
  await writeFile(join(root, 'roles', 'superstars', 'brigid.md'), roleFile('brigid', {}, 'You are Brigid.'));
  return root;
}

async function silver(root, args, env = {}) {
  const fullEnv = { ...process.env, SILVER_ROOT: root, OPENROUTER_BASE_URL: baseUrl, OPENROUTER_API_KEY: 'test-key', ...env };
  try {
    const { stdout, stderr } = await exec(process.execPath, [CLI, ...args], { env: fullEnv });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
}

test('ping makes one call, prints the reply and records cost + transcript (Phase 1 "done when")', async () => {
  const root = await tmpRoot();
  const { code, stdout, stderr } = await silver(root, ['ping', 'technician']);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /^Wires, lights, projector\. That is me\./);
  assert.match(stdout, /anthropic\/claude-sonnet-5 via TestProvider: \$0\.00042/);

  const req = requests.at(-1);
  assert.equal(req.auth, 'Bearer test-key');
  assert.equal(req.body.model, 'anthropic/claude-sonnet-5'); // config default for technician
  assert.deepEqual(req.body.reasoning, { enabled: false });
  assert.equal(req.body.messages[0].content, 'You are the Technician. Tool: [tool].'); // lenient render

  const [floorFile] = await readdir(join(root, 'floor'));
  const [event] = (await readFile(join(root, 'floor', floorFile), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(event.type, 'cost.recorded');
  const transcript = JSON.parse(await readFile(join(root, event.payload.transcript), 'utf8'));
  assert.equal(transcript.id, event.id);
});

test('ping options: --model, --dry-run, --prompt, --json', async () => {
  const root = await tmpRoot();
  let r = await silver(root, ['ping', 'technician', '--model', 'openai/gpt-6-luna', '--prompt', 'Status?', '--json']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(requests.at(-1).body.model, 'openai/gpt-6-luna');
  assert.equal(requests.at(-1).body.messages.at(-1).content, 'Status?');
  assert.equal(JSON.parse(r.stdout).usd, 0.00042);

  r = await silver(root, ['ping', 'brigid', '--dry-run']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(requests.at(-1).body.model, 'qwen/qwen3.8-flash'); // models.dryRun
});

test('ping failures are one-line errors, not stack traces', async () => {
  const root = await tmpRoot();
  let r = await silver(root, ['ping', 'andy']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^silver: invalid roles:\n {2}- no role "andy"/);

  r = await silver(root, ['ping', 'technician'], { OPENROUTER_API_KEY: '' });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /OPENROUTER_API_KEY is not set/);
  assert.doesNotMatch(r.stderr, /at .*\.js:\d+/);

  mock.state.reply = () => ({ status: 400, body: { error: { code: 400, message: 'model not found' } } });
  r = await silver(root, ['ping', 'technician']);
  mock.state.reply = defaultReply;
  assert.equal(r.code, 1);
  assert.match(r.stderr, /model not found/);
  const floor = await silver(root, ['floor', '--type', 'llm.failed']);
  assert.match(floor.stdout, /llm\.failed\s+technician\s+anthropic\/claude-sonnet-5: .*model not found/);
});

test('floor prints events, filters, and --json emits JSONL', async () => {
  const root = await tmpRoot();
  await silver(root, ['ping', 'technician']);
  await silver(root, ['ping', 'brigid']);

  let r = await silver(root, ['floor']);
  assert.equal(r.code, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\d\d:\d\d:\d\d {2}cost\.recorded\s+technician\s+\$0\.00042 {2}anthropic\/claude-sonnet-5 {2}100 in \/ 20 out$/);
  assert.match(lines[1], /superstar\.brigid/);

  r = await silver(root, ['floor', '--actor', 'superstar.brigid', '--json']);
  const events = r.stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map((e) => e.actor), ['superstar.brigid']);

  r = await silver(root, ['floor', '--shift', '1999-01-01']);
  assert.match(r.stderr, /the floor is quiet \(shift 1999-01-01\)/);
});

test('cost summarises spend by role and model, with chatter separate', async () => {
  const root = await tmpRoot();
  await silver(root, ['ping', 'technician']);
  await silver(root, ['ping', 'technician']);
  await silver(root, ['ping', 'brigid']);

  const r = await silver(root, ['cost']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /3 calls, 300 tokens in \/ 60 out/);
  assert.match(r.stdout, /spent {4}\$0\.00126 of \$5\.00 \(0\.0%\)/);
  assert.match(r.stdout, /chatter {2}\$0\.00042 of \$0\.50/);
  assert.match(r.stdout, /by role\n {2}technician\s+2 calls/);

  const json = JSON.parse((await silver(root, ['cost', '--json'])).stdout);
  assert.equal(json.calls, 3);
  assert.equal(json.byRole.brigid.calls, 1);
  assert.equal(json.cap, 5);
});

test('the budget cap stops a ping before it reaches the API', async () => {
  const root = await tmpRoot();
  await silver(root, ['ping', 'technician']);
  const before = requests.length;
  const r = await silver(root, ['ping', 'technician'], { SILVER_BUDGET_DAILY_USD: '0.0004' });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /daily budget exhausted/);
  assert.equal(requests.length, before);
});

test('commission --now annotates, then produces and renders a series right away', { skip: process.env.SILVER_SKIP_BROWSER ? 'SILVER_SKIP_BROWSER is set' : false, timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'silver-now-'));
  await cp(fileURLToPath(new URL('../roles', import.meta.url)), join(root, 'roles'), { recursive: true });
  mock.state.reply = (body) => {
    const system = body.messages[0].content;
    if (/annotating a commission|This time you did not find the subject/.test(system)) {
      return completion(JSON.stringify({ why: 'A parking ticket everyone gets.', image: 'Twelve tickets.', sensitive: { flag: false } }), { cost: 0.001 });
    }
    if (system.startsWith('You are Andy Warhol')) return completion(JSON.stringify({ picks: [{ variant: 'v03', note: 'Yellow. Fine.' }], rejects: 'Same.' }), { cost: 0.01 });
    return completion('```js\nfunction setup(){ createCanvas(SILVER.width, SILVER.height); noLoop(); }\nfunction draw(){ background(250,220,0); fill(0); for (let i=0;i<4;i++) rect(90+i*240, 300, 180, 480); }\n```', { cost: 0.002 });
  };
  try {
    const r = await silver(root, ['commission', 'Twelve identical parking tickets', '--now']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /scout: A parking ticket everyone gets\./);
    assert.match(r.stdout, /series [0-9A-Z]{26}: 12\/12 produced, 12 calls, \$0\.02\d*/);
    assert.match(r.stderr, /--now: producing the series, then Warhol's shortlist/);
    assert.match(r.stdout, /Warhol picked v03; review it with: silver review/);
    const [floorFile] = await readdir(join(root, 'floor'));
    const events = (await readFile(join(root, 'floor', floorFile), 'utf8')).trim().split('\n').map(JSON.parse);
    const subject = events.find((e) => e.type === 'subject.posted');
    const started = events.find((e) => e.type === 'series.started');
    assert.equal(started.payload.subjectId, subject.id);
    assert.equal(events.filter((e) => e.type === 'variant.produced').length, 12);
    const shortlist = events.find((e) => e.type === 'shortlist.proposed');
    assert.equal(shortlist.payload.seriesId, started.id);
    const warholCall = mock.requests.find((q) => q.body.messages[0].content.startsWith('You are Andy Warhol'));
    assert.equal(warholCall.body.messages[1].content.filter((c) => c.type === 'image_url').length, 12);
  } finally {
    mock.state.reply = defaultReply;
  }
});
