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

## Stack

- Node 24, ESM, plain JavaScript with JSDoc types. No build step.
- Minimal dependencies:
  - `gray-matter`: role file frontmatter
  - `rss-parser`: news and Google Trends feeds
  - `commander`: the CLI
  - `ulid`: event ids
  - `playwright`: headless render and screenshot of sketches
  - `vercel`: deploy CLI, as a dev dependency
- No database. The floor is JSONL and everything else is files on disk.
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
    warhol.md
    printer.md
    fred-hughes.md
    archivist.md
    technician.md
    superstars/
      brigid.md
      ondine.md
      viva.md
  taste.md                  # append-only log of human approve/veto notes; read by Warhol
  src/
    cli.js                  # `silver` entry point
    floor.js                # append/read/subscribe to the event log
    llm.js                  # OpenRouter client, cost tracking, transcript capture
    roles.js                # loads roles/*.md → { meta, systemPrompt }
    budget.js               # daily ledger, hard cap
    shift.js                # orchestrates one daily shift
    agents/
      scouts.js
      superstars.js
      assistants.js
      warhol.js
      printer.js
      hughes.js
      archivist.js
    sources/
      google-trends.js
      hackernews.js
      reddit.js
      rss.js
    tools/                  # the Technician's workbench (hand-built in v1)
      p5-template.html
      render.js             # Playwright: run sketch, catch errors, screenshot
      contact-sheet/        # local review web app
  floor/                    # YYYY-MM-DD.jsonl, append-only, never edited
  archive/
    transcripts/            # every LLM request+response, by event id
    variants/<series-id>/   # every sketch + screenshot, including rejects
    diary/                  # Archivist's daily entries (YYYY-MM-DD.md)
  canon/
    canon.json              # signed works, edition numbers, hashes
    works/<canon-id>/       # final sketch, poster PNG, wall text
  site/                     # generated static gallery → Vercel
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
reasoning: low                      # optional: off | low | medium | high
---

You are Andy Warhol at the Factory. You did not make these; your assistants did.
Your job is to choose. ...

## Output
Return JSON: { "picks": [{ "variant_id": "...", "note": "..." }], "rejects_note": "..." }
```

Rules:
- `roles.js` validates the frontmatter and fails loudly if a field is missing or unknown.
- Reasoning tokens count against `max_tokens`. A reasoning model can spend all of them thinking and return an empty reply, so set `reasoning` (use `off` for chatter) and leave enough headroom.
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
| `variant.produced` | assistant | series id, path, model, temperature, technique, seed |
| `variant.failed` | renderer | series id, error (kept in the archive, since failures are material) |
| `series.completed` | orchestrator | series id, variant ids, contact-sheet path |
| `shortlist.proposed` | Warhol agent | picks with notes, reject note |
| `review.decision` | **human** | variant id, approved\|vetoed, note (this also appends to `taste.md`) |
| `work.published` | printer | canon id, edition, URL, render hash |
| `edition.released` | Fred Hughes | work id, channel (`site`, `rss`), edition number |
| `cost.recorded` | llm client | model, tokens, USD, ref |
| `llm.failed` | llm client | role, model, error, attempts, reason (`empty`, `invalid-json`) |
| `diary.written` | archivist | path |

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
- [x] `silver commission "<text | URL>" [--now]`: emits `subject.posted` with `origin: commission`. Commissions **always get a series** in the next shift, ahead of scouted subjects. `--now` runs a mini-shift for just that subject. **Partly done:** `--now` needs the studio (Phase 3), so for now it queues and says so. Also added `--why <note>` and `--list` (commissions still waiting for a series).
- [x] `silver scout`: runs the scouts on their own (useful for tuning). Options: `--count`, `--source`, `--list` (no model call), `--no-snapshot`, `--dry-run`, `--json`.

**Done when:** `silver scout` posts ~6 subject cards to the floor, each showing a "why it's a ready-made" line that makes sense. ✅ The first live run on 2026-09-24 posted 6 cards for $0.0086. Its notes embellished facts, which led to the facts-only rule; the rerun stayed factual.

## Phase 3: Technician tools and Studio assistants

- [x] Write `roles/technician.md` (done in Phase 1). It is used in v1 only for its voice: when a template changes, the human runs `silver release <tool>` and the Technician writes the release note as a `tool.released` event.
- [ ] `tools/p5-template.html`: a single file that loads p5 from a pinned CDN version with an injected `// SKETCH` block
  - [ ] Seeds from `?seed=` (`randomSeed` + `noiseSeed`), so screenshots are reproducible while a normal load still drifts
  - [ ] Fixed canvas size (e.g. 1080×1080), with a `window.__silverReady` flag set after N frames
  - [ ] Embeds the title and subject as a comment/metadata, with no visible UI chrome
- [ ] `tools/render.js` (Playwright):
  - [ ] Loads the sketch, collects console errors, waits for `__silverReady` or a timeout
  - [ ] Takes a screenshot at seed 1 (and optionally seeds 2 and 3, for a small grid)
  - [ ] Blank-canvas check: near-uniform pixels count as a failure
  - [ ] Emits `variant.failed` on error or blank output, otherwise returns the PNG path
- [ ] Write `roles/studio-assistant.md` (Malanga/Smith): turn a subject into a p5 sketch in a given **technique**; serial repetition, silkscreen logic (flat colour fields, registration offset, grids of repeats, photo-to-halftone); output only the sketch body.
- [ ] A technique menu in config, e.g. `grid-repeat`, `misregistered-silkscreen`, `halftone`, `camouflage`, `death-and-disaster-tint`, `screen-test-portrait`. Each is one line of guidance injected into the prompt.
- [ ] `agents/assistants.js`: for each subject selected in this shift → `series.started` → run the 12-cell matrix (models × temperatures × techniques) in parallel, with a concurrency limit → write to `archive/variants/<series>/<variant>.html` → render → `variant.produced` / `variant.failed` → `series.completed` with a generated contact sheet
- [ ] **Keep the drift:** assistants do not get to see each other's variants within a series. Each one gets the subject plus the recent floor chatter only.

**Done when:** `silver series <subject-id>` produces a folder of 12 sketches with screenshots, and broken ones are recorded rather than dropped.

## Phase 4: Warhol and the contact sheet (veto)

- [ ] `taste.md`: starts with a short hand-written header of what the human likes and dislikes. After that it is append-only: one entry per human decision, with date, variant, verdict, and note.
- [ ] Write `roles/warhol.md`: terse, flat, deadpan; chooses the piece, never makes it; judges *seriality and surface*, not effort. Its `{{taste}}` placeholder receives the last N entries of `taste.md`. Output: 1–3 picks per series with a one-line note each, plus a note for the rejects.
- [ ] `agents/warhol.js`: on `series.completed`, sends the screenshots (vision) and the sketch metadata (not the full code, which would bias it toward code quality) → `shortlist.proposed`
- [ ] `tools/contact-sheet/`: a small `node:http` server, with no framework
  - [ ] `silver review` starts it on `localhost:4747` and opens the browser
  - [ ] One page per series: a grid of **live** sketches in iframes, with Warhol's picks highlighted and his notes shown
  - [ ] The Floor chatter for that subject is shown in a side column
  - [ ] Each pick has Approve / Veto and an optional note field. Posting a decision emits `review.decision` and appends to `taste.md`.
  - [ ] The human may also approve a variant Warhol did **not** pick (the veto works both ways)
  - [ ] Pending reviews persist across shifts until they are decided
- [ ] Rejected and vetoed variants stay in `archive/`, since nothing is ever deleted

**Done when:** after a shift, `silver review` shows Warhol's shortlist, and approving one emits the decision and grows `taste.md`.

## Phase 5: Printer, Fred Hughes, Vercel

- [ ] Write `roles/printer.md`. The Printer is mostly code; the LLM is used only for a final "print check" (does the sketch hold up at full size, and does it run for more than 60s without degrading?). It may send the piece back as a floor event, but it cannot un-sign it.
- [ ] `agents/printer.js`, run on `review.decision: approved`:
  - [ ] Copies the sketch to `canon/works/<canon-id>/`, removes the dev seed so the published piece drifts on every load
  - [ ] Renders a poster PNG (fixed seed) for thumbnails and OG images
  - [ ] **Signature:** sha256 of the sketch source + Warhol's note + the human approval event id, stored in `canon.json`
  - [ ] Emits `work.published`
- [ ] Write `roles/fred-hughes.md`: the business side: a title (Warhol-flat: "Silver Car Crash (Double Disaster)"-style), short wall text, edition number
- [ ] `agents/hughes.js`: assigns sequential edition numbers, writes the wall text, regenerates the site, emits `edition.released`
- [ ] Static site generator `src/site.js` → `site/`:
  - [ ] `index.html`: the canon as a grid of posters, newest first
  - [ ] `works/<id>/`: the live sketch, full-bleed, with wall text below
  - [ ] `feed.xml`: an Atom feed of the editions
- [ ] Deploy with `vercel deploy site --prod --token $VERCEL_TOKEN --yes`. Record the URL in `work.published`.
- [ ] `silver publish`: rebuilds and redeploys by hand

**Done when:** approving a variant in the contact sheet results in a live Vercel URL and a new feed entry.

## Phase 6: Superstars

- [ ] Write 3 persona files in `roles/superstars/` (e.g. Brigid: tape-recorder gossip; Ondine: amphetamine monologue; Viva: withering commentary). Each is **cast talent**: a strong voice with opinions about the subjects.
- [ ] `agents/superstars.js`: after the Scouts, each superstar reads the shift's subjects and recent chatter → 1–3 `chatter.posted` events, and occasionally a `subject.posted` (blurry roles)
- [ ] Run chatter on the cheap model and cap it per shift in the budget
- [ ] The chatter goes into the assistants' prompts (`{{floor_excerpt}}`) and appears on the contact sheet

**Done when:** series visibly change when the chatter changes (A/B the same subject with and without chatter once).

## Phase 7: Archivist

- [ ] `agents/archivist.js` (code): after each shift, checks that every event has its transcript or artifact, writes a shift manifest and a summary of the shift. It does **not** commit to git, since data stays out of the repo (see the backup decision below).
- [ ] Write `roles/archivist.md` (Billy Name / Pat Hackett): writes a diary entry from the day's floor (who said what, what got made, what died) → `archive/diary/YYYY-MM-DD.md` → `diary.written`
- [ ] **Feedback loop** (principle 3): Scouts treat the diary and the reject pile as an extra source, with `origin: archive`, and at most one archive subject per shift

**Done when:** a diary entry exists for each shift, and an archive-origin subject appears within a week.

## Phase 8: the daily shift and launchd

- [ ] `src/shift.js`: `shift.started` → scouts → superstars → pick subjects (commissions first, then scouted) → assistants (N series) → Warhol shortlists → archivist → `shift.ended`
  - [ ] Idempotent per date: running it twice on one day continues the shift without duplicating it
  - [ ] Stops cleanly on `BudgetExhausted` and records the reason
  - [ ] Printing happens **outside** the shift, at the moment of human approval, because the veto is async
- [ ] `silver shift [--dry-run]`: dry-run uses the cheapest model and 2 variants
- [ ] A macOS notification at the end of a shift (`osascript -e 'display notification …'`) saying "N series waiting for review"
- [ ] `launchd/com.silver.shift.plist`: `StartCalendarInterval` (e.g. 09:00), absolute paths to `node` and the repo, and logs to `archive/logs/`
- [ ] `silver install-schedule`: copies the plist to `~/Library/LaunchAgents/` and runs `launchctl bootstrap`. `silver uninstall-schedule` reverses it.
- [ ] Document that if the Mac is asleep at the scheduled time, launchd runs the job on wake

**Done when:** the Mac runs a shift unattended overnight, the notification appears, and the review → publish flow works the next morning.

## Later (not v1)

- The Technician goes live: an agent that proposes and writes new techniques and templates, gated by `tool.released`
- More sources: product catalogs (the soup cans), Wikipedia most-read
- Social channels for Fred Hughes (Bluesky/Mastodon)
- Image-model techniques (photo-silkscreen) alongside p5
- Continuous tempo: floor subscribers instead of a sequential shift

## Open decisions (need your call)

These came up while building. Each lists what the code does **today**, so nothing is blocked, plus the options and my recommendation. Answer inline or tell me, and I'll update the code and this list.

1. **Sensitive subjects.** The first live Scout run picked US Navy suicide attempts and an Iranian president holding up photos of slain children. That is squarely Warhol's *Death and Disaster* territory, but these are recent, real, identifiable victims.
   - *Today:* no filter. Anything in the news can become a subject, and your veto is the only gate.
   - *Options:* (a) keep it open, since the veto is the gate; (b) let the Scout pick disasters but exclude suicide, children and named private victims; (c) mark sensitive subjects so they show a warning on the contact sheet.
   - *Recommendation:* (b) + (c). The Scout rule is one paragraph in `roles/scout.md`, and the flag is one field on the card.

2. **Copyrighted text in a public repo.** **Resolved 2026-09-24.**
   - Data stays out of git, so new snapshots never reach GitHub.
   - The history was rewritten with `git filter-branch`: `floor/`, `archive/`, `canon/` and `taste.md` were removed from every commit, and `main` was force-pushed. The code is identical, and every commit hash changed.
   - *One remainder:* GitHub keeps orphaned commits fetchable by their exact hash until its own garbage collection runs. No branch or listing leads to them, but anyone holding an old hash can still open them. To purge them immediately, ask GitHub Support to remove the cached views (their "removing sensitive data" procedure) and give them the two old commit hashes `20a76a8` and `b8187bd`.
   - *Still applies to publishing:* the gallery (Phase 5) is public, so wall text should quote at most a headline, never article text.

3. **Real people's likenesses.** Subjects include public figures (McConnell, Trump, Xi), and the works will depict them. Warhol did exactly this, but the published gallery will be public.
   - *Options:* (a) allow public figures, never private individuals; (b) no identifiable real faces, only objects and scenes; (c) decide case by case at the veto.
   - *Recommendation:* (a), written into the Scout and assistant roles.

4. **Language and region of the sources.** The feeds mix English and Dutch (NOS), and Google Trends is set to `US`.
   - *Options:* (a) keep the mix, since multilingual noise is floor texture; (b) English only; (c) switch Trends to `NL` or add both.
   - *Also:* should titles and wall text on the gallery be English, Dutch, or the language of the source?

5. **Commissions and the series cap.** `shift.seriesPerShift` is 2. If you commission 5 subjects in one day, then:
   - *Options:* (a) commissions may exceed the cap, so all get a series; (b) commissions fill the slots first and the rest wait for the next shift; (c) commissions get their own separate cap.
   - *Today:* not built yet (Phase 8 decides). *Recommendation:* (b), plus `silver commission --now` for anything urgent.

6. **Should the Scout annotate commissions?** Today a commission has only your `--why` (or none), and no `image` line.
   - *Option:* one cheap Scout call per commission to add a `why` and an `image`, marked as the Scout's.
   - *Recommendation:* yes, but never overwrite your own `--why`.

7. **What `--now` does once the studio exists.** Just produce the series (Phase 3), or also run Warhol's shortlist (Phase 4) so it lands on the contact sheet right away?
   - *Recommendation:* series + shortlist.

8. **Can a subject come back?** Dedupe currently blocks a subject **forever**. Warhol returned to Marilyn and Mao many times.
   - *Options:* (a) forever; (b) a window, e.g. 30 days; (c) forever for scouts, with commissions always allowed (today's behaviour for commissions).
   - *Recommendation:* (b) + (c).

9. **Reddit NSFW.** The r/all Atom feed doesn't mark NSFW posts.
   - *Options:* (a) rely on the Scout and your veto; (b) replace r/all with a curated list of subreddits; (c) drop Reddit.
   - *Recommendation:* (b) if NSFW shows up in practice.

10. **Licence.** Still `UNLICENSED` since Phase 0, although the repo is public. This matters more once works are published: the code and the artworks may want different licences (for example MIT for code and CC BY-NC for works).

11. **Backup of the local record.** Now that the floor, archive and canon are out of git, they exist only on this Mac. Losing the disk means losing the record and the canon.
   - *Options:* (a) nothing, and rely on Time Machine; (b) a second, **private** git repo just for data (for example `silver-record`), pushed by the Archivist at the end of each shift; (c) a sync folder (iCloud or Dropbox) or an rsync to another machine; (d) a tarball per shift in `archive/backups/`, copied wherever you like.
   - *Recommendation:* (b). It keeps the append-only history and diffs, and costs one private repo. Until you decide, the Archivist (Phase 7) writes the manifest but backs nothing up.
