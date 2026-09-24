# Silver

A multi-agent studio for internet art, modelled on how Andy Warhol's Factory actually ran. Upstream, production is cheap, noisy and collective. Downstream, there is one narrow point of selection and signature.

Each day the Factory runs a **shift**:

1. **Scouts** pull ready-made subjects from trending lists and news feeds, and you can add your own subjects as commissions.
2. **Superstars**, persona agents, chatter about the subjects.
3. **Studio assistants** turn each subject into a *series* of 12 generative p5.js sketches across several models, temperatures and techniques. The drift between them is kept on purpose.
4. **Warhol**, an agent, shortlists from each series.
5. **You** approve or veto the shortlist on a local contact sheet. Nothing enters the canon without you.
6. The **Printer** signs and deploys the approved works to a static gallery on Vercel, and **Fred Hughes** numbers the editions and publishes the feed.

Everything is recorded, including drafts, chatter and rejects. The record is committed to this repository and feeds back in as raw material.

- **[ARCHITECTURE.md](ARCHITECTURE.md)**: the roles, the floor, a work's lifecycle, and the design principles.
- **[ACTIONS.md](ACTIONS.md)**: the resolved decisions and the phased build plan.

## Status

Early construction. **Phase 0 (scaffold) is done**: config, CLI skeleton, test suite. No agent runs yet. `silver --help` lists every planned command, each tagged with the ACTIONS.md phase that builds it, and a command that isn't built yet exits with code 2.

See [`process-log.jsonl`](process-log.jsonl) for a task-by-task log of the build (`npm run log:list`).

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

All tunables live in [`silver.config.js`](silver.config.js):

- `models`: the studio model pool and a default model per role (OpenRouter slugs)
- `budget`: the daily spend cap ($5)
- `series`: the variant matrix. 12 variants = 3 models × 2 temperatures × 2 techniques.
- `techniques`: the technique menu (grid-repeat, misregistered silkscreen, halftone, …)
- `shift`, `sources`, `review`, `deploy`, `paths`

`npx silver config --check` validates the file and reports every problem at once. Two values can be overridden from the environment: `SILVER_BUDGET_DAILY_USD` and `SILVER_REVIEW_PORT`.

Roles will be defined as markdown files in `roles/`: the body is the role's system prompt, and the frontmatter holds its model and settings. See [ACTIONS.md → Role file format](ACTIONS.md#role-file-format).

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

## Layout

```
silver.config.js   configuration
src/cli.js         the `silver` command; commands are declared in src/commands/registry.js
src/config.js      config loader and validator
src/lib/           shared helpers (append-only JSONL, process log, .env)
bin/               project scripts (setup, process log)
roles/             role system prompts (markdown)
floor/             the event log, one JSONL file per shift (append-only, committed)
archive/           transcripts, every variant including rejects, the Archivist's diary (committed)
canon/             signed works (committed)
site/              the generated gallery (gitignored, rebuilt on publish)
test/              node:test suites
```
