# Silver: actions

The build plan for the Silver Factory in Node.js, derived from [ARCHITECTURE.md](ARCHITECTURE.md). Work top to bottom; each phase ends in something runnable.

## Decisions (resolved)

| Question | Decision |
|---|---|
| Who is Warhol? | A **Warhol agent shortlists and signs; the human holds a veto**. Nothing enters the canon without human approval. |
| Medium | **Generative p5.js sketches**, one self-contained HTML file per variant |
| Runtime | **OpenRouter API** (OpenAI-compatible `/chat/completions`) via native `fetch`, so every role can run on a different model |
| Tempo | **One daily shift**, triggered by macOS `launchd` |
| User input | **Two paths**: `silver commission "<text or URL>"` for the human's own subjects, plus autonomous scouting during the shift |
| Scout sources | **Trending lists** (Google Trends RSS, Hacker News, Reddit r/all) and **news RSS** (configurable feed list) |
| Veto UI | **Local web contact sheet** (`silver review`) showing live sketches, Warhol's picks and notes, with approve/veto buttons |
| Deploy | **Vercel**, static gallery, `vercel deploy --prod` |
| Series size | **12 variants per series** from roughly 3 models × 2 temperatures × 2 techniques |
| Budget | **$5/day hard cap** on OpenRouter spend |
| v1 scope | Superstars are live. The Technician has a role file, but its tools are hand-built in v1. |
| Fred Hughes | **Numbered editions + RSS/Atom feed**, plus a title and wall text for each work |
| Warhol's taste | **Learns from vetoes** through an append-only `taste.md` |
| Archivist | **Deterministic code** that records everything, plus an **end-of-shift LLM diary** (Pat Hackett style) |
| Data in git | **Kept out** (decided 2026-09-24). `floor/`, `archive/`, `canon/` and `taste.md` stay on local disk, gitignored. The repo holds code, roles, config and docs. |
| Sensitive subjects | **Exclude + flag** (2026-09-24). The Scout may pick disasters, but never suicide, children or named private victims. Other sensitive subjects carry a `sensitive` flag and show a warning on the contact sheet. |
| Real people's likenesses | **Case by case at the veto** (2026-09-24). No rule in the roles; the human decides per work. |
| Backup of the local record | **Private data repo** (2026-09-24). A separate private GitHub repo (e.g. `silver-record`) that the Archivist commits to and pushes after each shift. |
| Licence | **MIT for the code, CC BY 4.0 for the artworks** (2026-09-24). |
| Source language / region | **Keep the mix** (2026-09-24): English + Dutch feeds, Google Trends `US`. |
| Gallery language | **English** (2026-09-24). Titles and wall text are English, including for Dutch subjects. |
| Commissions vs the series cap | **Fill the slots, the rest waits** (2026-09-24). Commissions take `seriesPerShift` slots first (oldest first); the rest roll over to the next shift. `--now` is for anything urgent. |
| `commission --now` | **Chatter + series + shortlist** (2026-09-24). The superstars react, the assistants produce the series, and Warhol shortlists it, so the work lands on the contact sheet right away. |
| Scout annotates commissions | **Yes, never overwriting the human's `--why`** (2026-09-24). One cheap Scout call adds its own `why` and `image`, marked as the Scout's. |
| Repeat subjects | **7-day window** (2026-09-24). A scouted subject may return after 7 days (configurable); commissions may always repeat. |
| Reddit | **Keep r/all for now** (2026-09-24). Switch to curated subreddits if NSFW shows up. |
| Studio pool: DeepSeek | **Replace with Qwen 3.8 Flash** (2026-09-25). DeepSeek v4.1 Flash produced 2/12; its providers ignore every thinking limit. Verify Qwen with `silver models` and a dry-run series first. |
| Studio pool: Sonnet | **Keep in rotation** (2026-09-25), despite ~$0.056 per variant (6–13× the others). |
| p5 version | **Stay on p5 1.11.13** for v1 (2026-09-25). Revisit 2.x after v1. |
| Spend missing from the ledger | **`silver cost --reconcile`** (2026-09-25): compare the ledger with OpenRouter's `/api/v1/key` usage and report the gap, also in the end-of-shift summary. |
| Subjects from before the exclusion rule | **Retire event** (2026-09-25): a new `subject.retired` event and `silver subjects --retire <id>`. Retired subjects are hidden from `latest`, `--open` and the shift. |
| Technique adherence | **Drift, and Warhol notes it** (2026-09-25). Off-technique variants are kept, and Warhol's review mentions it; the human judges at the veto. |
| Screenshots per variant for Warhol | **1 per variant** (2026-09-25): seed 1, about 12 images per review. |
| What gets published | **Every approval** (2026-09-25). Each approved variant becomes a signed, numbered edition on the gallery; there is no separate signing step. "The more the merrier": mass and repetition are the point. |
| Print-check concerns | **Flag only, for now** (2026-09-25). The work is signed and published, and the concern is recorded. Later: show the concern on the review page so the human can veto before printing. |
| Repeated titles | **Vary or number them** (2026-09-25). Fred Hughes sees the titles already used in the series and varies them or numbers them deliberately ("… (Disaster) II"). |
| Corrections to editions | **`silver retitle`** (2026-09-25). A correction is a new `edition.released` for the same edition number; the site shows the latest. First use: No. 016. |
| Poster frame | **The later frame** (2026-09-25): the frame after the Printer's hold (`later.png`), so pieces that build up look finished. |
| Vercel project | **`silver-factory`** (2026-09-25), at `silver-factory.vercel.app` if the name is free. No custom domain yet. |
| OpenRouter key | **Shared with other agents** (2026-09-25), so a reconcile gap is expected. A Silver-only key would make `--reconcile` exact. |
| Unshortlisted backlog | **Shortlist once, by hand** (2026-09-25): the three real pre-Phase-4 series, not the dry run. The shift stays today-only. |
| Dry-run subjects | **Marked as dry run** (2026-09-25). The real shift scouts anyway, and real series ignore dry-run subjects. |
| Record backup remote | **Private GitHub repo `y-a-v-a/silver-record`** (2026-09-25), pushed over SSH after every shift. |
| Model fallbacks | **Qwen 3.8 Flash falls back to Gemini 3.8 Flash** (2026-09-25) via OpenRouter's `models` list (`models.fallbacks`). |
| Superstar-pushed subjects | **Ahead of the Scout's picks** (2026-09-25), after commissions. |
| Gossip on the work | **The human veto is enough** (2026-09-25): chatter printed on a work goes public only through an approval. |
| The look | **Not Warhol's** (2026-10-23, the owner: "far more strange, scratchy, weird, unique, but esthetical at the same time"; no "warholian rip offs"). The Factory keeps Warhol's way of working (delegation, series, one gate) and drops his surface. See Phase 9. |
| Technique menu | **Procedures, not pop-art styles** (2026-10-23). 35 procedures (scratch film, inkjet failure, asemic ledger, compression rot, fax transmission, Rorschach, xerox generations, spectrogram, thermal camera, sun-bleach, …) replace the six 1964 techniques. No artist names in the guidance: they produced copies of the named artist. |
| The dare deck | **One card per variant** (2026-10-23): 44 oblique constraints in `dares` ("Make it tender.", "It has been left out in the rain."), dealt without repeats in a series. |
| Superstar lines as briefs | **Every variant takes one line literally** (2026-10-23). The floor's lines are dealt across the series, about evenly and shuffled. A subject with fewer than three lines is topped up with *strays*, lines overheard about other subjects, marked as such (cross-contamination, principle 1). Only with no chatter on the floor at all is the Scout's proposed image the brief. The superstars are told the assistants overhear them. |
| Studio pool | **Sonnet 5.5, Opus 5.5, Gemini 4 Argon, Kimi K3, GPT-6 Luna Pro** (2026-10-23), after a bake-off of 12 models on the new brief. Out: Qwen 3.8 Flash, Gemini 3.8 Flash, Sonnet 5. Not cast: Grok 4.7 (hung), MiniMax M3.1 Flash, Mistral Large 4. About $0.07 a variant, ~$2.20 a day. |
| Nico | **A fourth superstar** (2026-10-23), after Christa Päffgen: she talks in images, not gossip, so her lines make the strangest briefs. |
| The second pull | **Warhol's first pick goes back to its maker** (2026-10-23), with his note, its image and its own code, to be pushed further. It joins the series as the next variant (`v13`) and is reviewed next to the first. `series.secondPulls` (default 1, 0 = off); `silver pull` by hand. |
| Screenshot frame | **Frame 60** (2026-10-23), up from 30, so works that accumulate marks have built up. |
| The admin | **`silver admin`, on this machine, no login** (2026-11-04, the owner's brief). It replaces the bare review page. It binds to 127.0.0.1 and refuses other hosts and origins; sketches are served in a sandbox. See Phase 10. |
| What the browser may edit | **Souls, direction, taste, settings; not secrets, the record, paths or code** (2026-11-04). Settings go in `studio.json`, over the commented `silver.config.js`. Every edit is on the floor; everything overwritten is kept in `archive/revisions/`. |
| Soul files | **`roles/*.md` are the souls** (2026-11-04): the owner asked for "soul.md files", and the role files are what that means here. They stay plain markdown, editable in either place, and neither side can overwrite the other unseen. |
| Picking up changes | **Fresh processes, plus a supervisor for the server itself** (2026-11-04). All work runs as new `silver` processes, so souls, settings and code count from the next one. The supervisor restarts the admin on a code save, after checking that it parses and that the config loads. |

## Stack

- Node 24, ESM, plain JavaScript with JSDoc types. No build step.
- Minimal dependencies:
  - `gray-matter`: role file frontmatter
  - `rss-parser`: news and Google Trends feeds
  - `commander`: the CLI
  - `ulid`: event ids
  - `playwright`: headless render and screenshot of sketches
  - `vercel`: deploy CLI, as a dev dependency
- No database. The floor is JSONL and everything else is files on local disk (runtime data is not in git).
- Secrets in `.env`: `OPENROUTER_API_KEY`, `VERCEL_TOKEN`.

## Repository layout

```
silver/
  ARCHITECTURE.md
  ACTIONS.md
  silver.config.js          # models, budget, feeds, series matrix, shift settings
  roles/                    # the "system prompts": one markdown file per role
    scout.md
    studio-assistant.md
    second-pull.md          # Phase 9: Warhol's pick goes back to its maker
    warhol.md
    printer.md
    fred-hughes.md
    archivist.md
    technician.md
    superstars/
      brigid.md
      ondine.md
      viva.md
      nico.md               # Phase 9
  taste.md                  # append-only log of human approve/veto notes; read by Warhol (local only)
  process-log.jsonl         # build progress, one line per finished task
  bin/                      # setup.sh, log-progress.js
  src/
    cli.js                  # `silver` entry point
    commands/               # one module per CLI command + registry.js
    config.js               # loads and validates silver.config.js
    factory.js              # wires config, floor, budget, pricing, roles, llm
    events.js               # event types + envelope validation
    floor.js                # append/read/subscribe to the event log
    llm.js                  # OpenRouter client, cost tracking, transcript capture
    pricing.js              # model prices/capabilities from OpenRouter /models
    model-audit.js          # `silver models`
    roles.js                # loads roles/*.md → { meta, systemPrompt }
    budget.js               # daily ledger, hard cap
    shift.js                # orchestrates one daily shift
    lib/                    # jsonl, dedupe, snapshot, format, env, process-log
    agents/
      scouts.js
      commissions.js
      superstars.js
      assistants.js
      warhol.js
      pull.js               # Phase 9: the second pull
      printer.js
      hughes.js
      archivist.js
    sources/
      index.js              # gatherCandidates: all sources in parallel
      http.js               # UA, timeouts, htmlToText
      candidate.js
      google-trends.js
      hackernews.js
      reddit.js
      rss.js
    tools/                  # the Technician's workbench (hand-built in v1)
      p5-template.html
      render.js             # Playwright: run sketch, catch errors, screenshot
      contact-sheet/        # local review web app
  # --- runtime data: local disk only, gitignored (floor/, archive/, canon/, taste.md) ---
  floor/                    # YYYY-MM-DD.jsonl, append-only, never edited
  archive/
    transcripts/            # every LLM request+response, by event id
    variants/<series-id>/   # every sketch + screenshot, including rejects
    diary/                  # Archivist's daily entries (YYYY-MM-DD.md)
  canon/
    canon.json              # signed works, edition numbers, hashes
    works/<canon-id>/       # final sketch, poster PNG, wall text
  site/                     # generated static gallery → Vercel (gitignored, rebuilt)
  launchd/
    com.silver.shift.plist
```

## Role file format

Each role is a markdown file. The body is the system prompt, and the frontmatter holds its runtime settings. Code never hardcodes a prompt.

```markdown
---
id: warhol
name: Warhol
model: <openrouter model slug>      # must be vision-capable for Warhol
temperature: 0.4
reads: [series.completed, chatter.posted]
emits: [shortlist.proposed]
max_tokens: 2000
output: json                        # json | text
vision: true                        # optional: the role sends images
reasoning: low                      # optional: off | low | medium | high, or a number = hard thinking-token budget
---

You are Andy Warhol at the Factory. You did not make these; your assistants did.
Your job is to choose. ...

## Output
Return JSON: { "picks": [{ "variant_id": "...", "note": "..." }], "rejects_note": "..." }
```

Rules:
- `roles.js` validates the frontmatter and fails loudly if a field is missing or unknown.
- `model_role: <role>` (optional) makes a role use another role's config model, e.g. `roles/scout-annotate.md` runs on the Scout's model. It is exclusive with `model`.
- Reasoning tokens count against `max_tokens`. A reasoning model can spend all of them thinking and return an empty reply, so set `reasoning` (use `off` for chatter) and leave enough headroom. Effort levels are only advisory for some models (DeepSeek spent a full 8,000-token budget thinking at `low` on the studio brief), so use a number where it matters: `reasoning: 2000` caps thinking at 2,000 tokens.
- Don't use `reasoning: off` for a model that has fallbacks: some fallbacks (Gemini 3.8 Flash) require reasoning and reject the call. Use a small budget instead (the superstars use `reasoning: 256`; found in the 2026-09-26 shift).
- The prompt body may use `{{placeholders}}` (e.g. `{{taste}}`, `{{subject}}`, `{{floor_excerpt}}`), which are filled at call time.
- Superstars share one frontmatter shape and differ only in voice. A new persona means adding a new file, with no code change.
- Principle 6 (blurry roles): each role prompt says it *may* step outside its role, and the orchestrator accepts off-role events such as a superstar posting a `subject.posted`.

## Floor events

Envelope, one JSON object per line:

```json
{ "id": "01J…", "ts": "2026-09-23T09:00:00Z", "shift": "2026-09-23", "type": "subject.posted", "actor": "scout", "ref": null, "payload": {} }
```

Event types, extending the draft list in ARCHITECTURE.md:

| Event | Actor | Payload |
|---|---|---|
| `shift.started` / `shift.ended` | orchestrator | budget remaining, counts |
| `subject.posted` | scout, superstar, **human** (commission) | `origin: scouted\|commission\|archive`, `title`, `url`, `source`, `why` (why it is a ready-made), `image` (the image it suggests), `snapshot: {snippet, fetchedAt, meta, page}`. `ref` points at the Scout call (or at the earlier subject a commission repeats). |
| `chatter.posted` | superstar | persona id, text, ref |
| `tool.released` | technician | tool name, version (in v1, emitted manually when a template changes) |
| `series.started` | assistant | `subjectId` (this claims the subject; commissions without one are pending), technique list, model matrix |
| `variant.produced` | assistant | series id, path, model, temperature, technique, seed; since Phase 9 also `dare`, `brief` (`{from, text, eventId}`: the superstar line it was made from), `note` (the sketch's `// WORK:` line), and for a second pull `pullOf` and `warholNote` |
| `variant.failed` | renderer | series id, error (kept in the archive, since failures are material) |
| `series.completed` | orchestrator | series id, variant ids, contact-sheet path |
| `shortlist.proposed` | Warhol agent | picks with notes, reject note |
| `review.decision` | **human** | variant id, approved\|vetoed, note (this also appends to `taste.md`) |
| `work.published` | printer | canon id, edition, URL, render hash |
| `edition.released` | Fred Hughes | work id, channel (`site`, `rss`), edition number |
| `cost.recorded` | llm client | model, tokens, USD, ref |
| `llm.failed` | llm client | role, model, error, attempts, reason (`empty`, `invalid-json`) |
| `diary.written` | archivist | `shift`, `path`, words, how many events it covers (`since` the previous entry) |
| `shift.archived` | archivist | `manifest` path, events, artifacts checked, `missing` artifacts, diary result |
| `record.pushed` | archivist | the private record's commit, whether it was pushed, and the error if not (retried next shift) |
| `site.deployed` | fred-hughes | url, number of works, provider (Phase 5) |
| `subject.retired` | **human** | `subjectId`, reason. Hides the subject from `latest`, `subjects --open` and the shift; the subject itself stays on the floor (Phase 3b). |
| `subject.pinned` | **human** | `subjectId`, `pinned`. The latest per subject counts; a pinned subject from any day goes first in the next shift (Phase 10). |
| `studio.changed` | **human** | `what` (`role`, `settings`, `direction`, `taste`), `target`, `summary`, `path` to the revision it replaced, `changes` with from and to for settings (Phase 10). |

---

## Phase 0: scaffold ✅

- [x] `npm init`, set `"type": "module"`, add a `bin` entry for `silver` → `src/cli.js`
- [x] Install the dependencies listed above, plus `npx playwright install chromium` (wrapped in `npm run setup`)
- [x] `.env.example`, `.gitignore` (ignore `.env`, `site/`, `node_modules`)
- [x] `git init`. ~~The floor, archive, and canon **are committed** (the record is the work).~~ **Reversed on 2026-09-24:** runtime data stays out of git. `test/layout.test.js` now fails if any of it is tracked.
- [x] `silver.config.js` with:
  - [x] `models`: a studio pool of 4 OpenRouter slugs across providers, a default model per role, and a cheap model for chatter and dry runs
  - [x] `budget.dailyUsd: 5`
  - [x] `series.variants: 12`, `series.temperatures: [0.7, 1.1]`, plus `modelsPerSeries: 3` and `techniquesPerSeries: 2`. The technique menu is a top-level `techniques` map.
  - [x] `shift.seriesPerShift: 2`, `shift.subjectsPerShift: 6`
  - [x] `sources.rss: [...]`, `sources.trending: { googleTrendsGeo, hackernews: true, reddit: true }`
- [x] In ARCHITECTURE.md, mark the four open decisions as resolved and link to this file

Also added along the way:

- `src/config.js` validates the whole config in one pass (`silver config --check`)
- A command registry in `src/commands/registry.js`. Every planned command is listed with its phase, and unbuilt commands exit 2.
- `src/lib/jsonl.js`, append-only JSONL helpers that the floor will reuse in Phase 1
- `process-log.jsonl` + `bin/log-progress.js` to track the build
- README, a `node:test` suite, and GitHub Actions CI

**Done when:** `silver --help` prints the command list. ✅

## Phase 1: the floor, the LLM client, roles, budget ✅

- [x] `floor.js`: `append(event)`, `read({ shift, type, since })`, and `tail()` (async iterator used by the contact sheet). Append only, with no update or delete API. `read` also filters by `actor` and `ref`, and accepts `shift: 'all'` and `prefix.*` type patterns.
- [x] `llm.js`: `call(role, { vars, messages, images })` →
  - [x] POST to `https://openrouter.ai/api/v1/chat/completions` with the role's model, temperature, and system prompt
  - [x] Request usage accounting so each response reports its cost, then emit `cost.recorded`
  - [x] Save the full request and response to `archive/transcripts/<event-id>.json`. Base64 images are reduced to a fingerprint, since the images themselves are archived with the variants.
  - [x] Retry with backoff on 429/5xx. When `output: json` returns unparseable JSON, retry once with a repair message, and if that also fails, record the failure and move on (`llm.failed` + `LlmOutputError`). Empty replies are handled the same way.
  - [x] Support image input (base64 PNG) for Warhol's review. The role must declare `vision: true`.
- [x] `budget.js`: a daily ledger built from `cost.recorded` events. `check(estimateUsd)` / `reserve(estimateUsd)` throw `BudgetExhausted`. Chatter has its own share of the cap, and reservations are serialised so parallel calls can't overspend. (Catching it at the end of a shift is Phase 8.)
- [x] `roles.js`: load and validate `roles/**/*.md`, and render placeholders
- [x] `silver floor [--shift date|all] [--type t] [--actor a] [--follow] [--json]`: pretty-prints the log
- [x] `silver cost [--shift date|all] [--json]`: spend for each role and model

Also added along the way:

- `src/pricing.js`: OpenRouter's public `/models`, used for pre-call estimates and as a fallback cost
- `silver models`: checks every configured model exists on OpenRouter and that image roles are on vision models
- The `reasoning` frontmatter field and the `llm.failed` event (see above)
- `SILVER_ROOT`, `SILVER_CONFIG` and `OPENROUTER_BASE_URL` env hooks, used by the end-to-end tests
- `roles/technician.md`, written ahead of Phase 3 so `ping` had a real role

**Done when:** a throwaway `silver ping <role>` makes one call, and the floor shows `cost.recorded` with the transcript in the archive. ✅ The first real call was `silver ping technician` on 2026-09-24 (claude-sonnet-5, $0.00136).

## Phase 2: Scouts and commissions ✅

- [x] Write `roles/scout.md` (Latow/Geldzahler): *find, don't invent*; judge whether an item is a true ready-made (mass-produced, widely seen, emotionally loaded or banal); output subject cards as JSON. The Scout picks by candidate number, so titles are never rewritten. `why` must use only facts from the source, and `image` may be imagined.
- [x] Source adapters, each returning `{ title, url, snippet, source, fetchedAt }` (plus `meta`):
  - [x] `google-trends.js` (daily trending RSS for a configured geo; the lead news link becomes the url)
  - [x] `hackernews.js` (front page, via the official Firebase API)
  - [x] `reddit.js`: **changed.** `/r/all/top.json` answers 403 without OAuth (checked 2026-09-24), so it uses the public Atom feed `/r/all/top/.rss?t=day` and takes the post's own target from its `[link]` anchor
  - [x] `rss.js` (configured news feeds; each is its own source `rss:<host>`)
- [x] `agents/scouts.js`: fetch all sources → dedupe against subjects already on the floor → the Scout LLM picks `subjectsPerShift` → emit `subject.posted` with a text snapshot, so the subject survives link rot
  - Dedupe: normalised URL (tracking params stripped), normalised title, or titles sharing ≥ 75% of their words (Jaccard)
  - Snapshot (`src/lib/snapshot.js`): og title, description and image, plus up to 2,000 characters of article text. It never throws, and failures such as paywall 403s are recorded on the card.
- [x] `silver commission "<text | URL>" [--now]`: emits `subject.posted` with `origin: commission`. Commissions **always get a series** in the next shift, ahead of scouted subjects. `--now` runs a mini-shift for just that subject. **Partly done:** since Phase 4, `--now` produces and renders the series and has Warhol shortlist it right away. Superstar chatter joins when Phase 6 is built. Without an API key it queues and says so. Also added `--why <note>` and `--list` (commissions still waiting for a series).
- [x] `silver scout`: runs the scouts on their own (useful for tuning). Options: `--count`, `--source`, `--list` (no model call), `--no-snapshot`, `--dry-run`, `--json`.

**Done when:** `silver scout` posts ~6 subject cards to the floor, each showing a "why it's a ready-made" line that makes sense. ✅ The first live run on 2026-09-24 posted 6 cards for $0.0086. Its notes embellished facts, which led to the facts-only rule; the rerun stayed factual.

## Phase 2b: follow-ups from the 2026-09-24 decisions

- [x] **Sensitive subjects:** add the exclusion rule to `roles/scout.md` (no suicide, no children, no named private victims), plus a `sensitive: {flag, reason}` field per pick. `validatePicks` carries it onto the subject card (`payload.sensitive`).
- [x] **Repeat window:** add `sources.repeatAfterDays: 7` to the config (validated). Dedupe against the floor only looks at subjects posted within the window, and the Scout's "recent subjects" list uses the same window.
- [x] **Scout annotates commissions:** after `postCommission`, one Scout call (a small prompt section in `roles/scout.md`, or a separate `roles/scout-annotate.md`) adds `scoutWhy` and `image`. The human's `why` is never overwritten. A failed call leaves the commission as it is and is recorded as `llm.failed`. `--no-annotate` skips it.
- [x] **Licence:** add `LICENSE` (MIT, code) and `LICENSE-ARTWORKS.md` (CC BY 4.0, works), set `"license": "MIT"` in `package.json`, and add a README section.

## Phase 3: Technician tools and Studio assistants ✅

- [x] Write `roles/technician.md` (done in Phase 1). It is used in v1 only for its voice: when a template changes, the human runs `silver release <tool>` and the Technician writes the release note as a `tool.released` event.
- [x] `silver release <tool>` (`agents/technician.js`): tools are `p5-template`, `renderer` and `contact-sheet`. The version is the file's content hash, and releasing the same version twice needs `--force`. Changes come from `--changes` or the file's git log.
- [x] `tools/p5-template.html` (in `src/tools/`, built by `src/tools/template.js`): a single file that loads p5 from a pinned CDN version (**p5 1.11.13**, kept for v1 by decision 2026-09-25) with an injected `// SKETCH` block
  - [x] Seeds from `?seed=` (`randomSeed` + `noiseSeed`), so screenshots are reproducible while a normal load still drifts. `Math.random` is seeded too (mulberry32).
  - [x] Fixed canvas size (e.g. 1080×1080), with a `window.__silverReady` flag set after N frames (30), or right after `setup()` for sketches without `draw()`. `?freeze=1` stops the loop at that frame.
  - [x] Embeds the title and subject as a comment/metadata, with no visible UI chrome (a `silver-meta` JSON script tag, escaped against `</script>`)
- [x] `tools/render.js` (Playwright):
  - [x] Loads the sketch, collects console errors, waits for `__silverReady` or a timeout. It stops waiting at the first uncaught error. p5 is served from `node_modules`, and all other network is blocked and reported.
  - [x] Takes a screenshot at seed 1 (and optionally seeds 2 and 3, for a small grid)
  - [x] Blank-canvas check: near-uniform pixels count as a failure (the dominant colour covers ≥ 99.5% of a 96×96 sample)
  - [x] Emits `variant.failed` on error or blank output, otherwise returns the PNG path. The renderer returns `{ok, reason, shots, errors, blocked}`, and the assistants agent emits the event.
- [x] Write `roles/studio-assistant.md` (Malanga/Smith): turn a subject into a p5 sketch in a given **technique**; serial repetition, silkscreen logic (flat colour fields, registration offset, grids of repeats, photo-to-halftone); output only the sketch body. No external assets (the renderer blocks the network, and published works shouldn't depend on outside links), `random()`/`noise()` for all variation, complete by frame 30, real people shown through type, silhouettes or objects.
- [x] A technique menu in config, e.g. `grid-repeat`, `misregistered-silkscreen`, `halftone`, `camouflage`, `death-and-disaster-tint`, `screen-test-portrait`. Each is one line of guidance injected into the prompt. (Done in Phase 0: the top-level `techniques` map in `silver.config.js`.)
- [x] `agents/assistants.js`: for each subject selected in this shift → `series.started` → run the 12-cell matrix (models × temperatures × techniques) in parallel, with a concurrency limit → write to `archive/variants/<series>/<variant>.html` → render → `variant.produced` / `variant.failed` → `series.completed` with a generated contact sheet. Failures are recorded with a stage (`llm`, `extract`, `error`, `blank`, `no-canvas`, `timeout`, `budget`); an unparseable reply is kept as `<variant>.reply.txt`. A spent budget stops new work, and the unstarted cells are recorded. The matrix and extraction live in `agents/studio.js`, and the static contact sheet in `tools/contact-sheet.js`.
- [x] **Keep the drift:** assistants do not get to see each other's variants within a series. Each one gets the subject plus the recent floor chatter only.

- [x] `silver series <subject>` (id, unique id suffix, or `latest`; `--dry-run`, `--variants`, `--no-render`, `--open`) and `silver subjects` (short ids, commission/sensitive markers, series count)

**Done when:** `silver series <subject-id>` produces a folder of 12 sketches with screenshots, and broken ones are recorded rather than dropped. ✅ There were three live series on 2026-09-24:

| Series | Subject | Produced | Cost | Notes |
|---|---|---|---|---|
| `01M3AFN63F28M769GJ5MSTFC1P` | dunkin free coffee code | 7/12 | $0.05 | DeepSeek timed out (misreported as "HTTP 200") and returned empty at 8k tokens; led to the timeout and body-error fixes |
| `01M3AG01ZPYAXJ8ECDMSYHKTYA` | 78$ sushi arrived like this | 9/12 | $0.27 | DeepSeek again returned empty at 8k; led to `max_tokens: 16000` |
| `01M3AGEEMAFBXZ7K9P0YYN2PSY` | NGV employee stole $8m for phones | 9/12 | $0.11 | Every cell replied; failures were 2 DeepSeek truncations and 1 runtime error |

Per model across all three: Gemini 3.8 Flash 8/8 ($0.010/call), GPT-6 Luna Pro 11/12 ($0.004/call), Claude Sonnet 5 4/4 ($0.056/call), DeepSeek v4.1 Flash 2/12 ($0.009/call). DeepSeek is being replaced by Qwen 3.8 Flash (decision 2026-09-25, Phase 3b).

Also added in Phase 3:

- `silver commission --now` produces the series immediately (chatter and shortlist to follow in Phases 6 and 4)
- `reasoning` in role frontmatter may be a number: a thinking-token budget (advisory in practice: several providers ignore it)
- The Technician's release notes use the tool's own header and a facts-only rule (the first live notes invented features)

## Phase 3b: follow-ups from the 2026-09-25 decisions ✅

- [x] **Replace DeepSeek with Qwen 3.8 Flash** in `models.studio`: check it with `silver models`, run one dry-run series on it, and record the result here. **Result (2026-09-25):** `silver models` OK. The dry-run series `01M3BTRDR1GHPGNZX56FZJ6DXP` (4 variants, Qwen only) produced **3/4** for $0.0069 ($0.0017/call) in 49s. The one failure was `fill('#hex', alpha)`, which p5 1.x rejects and which GPT-6 Luna Pro had also hit, so the Studio assistant's brief now shows the correct pattern.
- [x] **Retire subjects:** add a `subject.retired` event type (payload `subjectId`, `reason`, actor `human`) and `silver subjects --retire <id> [--reason ...]`. `findSubject('latest')`, `subjects --open` and `pendingCommissions` skip retired subjects. `silver subjects` marks them. Then retire the two subjects from before the exclusion rule (the US Navy suicide attempts and the UN photos of slain children). **Done 2026-09-25:** `HFC44P1D` and `DG602VC4` are retired. An explicit `silver series <id>` of a retired subject is refused too.

## Phase 4: Warhol and the contact sheet (veto) ✅

- [x] `taste.md` (`src/lib/taste.js`): starts with a short hand-written header of what the human likes and dislikes. After that it is append-only: one entry per human decision, with date, variant, verdict, and note.
- [x] Write `roles/warhol.md`: terse, flat, deadpan; chooses the piece, never makes it; judges *seriality and surface*, not effort. Its `{{taste}}` placeholder receives the last N entries of `taste.md`. Output: 1–3 picks per series with a one-line note each, plus a note for the rejects.
- [x] `agents/warhol.js`: on `series.completed`, sends the screenshots (vision) and the sketch metadata (not the full code, which would bias it toward code quality) → `shortlist.proposed`
  - [x] **One screenshot per variant** (seed 1), so about 12 images per review (decision 2026-09-25)
  - [x] Warhol's notes say when a variant ignored its assigned technique (`offTechnique` per pick). Such variants are kept as drift and judged at the veto (decision 2026-09-25).
  - [x] `silver shortlist [series|latest|unlisted]`. Warhol sees images, techniques and temperatures, never code or model names. Series views come from `agents/series-data.js`, shared with the review server and the shift. First live shortlist (NGV series, 2026-09-25): $0.06 for 9 images on Opus 5.5, in voice ("Gee, it's a mugshot of a product.").
- [x] `tools/contact-sheet/` (built as `src/tools/review/`: `server.js`, `pages.js`, plus `agents/review.js`): a small `node:http` server, with no framework, bound to 127.0.0.1, with cross-origin form posts refused
  - [x] `silver review` starts it on `localhost:4747` and opens the browser
  - [x] One page per series: a grid of **live** sketches in iframes, with Warhol's picks highlighted and his notes shown. Screenshots by default, with "play here" swapping in the live sketch, since twelve live p5 canvases at once are heavy.
  - [x] The Floor chatter for that subject is shown in a side column
  - [x] Each pick has Approve / Veto and an optional note field. Posting a decision emits `review.decision` and appends to `taste.md`.
  - [x] The human may also approve a variant Warhol did **not** pick (the veto works both ways)
  - [x] Pending reviews persist across shifts until they are decided (a series stays pending until "Close this review" posts `review.decision` with `verdict: closed`; the latest decision per variant wins)
  - [x] Subjects with `payload.sensitive.flag` show a visible warning and the reason (decision 2026-09-24)
  - [x] Real people's likenesses are judged here, case by case: no automated rule (decision 2026-09-24)
- [x] Rejected and vetoed variants stay in `archive/`, since nothing is ever deleted

**Done when:** after a shift, `silver review` shows Warhol's shortlist, and approving one emits the decision and grows `taste.md`. ✅ The first live shortlist (NGV series) shows on `silver review` with Warhol's notes, checked in headless Chromium at desktop and phone widths. Approve, veto and close are covered by tests against the real server. **The first real approval is left to you**, since that veto is yours.

## Phase 5: Printer, Fred Hughes, Vercel ✅ (live since 2026-11-05)

- [x] Write `roles/printer.md`. The Printer is mostly code; the LLM is used only for a final "print check" (does the sketch hold up at full size, and does it run for more than 60s without degrading?). It may send the piece back as a floor event, but it cannot un-sign it.
- [x] `agents/printer.js`, run on `review.decision: approved` (the latest decision per variant counts; nothing is printed twice):
  - [x] Copies the sketch to `canon/works/<canon-id>/sketch.html`. The template only seeds when `?seed=` is given, so the published piece drifts on every load as built. Canon ids are readable: `<subject-slug>-<variant>-<series tail>`.
  - [x] Renders a poster PNG (fixed seed) for thumbnails and OG images, falling back to the review screenshot. It also holds the piece `printer.holdSeconds` (10s rather than the planned 60s) and looks again (`later.png`).
  - [x] **Signature:** sha256 of the sketch source + Warhol's note + the human approval event id, stored in `canon.json` (`src/canon.js`; `canon.json` is a cache rebuilt from the floor)
  - [x] Emits `work.published`. The print check flags but never blocks: `printCheck.verdict` is `ok`, `concern` or `unchecked`, and an error or blank frame while running is always a concern, whatever the model says.
- [x] Write `roles/fred-hughes.md`: the business side: a title (Warhol-flat: "Silver Car Crash (Double Disaster)"-style), short wall text, edition number. **Always in English**, also for Dutch subjects, and wall text quotes at most a headline, never article text.
- [x] `agents/hughes.js`: assigns sequential edition numbers, writes the wall text, regenerates the site, emits `edition.released`. Numbering is gap-free in signing order; a failed call leaves the work unreleased for the next publish. Regenerating the site is the publish pipeline's job.
- [x] Static site generator `src/site.js` → `site/` (only released editions; rebuilt from scratch, keeping `site/.vercel`):
  - [x] `index.html`: the canon as a grid of posters, newest first
  - [x] `works/<id>/`: the live sketch, full-bleed, with wall text below (plus the edition number, technique, source headline link, signature excerpt, previous/next links, and OG tags once `deploy.siteUrl` is set)
  - [x] `feed.xml`: an Atom feed of the editions (stable `tag:` ids; absolute links once `deploy.siteUrl` is set)
  - [x] A CC BY 4.0 notice on every work page and in the feed (decision 2026-09-24)
- [x] Deploy with `vercel deploy site --prod --token $VERCEL_TOKEN --yes`. Record the URL in `work.published`. **Changed:** `src/deploy.js` links `site/` to `deploy.project` once (`vercel link`), then runs `vercel deploy --prod`. The work is already signed by then, so the URL goes into a new `site.deployed` event; each work's URL is `<site>/works/<canon-id>/`. With no `VERCEL_TOKEN`, deploying is skipped and says so.
- [x] `silver publish`: rebuilds and redeploys by hand (print → editions → site → deploy, under a lock file in `canon/`; `--no-deploy`, `--limit`). The review server runs the same pipeline in the background after each new approval, one run at a time (`--no-publish` turns that off), and marks published variants with their edition number.

**Done when:** approving a variant in the contact sheet results in a live Vercel URL and a new feed entry. **Partly verified:**
- **Verified:** approving in `silver review` now triggers the background publish. On 2026-09-25, `silver publish --no-deploy` turned your 20 approvals into **19 editions** (one approval was a duplicate click): printed, print-checked (18 ok, 1 concern), titled by Fred Hughes, and built into `site/` with the feed. That took 6 minutes and cost $0.09. The gallery was checked in headless Chromium at desktop and phone widths.
- **Verified live (2026-11-05):** the first real deploy linked `site/` to the Vercel project `silver-factory` and published 29 works at https://silver-factory.vercel.app. With `deploy.siteUrl` set, the live feed and the share images use absolute links.
- **Note:** `site.deployed` records the URL of that one deployment (`silver-factory-<hash>-…vercel.app`), and the Canon page shows it. Vercel's deployment protection redirects visitors away from those URLs, so share the production address instead.

## Phase 5b: follow-ups from the Phase 5 decisions (2026-09-25) ✅

- [x] **Poster = later frame:** the gallery and feed use `later.png` as the poster (`posterOf` in `src/canon.js`), falling back to frame 30 when the hold went wrong. It's derived at build time, so the 19 existing editions switched without reprinting; all 19 now use the later frame.
- [x] **Titles:** Fred Hughes's prompt lists the titles already released for the same subject or series (`{{taken}}`, including ones released earlier in the same run) and asks him to vary them or number them deliberately. The existing repeats (Nos. 002/004, 012/013/015) stay: they're the record.
- [x] **`silver retitle <No.> [--title …] [--wall …] [--note …]`:** appends a new `edition.released` for the same `canonId` and edition number (`correction: true`, `replaces: <event id>`, actor `human` or `fred-hughes`). The canon, site and feed use the latest label ("label revised <date>" on the work page; the feed entry's `updated` moves, no new entry). Without `--title`/`--wall`, Fred Hughes rewrites it, told what was wrong via `--note`. Afterwards it republishes. **No. 016** is corrected: now "Free Coffee Code (Camouflage) II", with the invented million cups gone.
- [x] **Dry-run subjects:** `subject.posted` from a dry-run shift (or `silver scout --dry-run`) carries `dryRun: true`. The real shift's "scouted today?" check ignores them, its subject picker skips them, and the real Scout's dedupe ignores them, so it may pick the same headline for real. `silver subjects` marks them `D`. Subjects from earlier dry runs weren't marked and count as real.
- [x] **Backlog:** by 2026-09-25 only two real series were unshortlisted (Dunkin' `…STFC1P` and sushi `…YHKTYA`; the NGV series already had one). Both are now shortlisted, after your decisions on them, so Warhol's notes are for the record. Signatures of works already printed are unchanged.
- [x] **Go live** (2026-11-05): https://silver-factory.vercel.app. The steps were: fill in `VERCEL_TOKEN` in `.env`, run `silver publish --redeploy` and set `deploy.siteUrl` to the URL it prints (then `--redeploy` once more for absolute feed/OG links). `silver publish` now deploys whenever the canon changed since the last deploy, corrections included.
- [ ] Later: the print check on the review page, before the veto.

## Phase 6: Superstars ✅

- [x] Write 3 persona files in `roles/superstars/`: **Brigid** (tape-recorder gossip, the phone, what things cost), **Ondine** (speed monologue, opera, theatrical insult) and **Viva** (languid, withering, notices the hypocrisy). Each file holds only the voice; the house rules (facts only from the cards, no sharpening vague numbers, nothing sexual about real people, never mocking victims, children or private people) are sent by the code with every call, so all three share them.
- [x] `agents/superstars.js`: after the Scouts, each superstar in turn reads the day's waiting subjects and what the others already said → up to `superstars.linesPerShift` (3) `chatter.posted` events (`ref` = the subject, `payload.persona`). Blurry roles: with `superstars.proposeChance` (0.34), **one** superstar per shift is shown the Scout's leftovers (the candidates it passed over) and may push one onto the floor as a `subject.posted` with `origin: superstar`, `proposedBy`. A pushed subject gets the first free series slot after commissions. `silver chatter [subject...] [--only brigid viva] [--list]` runs them by hand.
- [x] Chatter runs on `models.roles.superstar` (Qwen 3.8 Flash, reasoning off) and is capped by `budget.chatterShare` (10% of the day, $0.50). Hitting the chatter cap stops the superstars, never the shift. First live run: 3 personas, 8 lines, $0.0007.
- [x] The chatter goes into the assistants' prompts (`{{floor_excerpt}}`, now framed as "overheard on the floor… steal it"), into Warhol's review and onto the contact sheet (which also says who pushed a subject). Dry-run chatter is marked and never reaches a real series. `commission --now` runs the chatter first.

**Done when:** series visibly change when the chatter changes. ✅ **A/B on 2026-09-25** (Norway tax list, `Y4S02W00`, same matrix via `--matrix-seed 7`, dry runs, 4 variants each):
- without chatter (`…XH08C5H`): tax-list grids, only the subject's own words;
- with chatter, original brief (`…14RVN5`): no line of chatter visible. The brief listed the chatter without saying what to do with it;
- with chatter, new brief (`…BX8542`): the chatter is printed on the work: "they can see your name. the surveillance is polite." (Viva) and "YOU ARE THE ACCUSER AND THE ACCUSED." (Ondine). Cost of the A/B: $0.018.

## Phase 7: Archivist ✅

- [x] `agents/archivist.js` (code): after each shift, checks that every event's artifacts exist (any payload path: `transcript`, `path`, `png`, `contactSheet`, `sketch`, `poster`, `later`, `manifest`), writes `archive/manifests/<day>.json` (events by type and actor, spend by role, subjects, series, decisions, editions, missing artifacts) and a `shift.archived` event. It does not commit to the code repo. `silver archive [date]` runs the check by hand. **Live 2026-09-25:** 344 artifacts checked over both days, none missing.
- [x] Write `roles/archivist.md` (Pat Hackett typing up Andy's morning call; money like cab fares; only what's in the notes): the code builds plain notes from the floor since the previous entry (so the morning's reviews land in the next entry, dry runs left out), and the Archivist (Sonnet 5) writes `archive/diary/YYYY-MM-DD.md` → `diary.written`. The shift writes it for real shifts only; `silver diary [date] [--write] [--force]`. **Live:** the first entry (both days, 343 words) cost $0.02.
- [x] **Backup** (decision 2026-09-24): the record is its own git repository with its git dir in `.record/` (ignored by the code repo) and the repo root as work tree. It force-adds exactly `floor/`, `archive/`, `canon/` and `taste.md` (never the publish lock), because the code repo's `.gitignore` outranks the record's own excludes. After `shift.ended` the shift commits it with a summary and pushes if a remote is set; the result goes into a `record.pushed` event, and a failed push is simply retried next shift. `silver init-record` created the local record on 2026-09-25 (337 files, 18 MB). **Done 2026-09-25:** the private repo `y-a-v-a/silver-record` exists and holds the record (pushed over SSH; `silver init-record --github <name> --yes` sets it up with the SSH URL).
- [x] **Feedback loop** (principle 3): `src/sources/archive.js` offers the Scout the reject pile (variants the human vetoed or Warhol passed over, from earlier days) and lines from recent diary entries, each until used once. At most `shift.maxArchiveSubjectsPerShift` (1) become subjects, with `origin: archive` and a pointer to the reject or the line. The Scout role exempts them from the "already on the floor" rule. `silver scout --source archive` runs only this source.

**Done when:** a diary entry exists for each shift, and an archive-origin subject appears within a week. ✅ The shift writes the diary for every real shift from 2026-09-26. An archive subject appeared on the first try, once the Scout role said revisiting is the point: "The reject pile: 'dunkin free coffee code', v09 (grid-repeat)", which Warhol had passed over as "too gray". The full chain ran as a live dry-run shift: scouts → superstars → Archivist (manifest, diary skipped for dry runs) → record commit `6785e0c`.

## Phase 8: the daily shift and launchd ✅ (installed 2026-09-25; first unattended run 2026-09-26 09:00)

- [x] `src/shift.js`: `shift.started` → scouts → superstars → pick subjects (commissions first, then scouted) → assistants (N series) → Warhol shortlists → archivist → `shift.ended`
  - [x] Commissions fill the `seriesPerShift` slots first, oldest first. The rest wait for the next shift (decision 2026-09-24).
  - [x] `silver commission --now` runs a mini-shift for one subject: superstar chatter → series → Warhol shortlist (decision 2026-09-24). The chatter runs first (Phase 6).
  - [x] Idempotent per date: running it twice on one day continues the shift without duplicating it
  - [x] Stops cleanly on `BudgetExhausted` and records the reason
  - [x] Skips retired subjects (`subject.retired`, Phase 3b)
  - [x] The end-of-shift summary includes the reconcile gap (below)
  - [x] A dry run never stands in for the real shift: dry-run `shift.ended` events, series slots and subject claims only count for other dry runs, so testing never uses up the day
  - [x] Printing happens **outside** the shift, at the moment of human approval, because the veto is async
- [x] `silver shift [--dry-run] [--again] [--no-notify] [--json]`: dry-run uses the cheapest model and 2 variants. The superstars (Phase 6) run after the scouts, and the Archivist (Phase 7) runs last; the record is committed after `shift.ended`.
- [x] `silver cost --reconcile` (decision 2026-09-25, `src/reconcile.js`): compare the ledger's total with OpenRouter's `/api/v1/key` usage over the same period and report the gap (billed calls that never reached `cost.recorded`, such as timed-out replies)
- [x] A macOS notification at the end of a shift (`osascript -e 'display notification …'`) saying "N series waiting for review"
- [x] `launchd/com.silver.shift.plist`: `StartCalendarInterval` (e.g. 09:00), absolute paths to `node` and the repo, and logs to `archive/logs/`. The plist is generated with this machine's absolute paths by `src/schedule.js` (`silver install-schedule --print` shows it) rather than kept as a static file in the repo.
- [x] `silver install-schedule`: copies the plist to `~/Library/LaunchAgents/` and runs `launchctl bootstrap`. `silver uninstall-schedule` reverses it. Install refuses unless `.env` has `OPENROUTER_API_KEY` (launchd jobs don't inherit the shell's variables); `--force` overrides.
- [x] Document that if the Mac is asleep at the scheduled time, launchd runs the job on wake (in `src/schedule.js`, the install output and the README; if the Mac is switched off, that day's shift is skipped)

**Done when:** the Mac runs a shift unattended overnight, the notification appears, and the review → publish flow works the next morning. **Partly verified:**
- **Verified:** `silver shift --dry-run` ran live on 2026-09-25 (6 subjects, 1 series, 1 shortlist, reconcile OK, about 2 minutes). The tests cover full, repeated, resumed, budget-stopped and dry-run shifts.
- **Open:** the unattended run needs `silver install-schedule`, which I didn't run: it schedules daily spending, and `.env` doesn't hold the key yet (see the open questions).
- **Open:** "publish" is Phase 5, so for now the morning flow ends at approval.

## Phase 9: the contemporary studio ✅ (night shift, 2026-10-23)

The owner's brief: the outputs were Warhol rip-offs (flat clip-art icons in grids, headline posters, hot pink and yellow), because every part of the pipeline asked for exactly that: the technique menu was Warhol's greatest hits, the assistant's brief demanded flat silkscreen logic and logos-as-type, the Scout proposed "flat, repeatable images to screen", Warhol selected for "looks like a print of the thing", Fred Hughes titled in the *(Disaster)* register, and `taste.md`'s placeholder examples liked "flat colour, hard repetition, brand type". The inputs (subjects, chatter) were fine; the outputs had to go wilder.

- [x] **The studio brief** (`roles/studio-assistant.md`): it's 2026, pop-art pastiche is the one thing the Factory no longer makes. Sideways, not illustrated; marks, not clip-art; not the generative-art screensaver either; still beautiful; colour is a decision (beige paper is the new cliché); hold from across the room; type is material. Each sketch starts with a `// WORK:` line saying what it shows, kept as the variant's `note`.
- [x] **35 procedures** replace the six techniques, described as processes without artist names.
- [x] **The dare deck**: `dares` in the config, one card per variant (`buildMatrix`).
- [x] **Briefs from the floor**: `dealBriefs` gives every variant one superstar line to take literally, topping a thin subject up with strays about other subjects; `formatBrief` falls back to the Scout's image.
- [x] **Warhol's eye**: bored by copies of himself; picks the strange one that still holds, leaves illustration, posters, clip-art and tasteful beige. He sees each variant's dare and whose line it came from.
- [x] **Fred Hughes** may title from the superstar's line or the assistant's note; the wall text names the superstar. The canon keeps `dare`, `brief` and `makerNote`; the gallery's work page shows the line and the dare.
- [x] **The Scout's `image`** proposes a detail, a residue, a strange angle, not a flat image to screen.
- [x] **The review page and contact sheet** show each variant's note, brief and dare.
- [x] **Template fixes** (found in the bake-off; they killed about a third of the stronger models' variants): `buffer.remove()` on a `createGraphics` buffer throws in p5 1.11.13 global mode, and `fill('#hex', alpha)` / `fill(color, alpha)` throws too. Both are now handled in the template; the brief also warns about top-level p5 calls and shadowing p5 names. Screenshot at frame 60.
- [x] **Studio pool re-cast** after a bake-off (see the decisions table).
- [x] **Nico** (`roles/superstars/nico.md`). Superstar replies that are a bare array are read as the lines.
- [x] **The second pull** (`src/agents/pull.js`, `roles/second-pull.md`, `silver pull`, shift step 4b). The Archivist's diary notes it.
- [x] `taste.md` (local): the Likes/Dislikes placeholders now hold the owner's own words from the brief; the default header's examples no longer recommend pop.

## Phase 10: the admin ✅ (2026-11-04)

The owner's brief: make the web interface better; a real admin; no login, since it runs locally; edit the souls from the browser; restart the agent, or have it pick up edited code and markdown by itself; decide what's editable; steer how the works get made.

- [x] **The back room** (`src/admin/`): Today, Review, Subjects, Studio, Souls, Taste, Floor, Canon, Diary, Gallery, Jobs, System. Server-rendered forms with no framework or build step; everything works with JavaScript off, and the script adds the keyboard, a lightbox, forms that keep your place, and live updates. The look is a darkroom: film rebate, amber frame numbers, grease pencil for decisions. `silver review` still works and opens at the contact sheet.
- [x] **Steering**: `direction.md` per audience (Scout, superstars, assistants, Warhol); pins for one series (`steer`: procedures, models, temperatures, dare, note); procedures benched or favoured (`steering.techniques`, 0–3); a line said by the human on the floor, dealt as a brief like anyone's; `subject.pinned` to move any subject to the front; a second pull with a note, of any variant, again; `shift.paused`.
- [x] **Settings** (`src/settings.js`, `studio.json`): an overlay validated as a whole by `validateConfig` before anything is written. Paths, the port and the deploy provider can't be set. A broken one stops the shift with the reason, rather than spending money on settings nobody chose; the admin still starts, to fix it.
- [x] **Souls** (`src/admin/souls.js`, `contract.js`): `{{placeholders}}` a role isn't given are refused (they would stop it on its next call), dropped ones warned about, a save based on an old version refused, a file that doesn't load opened whole. Superstars can be cast, benched and recalled. `silver audition` hears one without touching the floor.
- [x] **Jobs** (`src/admin/jobs.js`, `run-job.js`): every piece of work is a fresh CLI process with its own runner, a JSON file and a log in `archive/jobs/`. They survive an admin restart. One per lane, because budget reservations only hold inside a process; printing has its own lane; a shift from launchd holds the studio lane.
- [x] **The supervisor** (`src/admin/supervisor.js`, `silver install-admin`): watches code, `silver.config.js`, `package.json` and `.env`; restarts on a change that parses and loads; keeps the old server otherwise; serves the error if the server can't boot. `node --check` is no use here: it lets ES modules with syntax errors through, so modules are compiled with `vm.SourceTextModule`.
- [x] **Evidence next to the controls** (`src/admin/stats.js`, `status.js`): made, died, picked and approved per procedure, hand and superstar, with refusals for lack of credit kept out of a model's failure rate. Today says what's wrong: no credit, thin series, unseen series, a failed backup.
- [x] **The gallery** (`src/site.js`): a wall of works with a filter by procedure, a work page with its label beside it, arrow keys, an About page, a 404. Relative links, so the admin can preview the real build.
- [x] **An independent review, and what it found** (a fresh reviewer on the diff, then each finding fixed and tested): Stop didn't stop a job (Playwright takes SIGTERM and leaves the process running, so the runner now follows up with SIGKILL); launchd could start a shift alongside one from the admin, and a crashed shift blocked the queue for hours (`archive/.shift.lock`, held only while the process lives); moving the time could kill a running shift or leave the schedule unloaded without a word; a sketch could leave its sandbox by asking for `Sketch.html` on this case-insensitive disk (every gallery page is sandboxed now); talking or making a series by hand before 09:00 shrank that day's shift (`byHand`; talk from before the Scout doesn't count); the `a` key could sign a card you couldn't see; a publish whose deploy failed said "done"; "Another round" and "Next in line" described things that wouldn't happen; a `##` heading in a direction lost text; preflight only checked the newest save and blamed code for a broken `studio.json`; taste and direction could overwrite a newer edit.
- [x] **Fixed on the way**: gray-matter's cache (it never shrinks, and hid a broken role's real error on a second read); a `javascript:` URL from a feed becoming a link; a second pull of a variant whose procedure has left the menu; bulk closing the backlog (open question 6 of 2026-10-23).

## Later (not v1)

- The Technician goes live: an agent that proposes and writes new techniques and templates, gated by `tool.released`
- More sources: product catalogs (the soup cans), Wikipedia most-read
- Social channels for Fred Hughes (Bluesky/Mastodon)
- Image-model techniques (photo-silkscreen) alongside p5
- Continuous tempo: floor subscribers instead of a sequential shift

## Decisions taken on 2026-09-24

The open decisions from Phases 0–2 were answered on 2026-09-24. They are summarised in the decisions table at the top, and the resulting work is in **Phase 2b** and the later phases. For the record, each question and the options that were considered:

1. **Sensitive subjects:** real, recent victims (the Scout had picked Navy suicide attempts and photos of slain children). *Chosen:* exclude suicide, children and named private victims, and flag other sensitive subjects. *Considered:* keep open, flag only, exclude only.
2. **Copyrighted text in a public repo:** resolved earlier the same day. Data stays out of git, and the history was rewritten and force-pushed. *Remainder:* GitHub serves the orphaned commits `20a76a8` and `b8187bd` by hash until its own GC runs, and GitHub Support can purge them sooner. The gallery quotes at most a headline.
3. **Real people's likenesses:** *Chosen:* case by case at the veto. *Considered:* public figures only; no real faces.
4. **Source language / region:** *Chosen:* keep the English + Dutch mix with US Trends. *Considered:* add NL Trends, switch to NL, English only. **Gallery language:** *Chosen:* English. *Considered:* source language, Dutch, bilingual.
5. **Commissions vs the series cap:** *Chosen:* commissions fill the slots first and the rest waits. *Considered:* all commissions always; a separate cap.
6. **Scout annotates commissions:** *Chosen:* yes, never overwriting the human's `--why`. *Considered:* image line only; no.
7. **`--now`:** *Chosen:* chatter + series + shortlist. *Considered:* series only; series + shortlist.
8. **Repeat subjects:** *Chosen:* a 7-day window for scouted subjects; commissions always allowed. *Considered:* forever, 30 days, 90 days.
9. **Reddit NSFW:** *Chosen:* keep r/all for now and switch if NSFW appears. *Considered:* curated subreddits now; drop Reddit.
10. **Licence:** *Chosen:* MIT for code, CC BY 4.0 for artworks. *Considered:* CC BY-NC for works; all rights reserved for works; stay UNLICENSED.
11. **Backup of the local record:** *Chosen:* a private data repo pushed by the Archivist. *Considered:* Time Machine only, a sync folder or rsync, tarballs.

## Decisions taken on 2026-09-25

The open points from the Phase 2b/3 night shift were answered on 2026-09-25. They are summarised in the decisions table at the top, and the resulting work is in **Phase 3b**, Phase 4 and Phase 8. For the record:

1. **DeepSeek in the studio pool.** It produced 2/12 across three live series (Gemini 8/8, GPT-6 Luna Pro 11/12, Sonnet 4/4). It thinks for 8k–15k tokens on the studio brief, and its providers (Alibaba, AtlasCloud, Relace, NextBit) ignore `reasoning.effort` and `reasoning.max_tokens`, even with `provider.require_parameters`. *Chosen:* replace it with Qwen 3.8 Flash, keeping four different houses for drift. *Considered:* Kimi K3 (strong, but priced like Sonnet), a 3-model pool, keeping DeepSeek.
2. **Sonnet's cost share.** About $0.056 per variant, 6–13× the others; ~$0.27 for a series with Sonnet against ~$0.05–0.11 without. *Chosen:* keep it in rotation. *Considered:* writing roles only; at most one slot per series (which is already the case).
3. **p5 1.x vs 2.x.** *Chosen:* stay on 1.11.13 for v1. *Considered:* move to 2.x now.
4. **Subjects from before the exclusion rule.** *Chosen:* a `subject.retired` event with `silver subjects --retire`. *Considered:* skip subjects posted before a date; leave it to the veto.
5. **Technique adherence.** *Chosen:* keep off-technique variants as drift, with Warhol noting it. *Considered:* pure drift; re-prompting after a vision check.
6. **Spend that never reaches the ledger.** *Chosen:* `silver cost --reconcile` against OpenRouter's key usage. *Considered:* the budget reading real usage before each call; ignoring it.
7. **Screenshots per variant for Warhol.** *Chosen:* 1 (seed 1). *Considered:* 3 seeds per variant; 1, plus 3 for his picks.

New open questions go here as they come up.

## Decisions taken on 2026-09-25 (Phase 5 and the day shift)

The open questions from Phase 5 and the day shift were answered on 2026-09-25. They are summarised in the decisions table at the top, and the resulting work is in **Phase 5b**. For the record:

1. **Print-check concerns.** *Chosen:* flag only for now; show the concern at review later. *Considered:* hold works with a concern back; run the print check before the veto now.
2. **Repeated titles.** *Chosen:* show Fred Hughes the series' earlier titles, so he varies or numbers them. *Considered:* keep repeats.
3. **The invented fact in No. 016.** *Chosen:* a `silver retitle` command that releases a correction; the site shows the latest. *Considered:* leave it; build it and fix No. 016 in one go (No. 016 is fixed as the first use anyway).
4. **Poster frame.** *Chosen:* the later frame. *Considered:* keep frame 30; the Printer picks per work.
5. **Vercel project.** *Chosen:* `silver-factory`. *Considered:* `silver` (likely taken); a custom domain later.
6. **The $0.38 reconcile gap.** The key is shared with other agents, so the gap is expected. *Considered:* a Silver-only key now.
7. **Unshortlisted backlog.** *Chosen:* shortlist the three real series once by hand. *Considered:* leave them; have the shift catch up on the last N days.
8. **Dry-run subjects.** *Chosen:* mark them, so the real shift scouts anyway. *Considered:* keep them as real subjects.

## Open questions from Phase 5 (2026-09-25)

**All answered on 2026-09-25**: see the decisions above and Phase 5b.

1. **Go live on Vercel.** Everything up to the deploy works. To publish:
   - add `VERCEL_TOKEN=...` to `.env` (from vercel.com/account/tokens),
   - then run `silver publish`. The first deploy creates and links the Vercel project `deploy.project` (`silver-factory`).
   - *Questions:* is `silver-factory` the project name you want? A custom domain? Once the URL is known, set `deploy.siteUrl` so the feed and share images get absolute links.

2. **What the print check does with a concern.** I defaulted to **flag, never block**: the work is signed and published, and the concern is recorded (`printCheck.verdict: concern`). The first run flagged No. 003 ("Mamdani/Met" v11: the portrait layer never develops).
   - *Options:* (a) keep flag-only; (b) hold works with a concern back from the site until you look; (c) show the concern on the review page, so you can veto before printing.
   - *Recommendation:* (c) later, (a) for now.

3. **Repeated titles.** Fred Hughes gave three sushi works the same title, "Seventy-Eight Dollar Sushi (Disaster)", and two Met works "70,000 Opera Seats (Lottery)". That's Warholian, but it may confuse visitors.
   - *Options:* (a) keep it; (b) show Fred Hughes the titles already used in the same series, so he varies them or numbers them deliberately ("… (Disaster) II").
   - *Recommendation:* (b).

4. **An invented fact reached a wall label.** No. 016, "One Million Coffees (Free Refill)", comes from a subject posted before the Scout's facts-only rule: its note invented "one million paper cups", and Fred Hughes used it. Editions are append-only.
   - *Options:* (a) leave it, since it's the record; (b) a `silver retitle <No.> --title … --wall …` command that releases a correction (a new `edition.released` for the same work), and the site shows the latest.

5. **The poster.** It's frame 30 at seed 1, which isn't always the best frame of a live piece.
   - *Question:* is a later frame better for pieces that build up over time (for example the "later" look the Printer already takes)?

## Open questions from the 2026-09-25 day shift (Phases 3b, 4 and 8)

**Answered on 2026-09-25**: 3 (shared key), 4 (shortlist once) and 5 (mark dry runs); see the decisions above and Phase 5b. Still yours: 2 (write `taste.md`).

1. **Install the daily schedule?** **Done 2026-09-25:** installed by the owner at 11:09 and loaded in launchd (`com.silver.shift`, daily at 09:00). `.env` holds the key, and a check with an empty environment (as launchd runs it) reached OpenRouter. The first unattended run is 2026-09-26 at 09:00. Everything is built. To start:
   - put `OPENROUTER_API_KEY=...` in `.env` (launchd doesn't see your shell's variables; today the key lives only in your shell),
   - then run `silver install-schedule`.

   It runs `silver shift` daily at `shift.at` (09:00) and spends real money within the $5 cap: about $0.30–0.60 a day at 2 series plus shortlists. If the Mac is asleep at 09:00, the shift runs on wake; if it's off, that day is skipped.
   - *Questions:* install now, or after a first real (non-dry-run) shift by hand? Is 09:00 right?

2. **Write your taste.** `taste.md` exists as a template (it appears on the first `silver review`). Warhol reads its header before every shortlist, together with your latest decisions. Until you write your likes and dislikes, he only has his own taste.

3. **An all-time reconcile gap of $0.38.** OpenRouter billed $0.92 on this key; the ledger holds $0.53. Known causes: my direct `curl` tests (under $0.10), one test in a throwaway folder, and three DeepSeek timeouts.
   - *Question:* was this key also used outside Silver this month? If so, the gap is expected, and a dedicated key for Silver would make `--reconcile` exact.

4. **Unshortlisted series from before Phase 4.** The shift only shortlists *today's* series, so the four earlier series (three real, one dry run) have no Warhol shortlist. `silver shortlist <id>` does them by hand, at about $0.06 each on Opus.
   - *Options:* (a) leave them; (b) shortlist the backlog once, by hand; (c) have the shift also shortlist any unlisted series from the last N days.
   - *Recommendation:* (b) now, then (a).

5. **Dry-run scouting posts real subjects.** A dry-run shift scouts with the cheap model, and its picks are real subject cards on the floor. The next real shift then skips scouting that day, because scouts run once a day. Dry-run series and shift ends are already kept separate.
   - *Options:* (a) keep it: they're real subjects, just picked by a cheaper Scout; (b) mark dry-run subjects so the real shift scouts anyway and the series picker ignores them.
   - *Recommendation:* (b) if you plan to dry-run often on days the real shift also runs.

6. **Node path in the schedule.** The plist pins the absolute path of the `node` binary that installed it (`/usr/local/bin/node` here). If you upgrade Node through a version manager and that path changes, re-run `silver install-schedule`. No decision needed; this is a note.

## Open questions from Phase 5b (2026-09-25)

1. **The Vercel token.** `.env` has `VERCEL_TOKEN=` with no value, so nothing is live yet. Fill it in and run `silver publish --redeploy`. **Done 2026-11-05.**
2. **No. 017 carries the same invented number in the artwork itself.** "One Million Free Coffees (Dunkin)" prints "1,000,000 FREE COFFEES" in the sketch, from the same pre-rule Scout note. A retitle only fixes the label.
   - *Options:* (a) leave it, since the label can say what the image claims; (b) retitle the label only; (c) a way to withdraw an edition from the site (a `work.withdrawn` event), keeping its number as a gap in the record.

## Decisions taken on 2026-09-25 (Phases 6 and 7)

1. **The record's GitHub repo.** *Chosen:* private, created as `y-a-v-a/silver-record` (pushed over SSH, which also works under launchd without an agent). The first push holds 343 files.
2. **Qwen's 429s.** *Chosen:* a fallback. `models.fallbacks` maps `qwen/qwen3.8-flash` to `google/gemini-3.8-flash`; the request carries OpenRouter's `models` list, the budget reserves for the dearer model, and the cost follows the model that answered. Verified live.
3. **Pushed subjects.** *Chosen:* a subject a superstar pushes keeps jumping ahead of the Scout's picks (after commissions).
4. **Personas after real people.** No preference; they stay as they are, local chatter only.
5. **Gossip reaching the canon.** *Chosen:* the human veto is enough.

## Open questions from Phases 6 and 7 (2026-09-25)

**All answered on 2026-09-25**: see the decisions above.

1. **Create the private GitHub repo for the record?** The record exists locally in `.record/` (337 files, 18 MB, grows by roughly 5–10 MB a day, mostly PNGs) and is committed after every shift. Pushing it needs a private repo on your account: `npx silver init-record --github silver-record --yes`. I didn't run it, because it creates something on GitHub.
   - *Questions:* is `silver-record` the name you want? Private is the decision; the repo holds page snapshots and quoted headlines, so it must stay private.
2. **Qwen's provider rate limits (HTTP 429).** In the live dry-run shift, 2 of 3 superstars and both dry-run shortlists failed on 429s from Qwen's upstream provider, after 4 retries each. The shift carried on, but the chatter was thinner.
   - *Options:* (a) leave it, since chatter is noise and a thin day is fine; (b) use OpenRouter's `models` fallback list, so a 429 moves to a second cheap model (e.g. Gemini 3.8 Flash); (c) space the superstar calls out.
   - *Recommendation:* (b) for superstars and dry runs.
3. **How often a superstar pushes a subject.** `superstars.proposeChance` is 0.34: on about one shift in three, one superstar sees the Scout's leftovers and may push one, and the pushed subject jumps the queue (after commissions). Nobody pushed on the first two runs.
   - *Question:* keep the jump, or treat a pushed subject like any scouted one?
4. **Superstar personas are after real people** (Brigid Berlin, Ondine, Viva). They are voices on the local floor only, never on the public site. Keep it that way, or rename them to invented personas if the chatter is ever published?
5. **The studio brief now invites stealing from the chatter.** The A/B showed chatter only changes the work when the brief says so; now lines like "the surveillance is polite" end up printed on the image. That's the intended cross-contamination, but it means gossip can reach the canon through an approval. Your veto is the check; is that enough?

## Where things stand (2026-09-25, end of day)

v1 is built (Phases 0–8). What is left, in order:

**Tomorrow, after the 09:00 shift** (the first unattended run with superstars, the diary, the Qwen fallback and the record push):
- [x] Check the run. **2026-09-26 09:00, unattended:** 6 subjects scouted, 2 series (Excel multi-value cells, Dolly Parton Day) at 12/12 each, Warhol shortlisted both, the diary was written (331 words), and the record was pushed (`fbff1b9`). $0.72. **Found and fixed:** Brigid and Ondine failed because Qwen was rate-limited and its Gemini fallback rejects `reasoning: off` (the superstars now use `reasoning: 256`; verified live on both models). The diary gave UTC times ("started at 7"); the notes now use local time. The Qwen studio variants fell back to Gemini without trouble.

**Yours:**
- [x] **Go live on Vercel** (2026-11-05): https://silver-factory.vercel.app.
- [ ] **Write your taste:** a few lines at the top of `taste.md` on what you like and don't. Warhol reads them before every shortlist; until then he has only your approve/veto log.
- [ ] **Decide on No. 017** (see the open questions from Phase 5b): (a) leave it, (b) correct the label only, (c) a way to withdraw an edition from the site while its number stays in the record.

**To build next (v1 remainder):**
- [ ] **The print check on the review page, before the veto** (Phase 5b, "later"). Run it when a series is shortlisted and show the verdict on the contact sheet, so a concern can be vetoed before printing. About an hour.
- [ ] **No. 017's option**, once decided.

**Then v2**, from "Later (not v1)", roughly by how much it changes the output:
1. **Image-model techniques** (photo-silkscreen) alongside p5: the biggest visual jump, closest to Warhol's screen prints. *Recommended first.*
2. **The Technician goes live:** an agent that proposes and writes new techniques and templates, gated by `tool.released`.
3. **More sources:** product catalogues (the soup cans), Wikipedia most-read.
4. **Social channels for Fred Hughes** (Bluesky/Mastodon), after Vercel is live.
5. **Continuous tempo:** floor subscribers instead of one sequential shift.

## Where things stand (2026-10-23, after the night shift)

Phase 9 is built on the branch `night-shift/wilder` (local, not pushed). The 09:00 launchd job runs from this working tree, so today's shift is the first real one with the new studio.

**How it was checked**
- A bake-off of 12 models on one subject (the Amelia Earhart "debris" that was a clump of trees), then 8 sandbox series on real subjects with real chatter, on a copy of the floor (`SILVER_ROOT`), never the real one.
- A full shift rehearsal on a fresh sandbox at the real $5 cap: 6 subjects, 11 lines from 4 superstars, 2 series (23/24 produced), 2 shortlists, 2 second pulls, the diary. **$1.92.** With the dearest trio (Opus, Sonnet, Gemini 4) twice, a shift is about $2.80.
- 319 tests pass, including the browser tests.
- The real floor got one event tonight: the Technician's `tool.released` note for the new template.
- Tonight's experiments cost about $7.60 on the shared OpenRouter key, so the 09:00 reconcile will show a gap for the UTC day.

**Open questions**
1. **Merge `night-shift/wilder` into `main`?** It's already what runs; merging and pushing is yours.
2. **The cost.** About $2–2.80 a shift now, against ~$0.60 before, still inside the $5 cap. To make it cheaper, drop Opus 5.5 from `models.studio` (it costs about twice as much per variant as the others); the cheapest strong pool is Sonnet 5.5, Gemini 4 Argon, Kimi K3 and GPT-6 Luna Pro.
3. **Nico.** A fourth persona after a real person, like the others. Keep her?
4. **The second pull.** `series.secondPulls: 1`. Keep it, raise it to 2–3, or set 0.
5. **`taste.md`.** The Likes/Dislikes lines now quote your brief to the night shift, so Warhol reads them. Rewrite them in your own words whenever you like.
6. **The backlog.** 54 pop-era series are still waiting for review. Leave them, or should there be a way to close old reviews in bulk (`silver review --close-before <date>`)?
7. **Next for the look:** non-square formats (tall film strips and receipts, wide spectrograms and seismographs). It touches the renderer, review page, site and Printer, so I left it for a day shift.
8. **Sandbox works into the canon.** The night's ~100 works live in the scratchpad, not on the floor. Their subjects are still open on the real floor, so `silver series KFYMM1W8` (loudspeakers), `RY5JX2EK` (Earhart), `2XW9HJX5` (pink diamond), `TSB4A37W` (checkers), `7Y2VF4S9` (satellites) or `N3SYZE87` (cheese receipt) makes a real series of any of them. Each uses a series slot and about $1 of that day's budget.
9. **Four labels lost a closing quote.** A bug in Fred Hughes's label cleaning (fixed tonight, `0fc3d6d`) cut the closing quote off wall texts ending on a quoted headline: No. 001, 003, 004 and 020. A correction is a new `edition.released` on your floor, so I left it to you. Each command below restores the quote:

   ```sh
   npx silver retitle 1 --wall "A ready-made built from a headline: 70,000 free opera tickets given away over the season, 10,000 a month, by lottery, seats in every section of the house. Rendered as a screen-test-portrait by the Factory's studio assistants, chosen by Warhol, signed by the human. Wall quote: \"Every New Yorker should have the opportunity... no matter what's in their bank account.\""
   npx silver retitle 3 --wall "The ready-made is a public giveaway: a mayor and an opera house offering 70,000 free tickets in a monthly lottery, seats in every section. Rendered as a screen-test-portrait by the Silver Factory's studio assistants, chosen by Warhol, signed by the human. Headline: \"Every New Yorker should have the opportunity... no matter what's in their bank account.\""
   npx silver retitle 4 --wall "The ready-made is a mayor's giveaway of opera tickets, distributed by lottery, ten thousand a month, seats in every section of the house. Rendered in grid-repeat by the Silver Factory studio assistants, chosen by Warhol, signed by the human. Headline: \"Every New Yorker should have the opportunity... no matter what's in their bank account.\""
   npx silver retitle 20 --wall "This ready-made is a corporate software update: Microsoft's announcement that a spreadsheet cell can now hold more than one value. Rendered in halftone by Factory assistants, chosen by Warhol and signed by the human. The headline reads, \"Excel now supports multiple values in a single cell.\""
   ```

## Where things stand (2026-11-04, after the admin)

Phase 10 is on `night-shift/wilder` (local, not pushed), which is also what the 09:00 job runs. 462 tests pass, browser tests included. It was driven in a real browser against a clone of the record and a mock OpenRouter, including a full dry-run shift through the job queue. On the real record, a read-only crawl of 700 pages found no errors and left the floor byte for byte the same. One real model call was made from the sandbox (`silver audition nico`, $0.00041), so the new prompt path has met a real model once; a full series on the new prompts hasn't, because the account is out of credit.

**Open questions**
1. **Start the admin for good?** `npx silver install-admin` keeps it running at `http://silver.localhost:4747`. It wasn't installed, because that's a new always-on service on a machine shared with your other agents.
2. **OpenRouter credit.** The shifts have been failing on HTTP 402 since about 2026-11-01 (today 9 of 24 variants, and Warhol looked at none). Today shows it first. The key is shared, so another agent may be what's draining it.
3. **The backlog.** 82 series were waiting on 2026-11-04, and no decision has been made since 2026-09-26. Review now has "Clear the backlog" by date; 2026-10-23 is the day the pop-art studio ended.
4. **Superstars and the new note.** The personas' files aren't touched: the human's standing note reaches them in the user message next to the house rules, not in the soul.

