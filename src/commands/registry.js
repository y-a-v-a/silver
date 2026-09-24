// Every `silver` command, including those not built yet. `phase` refers to ACTIONS.md.
// A command with `load` is implemented: the module's default export is
// `async (args, opts, ctx) => void`, where `args` are the positional arguments in order.
// Commands without `load` print which phase delivers them and exit with code 2.

/**
 * @typedef {object} CommandSpec
 * @property {string} name
 * @property {string} [args]            commander argument syntax, e.g. '<text>'
 * @property {string} description
 * @property {number} phase
 * @property {[string, string, (string|boolean)?][]} [options]  [flags, description, default]
 * @property {() => Promise<{default: Function}>} [load]
 */

/** @type {CommandSpec[]} */
export const COMMANDS = [
  {
    name: 'config',
    description: 'print the resolved configuration, or validate it with --check',
    phase: 0,
    options: [
      ['--check', 'only validate; print "ok" or the errors'],
      ['--json', 'print as JSON'],
    ],
    load: () => import('./config.js'),
  },
  {
    name: 'ping',
    args: '<role>',
    description: 'make one LLM call as <role> to test keys, models and the floor',
    phase: 1,
    options: [
      ['--prompt <text>', 'what to say to the role (default: a sound check)'],
      ['--model <slug>', 'override the role\'s model'],
      ['--dry-run', 'use the dry-run model from the config'],
      ['--json', 'print the result as JSON'],
    ],
    load: () => import('./ping.js'),
  },
  {
    name: 'floor',
    description: 'pretty-print the floor (event log)',
    phase: 1,
    options: [
      ['--shift <date>', 'shift date (YYYY-MM-DD) or "all", default today'],
      ['--type <type>', 'only events of this type ("series.*" matches a prefix)'],
      ['--actor <actor>', 'only events by this actor'],
      ['-f, --follow', 'keep printing new events as they arrive'],
      ['--json', 'print raw JSONL'],
    ],
    load: () => import('./floor.js'),
  },
  {
    name: 'cost',
    description: 'spend per role and model against the daily cap',
    phase: 1,
    options: [
      ['--shift <date>', 'shift date (YYYY-MM-DD) or "all", default today'],
      ['--json', 'print the ledger as JSON'],
    ],
    load: () => import('./cost.js'),
  },
  {
    name: 'models',
    description: 'check configured models against OpenRouter: existence, price, image support',
    phase: 1,
    options: [['--json', 'print the audit as JSON']],
    load: () => import('./models.js'),
  },
  {
    name: 'scout',
    description: 'run the scouts on their own and post subject cards',
    phase: 2,
    options: [
      ['--count <n>', 'how many subjects to post (default: shift.subjectsPerShift)'],
      ['--source <name...>', 'only these sources (e.g. hackernews, reddit, rss, rss:bbci.co.uk)'],
      ['--list', 'just list what the sources offer; no model call, nothing posted'],
      ['--no-snapshot', 'skip fetching page snapshots of the picks'],
      ['--dry-run', 'use the dry-run model from the config'],
      ['--json', 'print the full result as JSON'],
    ],
    load: () => import('./scout.js'),
  },
  {
    name: 'commission',
    args: '[text-or-url]',
    description: 'post your own subject; it always gets a series in the next shift',
    phase: 2,
    options: [
      ['--why <note>', 'your reason: why it is a ready-made'],
      ['--no-annotate', 'skip the Scout\'s notes (why, image, sensitive flag)'],
      ['--now', 'run a mini-shift for this subject immediately (needs phase 3; queues for now)'],
      ['--list', 'list commissions still waiting for a series'],
      ['--json', 'print the posted event as JSON'],
    ],
    load: () => import('./commission.js'),
  },
  { name: 'series', args: '<subject-id>', description: 'produce one series of variants for a subject', phase: 3 },
  { name: 'release', args: '<tool>', description: 'announce a changed Technician tool on the floor', phase: 3 },
  { name: 'review', description: 'open the contact sheet to approve or veto Warhol\'s picks', phase: 4 },
  { name: 'publish', description: 'rebuild the gallery site and redeploy it to Vercel', phase: 5 },
  {
    name: 'shift',
    description: 'run (or resume) today\'s shift',
    phase: 8,
    options: [['--dry-run', 'cheapest model, 2 variants per series']],
  },
  { name: 'install-schedule', description: 'install the daily launchd job', phase: 8 },
  { name: 'uninstall-schedule', description: 'remove the daily launchd job', phase: 8 },
];

export const NOT_IMPLEMENTED_EXIT = 2;
