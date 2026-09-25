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
      ['--reconcile', 'compare the ledger with what OpenRouter billed this key'],
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
      ['--now', 'chatter, series and Warhol\'s shortlist immediately'],
      ['--list', 'list commissions still waiting for a series'],
      ['--json', 'print the posted event as JSON'],
    ],
    load: () => import('./commission.js'),
  },
  {
    name: 'chatter',
    args: '[subject...]',
    description: 'let the superstars talk about subjects (default: those waiting for a series)',
    phase: 6,
    options: [
      ['--only <ids...>', 'just these superstars (e.g. brigid viva)'],
      ['--dry-run', 'cheapest model; marked as dry-run chatter'],
      ['--list', 'show the chatter on the floor instead (latest first)'],
      ['--json', 'print the result as JSON'],
    ],
    load: () => import('./chatter.js'),
  },
  {
    name: 'subjects',
    description: 'list subjects on the floor, with the short ids `silver series` accepts',
    phase: 3,
    options: [
      ['--shift <date>', 'only this shift (default: all)'],
      ['--open', 'only subjects without a series yet (and not retired)'],
      ['--retire <id>', 'take a subject off the table (hidden from latest, --open and the shift)'],
      ['--reason <text>', 'why it is retired (with --retire)'],
      ['--json', 'print as JSON'],
    ],
    load: () => import('./subjects.js'),
  },
  {
    name: 'series',
    args: '<subject>',
    description: 'produce one series of variants for a subject (id, id suffix, or "latest")',
    phase: 3,
    options: [
      ['--variants <n>', 'how many variants (default: series.variants; 2 with --dry-run)'],
      ['--concurrency <n>', 'variants in flight at once (default: series.concurrency)'],
      ['--no-render', 'write the sketches but skip the headless render'],
      ['--dry-run', 'dry-run model and 2 variants'],
      ['--no-chatter', 'leave the floor\'s chatter out of the prompts (for an A/B)'],
      ['--matrix-seed <n>', 'pick the same models and techniques every time for this seed'],
      ['--open', 'open the contact sheet when done'],
      ['--json', 'print the result as JSON'],
    ],
    load: () => import('./series.js'),
  },
  {
    name: 'release',
    args: '[tool]',
    description: 'the Technician announces a changed tool on the floor (p5-template, renderer, contact-sheet)',
    phase: 3,
    options: [
      ['--changes <text>', 'what changed (default: the file\'s recent git log)'],
      ['--force', 'announce even if this version was already released'],
      ['--list', 'list the tools'],
    ],
    load: () => import('./release.js'),
  },
  {
    name: 'shortlist',
    args: '[series]',
    description: 'Warhol shortlists a finished series (id, suffix, "latest", or "unlisted" = newest without a shortlist)',
    phase: 4,
    options: [
      ['--force', 'shortlist again even if the series already has one'],
      ['--dry-run', 'use the dry-run model'],
      ['--json', 'print the shortlist event as JSON'],
    ],
    load: () => import('./shortlist.js'),
  },
  {
    name: 'review',
    description: 'serve the contact sheet on localhost to approve or veto variants',
    phase: 4,
    options: [
      ['--port <n>', 'port (default: review.port, 4747)'],
      ['--no-open', 'don\'t open the browser'],
      ['--no-publish', 'don\'t print and publish approvals in the background'],
    ],
    load: () => import('./review.js'),
  },
  {
    name: 'publish',
    description: 'print approved variants, release editions, rebuild the gallery and deploy it to Vercel',
    phase: 5,
    options: [
      ['--no-deploy', 'build site/ but don\'t deploy'],
      ['--limit <n>', 'print at most n works this time'],
      ['--redeploy', 'deploy even if the canon hasn\'t changed (e.g. after a site change)'],
      ['--json', 'print the result as JSON'],
    ],
    load: () => import('./publish.js'),
  },
  {
    name: 'retitle',
    description: 'correct a released edition\'s title or wall text (Fred Hughes rewrites it unless you give them)',
    phase: 5,
    args: '<edition>',
    options: [
      ['--title <text>', 'the new title'],
      ['--wall <text>', 'the new wall text'],
      ['--note <text>', 'what is wrong, for Fred Hughes when he rewrites it'],
      ['--no-publish', 'don\'t rebuild and redeploy the gallery afterwards'],
    ],
    load: () => import('./retitle.js'),
  },
  {
    name: 'diary',
    args: '[date]',
    description: 'read the Archivist\'s diary entry for a day (default: today)',
    phase: 7,
    options: [
      ['--write', 'have the entry written now, from everything since the last one'],
      ['--force', 'with --write: rewrite an existing entry'],
    ],
    load: () => import('./diary.js'),
  },
  {
    name: 'archive',
    args: '[date]',
    description: 'check that every event\'s artifacts are on disk and write the day\'s manifest',
    phase: 7,
    options: [['--json', 'print the manifest as JSON']],
    load: () => import('./archive.js'),
  },
  {
    name: 'init-record',
    description: 'set up the private backup of floor/, archive/, canon/ and taste.md (a git repo in .record/)',
    phase: 7,
    options: [
      ['--github <name>', 'also create a PRIVATE GitHub repo with gh and push to it (needs --yes)'],
      ['--remote <url>', 'push to an existing remote instead'],
      ['--yes', 'confirm creating the GitHub repository'],
    ],
    load: () => import('./init-record.js'),
  },
  {
    name: 'shift',
    description: 'run (or resume) today\'s shift: scouts, series, Warhol\'s shortlists',
    phase: 8,
    options: [
      ['--dry-run', 'cheapest model, 2 variants per series'],
      ['--again', 'run another round after today\'s shift has ended'],
      ['--no-notify', 'no macOS notification at the end'],
      ['--json', 'print the result as JSON'],
    ],
    load: () => import('./shift.js'),
  },
  {
    name: 'install-schedule',
    description: 'install the daily launchd job that runs `silver shift` at shift.at',
    phase: 8,
    options: [
      ['--print', 'only print the plist; install nothing'],
      ['--force', 'install even if .env has no OPENROUTER_API_KEY'],
    ],
    load: async () => ({ default: (await import('./schedule.js')).install }),
  },
  {
    name: 'uninstall-schedule',
    description: 'remove the daily launchd job',
    phase: 8,
    load: async () => ({ default: (await import('./schedule.js')).uninstall }),
  },
];

export const NOT_IMPLEMENTED_EXIT = 2;
