# Silver

A multi-agent studio for internet art, modelled on how Andy Warhol's Factory actually ran. Upstream, production is cheap, noisy and collective. Downstream, there is one narrow point of selection and signature.

Each day the Factory runs a **shift**:

1. **Scouts** pull ready-made subjects from trending lists and news feeds, and you can add your own subjects as commissions.
2. **Superstars**, persona agents, chatter about the subjects.
3. **Studio assistants** turn each subject into a *series* of 12 generative p5.js sketches across several models, temperatures and procedures. Each variant also draws a dare card and takes one superstar line literally as its brief. The drift between them is kept on purpose.
4. **Warhol**, an agent, shortlists from each series, and sends his first pick back to its maker for a **second pull**, pushed further.
5. **You** approve or veto the shortlist in the local admin. Nothing enters the canon without you.
6. The **Printer** signs and deploys the approved works to a static gallery on Vercel, and **Fred Hughes** numbers the editions and publishes the feed.

The Factory works the way Warhol's did, but it doesn't look like his: no pop-art pastiche. The procedures come from today's cheap image machines and from the hand (scratched film, a failing inkjet, a fax arriving, compression rot, a Rorschach blot, asemic handwriting), aiming for work that is strange, scratchy and still beautiful.

Everything is recorded, including drafts, chatter and rejects, and the record feeds back in as raw material. The record lives on local disk and is **not committed to git**: this repository holds code, roles and config only.

- **[ARCHITECTURE.md](ARCHITECTURE.md)**: the roles, the floor, a work's lifecycle, and the design principles.
- **[ACTIONS.md](ACTIONS.md)**: the resolved decisions and the phased build plan.

## Status

**All phases (0–10) are built.** Phase 9 (2026-10-23) replaced the pop-art studio with a contemporary one, and Phase 10 (2026-11-04) added the admin. The gallery isn't live on Vercel yet.
- The floor (the event log) records everything.
- The OpenRouter client runs as any role, archives transcripts and costs every call.
- The daily budget cap is enforced.
- The Scouts pull ready-made subjects from Google Trends, Hacker News, Reddit and news RSS, and you can commission your own.
- The Studio assistants turn a subject into a series of 12 p5.js sketches across models, temperatures and procedures. Every variant draws a card from the dare deck and takes one superstar line literally as its brief, and names what it made in a `// WORK:` line. Each sketch is rendered headless and checked for errors and blank canvases, and every series gets a contact sheet.
- Warhol shortlists each series from its screenshots, and you approve or veto on a local review page. Every decision goes into `taste.md`, which Warhol reads next time. His first pick goes back to the assistant who made it for a second pull (`v13`), which you review next to the first.
- Four Superstars (Brigid, Ondine, Viva, and Nico, who talks only in images) gossip about the day's subjects on a cheap model. Their chatter goes into the assistants' prompts, Warhol's review and the contact sheet, and now and then one of them pushes a subject onto the floor.
- `silver shift` runs the whole day (scouts → superstars → series → shortlists → Archivist) and can be scheduled with launchd.
- Every approval is printed into the canon (signed, print-checked), given an edition number, an English title and wall text by Fred Hughes, and published to a static gallery with an Atom feed, deployed to Vercel.

- The Archivist checks every event's artifacts after a shift, writes a manifest and a diary entry (Andy's morning call to Pat Hackett), and commits the record (floor, archive, canon, taste) to its own git repository in `.record/`. The Scout treats the reject pile and the diary as one more source.

`silver --help` lists every command, each tagged with the ACTIONS.md phase that built it.

See [`process-log.jsonl`](process-log.jsonl) for a task-by-task log of the build (`npm run log:list`).

## The admin

```sh
npx silver admin           # http://silver.localhost:4747 (http://127.0.0.1:4747 works too)
npx silver install-admin   # keep it running: starts at login, comes back if it dies
```

The Factory's back room, on this machine only. It needs no login: it binds to `127.0.0.1`, refuses other `Host` headers and origins, and serves the sketches in a sandbox, because a model wrote them.

| Page | What it's for |
|---|---|
| **Today** | What's wrong first (no credit, thin series, a failed backup), the day's series and spend, what's next. Run the shift or a dry run. |
| **Review** | The contact sheet: film strips per series, a lightbox, and the keyboard (`j` `k` move, `enter` look, `a` approve, `x` veto, `p` play). Send a variant back with a note, ask Warhol to look, clear the backlog by date. |
| **Subjects** | Commission something, pin anything to the front of the queue, say a line on the floor (it may become a brief), retire a subject, or make a series now with procedures, hands, temperatures, a dare or a note pinned. |
| **Studio** | Steering: a standing direction to the Scout, the superstars, the assistants and Warhol; the shift's pace and budget; the matrix; the hands; the procedures (bench, favour, rewrite, add); the dare deck; the sources. What the record says about each sits next to it. |
| **Souls** | The role files. Rewrite a soul or its settings, audition a superstar, cast a new one, bench one. It checks as you type, keeps every version it replaces, and won't overwrite an edit made in your text editor. |
| **Taste** | Your words at the top of `taste.md`, your decisions, and what they add up to. |
| **Floor, Canon, Diary, Gallery** | The record to read: the floor live, the editions and their labels, Andy's diary, the gallery exactly as it would deploy. Any model call can be read in full. |
| **Jobs, System** | What's running and its log; keys, schedule, pause, the record, the money, model checks and restart. |

### What updates by itself

- **Souls, `direction.md`, `taste.md`, settings:** nothing to restart. Every shift and job is a fresh process that reads them when it starts, and the admin reads them on every request. A save counts from the next shift or job; one already running finishes as it began.
- **Code, `silver.config.js`, `package.json`, `.env`:** the admin's supervisor watches them. On a save it checks that the code parses and the config loads, then restarts the server, and open pages reload themselves unless you're in the middle of typing. If the code doesn't stand up, the old server keeps running and says what's wrong; if it can't boot at all, the address answers with the error until a save fixes it. Jobs are separate processes, so a restart doesn't touch them.

### What can't be edited from the browser, on purpose

API keys (`.env`; never shown), the floor, archive and signatures (append-only), paths, the admin's port and the deploy provider (moving them could strand the record or lock you out), the code, and what the code relies on in a role file (`id`, `output`, `vision`, `reads`, `emits`). No setting can turn off the human gate. The System page has this list too.

Settings go in `studio.json`, over `silver.config.js`: the config file has comments that record why things are the way they are, so a browser doesn't rewrite it. `studio.json` and `direction.md` stay out of git and go into the record, like `taste.md`. Every change is an event on the floor, so the diary hears about it.

## Commands

```sh
npx silver admin [--no-supervise] # the back room above (`silver review` opens it at the contact sheet)
npx silver install-admin          # keep it running with launchd (uninstall-admin removes it)
npx silver audition <superstar> [subject]  # hear a persona; nothing reaches the floor but the cost
npx silver config [--check]      # resolved configuration / validate it
npx silver models                # every configured model: on OpenRouter? price? can it see images?
npx silver ping technician       # one real call as a role: prints the reply, cost and transcript path
npx silver floor [-f]            # today's events (or --shift YYYY-MM-DD|all, --type, --actor, --json)
npx silver cost                  # spend by role and by model against the $5/day cap
npx silver scout                 # post today's subject cards (--list to just browse the sources)
npx silver commission "<text|URL>" [--why ...] [--now]   # bring your own subject; --now makes its series right away
npx silver subjects [--open]     # subjects with short ids
npx silver series <id|latest>    # 12 variants + screenshots + a contact sheet (--dry-run: 2 cheap ones)
npx silver release <tool>        # the Technician announces a changed tool
npx silver shortlist [series]    # Warhol picks from a finished series (default: the newest without a shortlist)
npx silver pull [series]         # a second pull of Warhol's first pick (or --variant v03 --note "bigger"), pushed further
npx silver shift [--dry-run]     # the whole day: scouts, superstars, series (pins and commissions first), shortlists, Archivist (--force runs it even when paused)
npx silver chatter [subject]     # the superstars talk (default: today's waiting subjects); --list shows the floor's chatter
npx silver series <id> --no-chatter --matrix-seed 7   # an A/B: the same matrix without the floor's chatter
npx silver series <id> --technique x-ray --model a/b --temperature 1.2 --dare "..." --note "..."   # steer one series
npx silver diary [date] [--write] # the Archivist's diary entry
npx silver archive [date]        # check every event's artifacts on disk; write the day's manifest
npx silver init-record           # the private record in .record/ (--github <name> --yes to add a private GitHub remote)
npx silver scout --source archive  # the Scout looks only at the reject pile and the diary
npx silver publish [--no-deploy] # print approvals, release editions, rebuild site/, deploy to Vercel
npx silver publish --redeploy    # deploy even when the canon hasn't changed
npm run preview                  # build site/ exactly as it would deploy, and serve it on localhost:3000
npx silver retitle 16 --note "…" # correct an edition's label (or --title/--wall by hand); same number
npx silver cost --reconcile      # the ledger against what OpenRouter actually billed
npx silver subjects --retire <id> --reason "..."   # take a subject off the table
```

## Running the daily shift

1. Put your key in `.env`: `OPENROUTER_API_KEY=...`. The scheduled job doesn't see your shell's variables.
2. Try a cheap round first: `npx silver shift --dry-run`.
3. Install the schedule: `npx silver install-schedule` (`--print` shows the launchd plist first).

The shift runs daily at `shift.at` (09:00) and sends a macOS notification when it's done. If the Mac is asleep at that time, it runs when the Mac wakes; if the Mac is off, that day is skipped. Logs go to `archive/logs/`. Running `silver shift` again the same day does nothing (`--again` runs another round), and an interrupted shift resumes where it stopped. A dry run never counts as the real shift. `npx silver uninstall-schedule` removes the job.

Decisions taken so far are in the table at the top of [ACTIONS.md](ACTIONS.md#decisions-resolved); new open questions are collected at its bottom.

## Requirements

- Node.js 24 or newer
- macOS, for the launchd schedule. Everything else is cross-platform.
- An [OpenRouter](https://openrouter.ai/keys) API key and a [Vercel](https://vercel.com/account/tokens) token (not used until later phases)

## Getting started

```sh
git clone git@github.com:y-a-v-a/silver.git
cd silver
npm run setup          # npm deps, headless Chromium, .env from .env.example
npx silver --help      # or: npm run silver -- --help
npx silver config      # show the resolved configuration
```

Fill in `.env` with your keys. Existing shell environment variables take precedence over `.env`.

## Configuration

All tunables live in [`silver.config.js`](silver.config.js), and most can be changed from the admin's Studio page, which writes them to `studio.json` on top of it:

- `models`: the studio model pool and a default model per role (OpenRouter slugs)
- `budget`: the daily spend cap ($5)
- `series`: the variant matrix. 12 variants = 3 models × 2 temperatures × 2 techniques.
- `techniques`: the procedure menu (scratch film, inkjet failure, fax transmission, compression rot, …)
- `dares`: the dare deck, one card per variant
- `series.secondPulls`: how many of Warhol's picks per series get a second pull (default 1)
- `shift`, `sources`, `review`, `deploy`, `paths`

`npx silver config --check` validates the file and reports every problem at once. `npx silver models` checks the model slugs against OpenRouter's live catalogue.

Environment variables:

| Variable | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | Required for any LLM call |
| `VERCEL_TOKEN` | Deploys (Phase 5) |
| `SILVER_BUDGET_DAILY_USD` | Overrides `budget.dailyUsd` |
| `SILVER_REVIEW_PORT` | Overrides `review.port` |
| `SILVER_ROOT` | Directory that `paths` resolve against (default: this repo) |
| `SILVER_CONFIG` | Alternative config file |
| `OPENROUTER_BASE_URL` | Alternative API endpoint (used by the tests' mock server) |

Roles are markdown files in `roles/`: the body is the role's system prompt, and the frontmatter holds its model and settings (temperature, `max_tokens`, `output: json|text`, `vision`, `reasoning`). Files in `roles/superstars/` are superstars. See [ACTIONS.md → Role file format](ACTIONS.md#role-file-format).

## npm scripts

| Script | What it does |
|---|---|
| `npm run setup` | One-shot setup for a fresh clone (`bin/setup.sh`) |
| `npm run silver -- <cmd>` | Run the CLI |
| `npm test` | Full test suite (`node:test`), including a headless Chromium smoke test |
| `npm run test:fast` | Same, but skips the browser test |
| `npm run test:watch` | Tests in watch mode |
| `npm run check` | Validate the config, then run the fast tests |
| `npm run log -- --phase N --task "…" --summary "…"` | Append an entry to `process-log.jsonl` |
| `npm run log:list [-- --phase N]` | Print the process log |
| `npm run admin` | Start the admin |

## Layout

```
silver.config.js   configuration
src/cli.js         the `silver` command; commands are declared in src/commands/registry.js
src/config.js      config loader and validator
src/floor.js       the event log: append, read, tail
src/events.js      event types and envelope validation
src/roles.js       role file loader and {{placeholder}} rendering
src/llm.js         OpenRouter client: transcripts, costing, retries, JSON repair
src/budget.js      daily ledger and caps
src/pricing.js     model prices and capabilities from OpenRouter
src/factory.js     wires the parts together for commands
src/sources/       scout sources: Google Trends, Hacker News, Reddit, RSS, and the archive (rejects, diary)
src/agents/        scouts, commissions, superstars, studio assistants, technician, Warhol, the second pull, review, retire, printer, Fred Hughes, archivist
src/shift.js       the daily shift
src/schedule.js    the launchd job
src/reconcile.js   ledger vs OpenRouter billing
src/canon.js       the canon (signed works), derived from the floor
src/publish.js     print → editions → site → deploy
src/site.js        the static gallery and feed
src/deploy.js      Vercel
src/record.js      the private record: a git repo in .record/ over floor/, archive/, canon/, taste.md
src/tools/         the Technician's workbench: p5 template, headless renderer, contact sheet
src/admin/         `silver admin`: the server, its pages and assets, souls, jobs, the supervisor
src/settings.js    studio.json: the owner's settings over the config file
src/lib/           shared helpers (append-only JSONL, process log, .env, formatting, dedupe, page snapshots)
bin/               project scripts (setup, process log)
roles/             role system prompts (markdown); roles/superstars/ holds the personas
direction.md       what the human is after right now, per audience (local only)
studio.json        the owner's settings, edited from the admin (local only)
floor/             the event log, one JSONL file per shift (append-only, local only)
archive/           transcripts, every variant including rejects, the diary, daily manifests, job logs, revisions of everything the admin overwrites (local only)
canon/             signed works (local only; published through the site)
site/              the generated gallery (gitignored, rebuilt on publish)
test/              node:test suites
```

## Licence

- **Code** (everything in this repository): [MIT](LICENSE)
- **Artworks** (the signed works the Factory publishes): [CC BY 4.0](LICENSE-ARTWORKS.md). This covers the Factory's own contribution only, not the third-party subjects, brands or likenesses a work may depict.

