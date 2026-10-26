# 3E — Hackathon Build Plan

> **Point your AI agent here and say "execute Step 1."** Work the steps top to bottom; each step ends
> with a **Done when** gate. Don't start the next step until the current one passes.
>
> Reference (read, don't duplicate): `models.md` (which models + API), `prompts.md` (exact prompt
> text), `rules.md` (what's allowed).
>
> **The rule that never changes:** fresh code in a **new** repo. The existing reference repo is a
> *spec* (data model, manifest format, level lists, userflows) — never copy its source.

---

## Mission (one sentence)

An English webcomic creator + reader for English-language learners, where AI helps write and
illustrate a story while the app enforces a reading level and length.

## Scope — strict MVP (English only)

**In:** creator signs in → writes a short comic (or AI finishes it) → AI draws each scene → the app
checks level + length → publish → read as a swipeable, tap-a-word webcomic → share link.

**Out:** translation, payments, admin review workflow, districts/schools/classes, non-English, orgs.

## Non-negotiable rules

1. Fresh code, new repo. No copying source from the existing repo.
2. Reading levels are **CEFR A1–B2**. Enforce level **and** length on every scene.
3. Level + length = **one Muse Spark call + a tiny word list**: `muse-spark-1.3` scores the level, a
   hand-written `levels.ts` is the hard gate, word count is the length check. No external datasets,
   no local models, no embeddings.
4. Every AI **attempt** is recorded in `ai_usage` (provider, model, task, kind, op_id, attempt, tokens, cost_usd, ms, ok). A retry adds a new row with the same `op_id` and `attempt + 1`.
5. All AI goes through the provider interfaces in `models.md` — the rest of the app never calls a
   model directly.
6. Images are generated from a template (`prompts.md`), never free-text from the writer.
7. **Security (simple, once):** API key is server-side only; the whole app is behind login; AI
   endpoints are rate-limited; publish is explicit and gated. See §Security guardrails.

## Security guardrails (set up once, then forget)

The threat model is simple: bad players must not spend our $150 tokens or inject junk into the shelf.
One-time setup:

1. **API key = Worker secret only.** `MODEL_API_KEY` lives as a Cloudflare Worker secret; the frontend
   never sees it. All AI calls go through the Worker (already enforced by the provider interfaces).
2. **Everything behind login.** Magic-link auth gates the whole app — no anonymous routes, no public
   writing.
3. **Rate-limit generation.** A per-user daily counter caps AI calls (e.g. 50/day), reset daily. Stops
   token draining.
4. **Publish is explicit + gated.** A book is private until its owner publishes; a Muse Spark
   safe/unsafe prompt screens the text before it goes public. No auto-publish.
5. **Validate everything.** Validate all inputs; validate every AI JSON response against its schema.

## Timeline (10 days)

| Day | Goal |
|---|---|
| 0 · Oct 26 (before 11 PM your time) | Decide + set up accounts/keys/credits (no code) |
| 1 · Oct 27 | Step 1 — scaffold + auth |
| 2 · Oct 28 | Step 2 — creator editor |
| 3 · Oct 29 | Step 3 — text AI + level check |
| 4 · Oct 30 | Step 4 — art + publish + reader |
| 5 · Oct 31 | Step 5 — PWA + share → **MVP DONE** |
| 6–7 · Nov 1–2 | Step 6 — UAT + dual reading |
| 8 · Nov 3 | Step 7 — spotlight walkthrough + polish |
| 9 · Nov 4 | Step 8 — demo video + submit |

Post-MVP (after Nov 4, optional): self-host on Baseten + Modal only if credits are approved (see §Self-hosting).

## Judging (what wins)

- Impact 30% · Use of Meta AI Tooling 25% · Technical Depth 20% · Demo 25%.
- **"Finish first" is NOT scored.** Only the deadline matters — spend saved time on the scored
  differentiators, not on submitting early.
- **Impact (30%) — the pitch:** "Teachers and creators make correctly-leveled English webcomics in
  minutes, not weeks; learners get engaging reading at their exact CEFR level." ⚠️ Check the Event
  page for the problem statements and align this one-liner to one of them.
- **Use of Meta AI Tooling (25%) — our edge:** SAM 3.1 character consistency (same character across
  every scene) + a 3-model pipeline (Muse Spark → Muse Image → SAM 3.1). This is the "beyond a basic
  integration" moment.
- Track: **Startup** (ADMAIS) or **Indie** (≤4 people). Startup has bigger prizes.
- Budget: **$150 Meta Model API credits**.

## Competitive landscape & differentiation

Adjacent tools exist, but nobody combines "leveled" + "comics" + "character consistency":

| Bucket | Examples | What they lack |
|---|---|---|
| AI comic generators | AI Comic Factory, Midjourney-style art | No reading-level enforcement |
| Leveled-reading tools | Diffit, NewsELA, LingQ, Rewordify | Text only — no comics/art |
| AI story-for-education | Storywizard.ai, Bedtimestory.ai | Books, not CEFR-enforced comics; no consistent character |

**Our unique edge (build toward these — competitors don't have them):**
1. **CEFR enforcement as a product feature** — a deterministic word-list gate + a model scoring each
   scene, so output is *guaranteed* at the reader's level (not just "simple English").
2. **Character consistency via SAM 3.1** — the same character across every panel (generic AI-comic
   tools can't do this).
3. **Creator workflow + cost ledger** — a teacher makes a leveled comic in ~15 min, and we can prove
   it cost $0.0X/book.

This is the Impact (30%) story: *"it exists in pieces; we're the only one combining all three."*

## Stack

| Layer | Tech |
|---|---|
| App | React + Vite + TypeScript (PWA) |
| API | Hono on Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Files | Cloudflare R2 |
| Text AI | Muse Spark (`muse-spark-1.3`) |
| Art AI | Muse Image (`muse-image-1.0`) + SAM 3.1 (`sam-3.1`) |
| Coding agent | Muse Code |

```text
/ (root)            package.json, vite, wrangler
  api/              wrangler.toml, migrations/, src/ (worker + services)
  src/              React app (pages, components, lib)
```

## Data model (MVP tables only)

Transcribe into `api/migrations/0001_init.sql` on Step 1. JSON columns are `TEXT`.

```sql
CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL CHECK (role IN ('creator','teacher','admin','student')),
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id_hash    TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  creator_id  TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  level       TEXT NOT NULL CHECK (level IN ('A1','A2','B1','B2')),
  purpose     TEXT NOT NULL DEFAULT 'learning' CHECK (purpose IN ('learning','reading')),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  cast_json   TEXT NOT NULL DEFAULT '{"characters":[],"places":[]}',
  quiz_json   TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE scenes (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scene_number INTEGER NOT NULL,
  data_json    TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (project_id, scene_number)
);

CREATE TABLE books (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  creator_id    TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  level         TEXT NOT NULL,
  reading_level TEXT NOT NULL CHECK (reading_level IN ('beginner','intermediate','advanced')),
  cover_url     TEXT,
  manifest_json TEXT NOT NULL,
  published_at  TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE jobs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('scene','finish','package')),
  payload    TEXT NOT NULL DEFAULT '{}',
  status     TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','complete','failed')),
  result     TEXT,
  error      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE ai_usage (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    TEXT,                                    -- the book
  user_id       TEXT,
  op_id         TEXT NOT NULL,                           -- one logical operation; groups its attempts
  attempt       INTEGER NOT NULL DEFAULT 1,              -- 1 = first try, >1 = retry
  task          TEXT NOT NULL,                           -- draft|check|idea|meanings|simplify|safety|scene_art|segment|vision
  provider      TEXT NOT NULL DEFAULT 'meta-model-api',  -- which API
  model         TEXT NOT NULL,                           -- e.g. muse-spark-1.3
  kind          TEXT NOT NULL CHECK (kind IN ('text','image','segment','vision')),
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cost_usd      REAL NOT NULL DEFAULT 0,
  ms            INTEGER NOT NULL,
  ok            INTEGER NOT NULL,
  error         TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_ai_usage_project ON ai_usage (project_id, created_at);
CREATE INDEX idx_ai_usage_model ON ai_usage (model, created_at);
CREATE INDEX idx_ai_usage_task ON ai_usage (task, created_at);
CREATE INDEX idx_ai_usage_op ON ai_usage (op_id, attempt);

CREATE TABLE shelves (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL DEFAULT 'My Shelf',
  created_at TEXT NOT NULL
);

CREATE TABLE shelf_books (
  shelf_id TEXT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
  book_id  TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (shelf_id, book_id)
);
```

## Cost & usage tracking (admin metrics)

`ai_usage` is the ledger. **Every attempt is a row** — a retry creates a new row with the same
`op_id` and `attempt + 1`. That is what lets you say "this book cost $X, and $Y of it was retries."

**Cost formula** (computed at call time, stored in `cost_usd`):
- text/vision: `input_tokens/1e6 * price_in + output_tokens/1e6 * price_out`
- image/segment: `units * price_per_unit` (tokens = 0)
- keep per-model prices in one config map (`PRICES`); fill from Meta's pricing page.

### Metrics (all from `ai_usage`)

**Grand total for a book** and **first-try cost** (no retries) + **retry overhead**:
```sql
SELECT SUM(cost_usd) AS total,
       SUM(CASE WHEN attempt = 1 THEN cost_usd END) AS first_try_cost,
       SUM(CASE WHEN attempt > 1 THEN cost_usd END) AS retry_overhead
FROM ai_usage WHERE project_id = ?;
```

**Which part of creating the book costs the most** (by task):
```sql
SELECT task, SUM(cost_usd) AS cost, COUNT(*) AS calls,
       SUM(input_tokens) AS tokens_in, SUM(output_tokens) AS tokens_out
FROM ai_usage WHERE project_id = ? GROUP BY task ORDER BY cost DESC;
```

**Which model did the most work**:
```sql
SELECT model, SUM(cost_usd) AS cost, COUNT(*) AS calls,
       SUM(input_tokens) AS tokens_in, SUM(output_tokens) AS tokens_out
FROM ai_usage WHERE project_id = ? GROUP BY model ORDER BY cost DESC;
```

**Which model/task retried the most**:
```sql
SELECT model, task, COUNT(*) AS retries, MAX(attempt) AS max_attempt
FROM ai_usage WHERE project_id = ? AND attempt > 1
GROUP BY model, task ORDER BY retries DESC;
```

**Cost per user per month** (the "users pay $X/mo, costs us $Y" number):
```sql
SELECT user_id, strftime('%Y-%m', created_at) AS month, SUM(cost_usd) AS cost
FROM ai_usage GROUP BY user_id, month ORDER BY month DESC;
```

**Full attempt log for one book** (audit trail):
```sql
SELECT op_id, attempt, task, provider, model, input_tokens, output_tokens, cost_usd, ok, error, created_at
FROM ai_usage WHERE project_id = ? ORDER BY created_at;
```

## Level checking (MVP)

1. **Muse Spark** — `muse-spark-1.3` scores each scene's CEFR level (one cheap call).
2. **Tiny word list** — a hand-written `levels.ts` (a few dozen–couple hundred words per A1–B2) as
   the deterministic hard gate.
3. **Length check** — word count per scene, by level (plain code).

## Art pipeline (Muse Image + SAM 3.1 + Muse Spark)

1. **Muse Image** (`muse-image-1.0`) draws each panel from the template (`prompts.md`).
2. **SAM 3.1** (`sam-3.1`) isolates the main character → transparent PNG → stored in **R2** and reused
   across scenes. **Required** — this is the character-consistency differentiator. *(Post-MVP optional:
   self-host on Modal if credits approved — see §Self-hosting.)*
3. **Muse Spark** (multimodal) verifies the panel matches the scene text (`{ passed: true/false }`);
   on failure, regenerate. Optional but strong for the "beyond basic" scoring.

## Self-hosting (optional, post-MVP) — Baseten + Modal

**Optional: only pursue if we get approved credits.** Not part of the MVP (the hosted Meta Model API
covers everything for the 10 days). If approved, use each provider for its own job:

| Provider | Job | Model |
|---|---|---|
| **Baseten** | LLM serving (text) | Muse Glimmer (open-weight, Apache 2.0) |
| **Modal** | GPU vision + batch | SAM 3.1 (open-weight) + image processing |

- **Baseten** serves `Muse Glimmer` for cheap text generation — story drafting + CEFR level checks.
- **Modal** runs `sam-3.1` for character isolation/cutouts, plus batch WebP compression + comic packaging.

Integration (both): Cloudflare Worker → HTTP → endpoint → result back.

Application copy for both: `milestones.md`.

---

## THE STEPS

### Step 1 — Scaffold + auth (Day 1)

- [x] Create a new empty repo (GitHub), do not copy any reference source.
- [x] Init `package.json` (React 18, Vite, TypeScript, Hono, react-router-dom).
- [x] Write `api/wrangler.toml` with `assets`, the AI binding, `[[d1_databases]]`, and a migrations dir.
- [x] Create the D1 database and apply `0001_init.sql` (schema above).
- [x] Build `users` + `sessions` auth: passwordless magic link (store only hashes); gate **all** routes
      behind it (no anonymous access).
- [x] Store `MODEL_API_KEY` as a Worker secret (`wrangler secret put`), never in code.
- [x] Add `GET /api/health` → `{ ok: true }`.
- [x] Create shell pages: `/` (library), `/studio` (creator), `/read/:id` (reader).

✅ **Done when:** `npm run dev` works, you can sign in, `/api/health` returns ok.

### Step 2 — Creator editor (Day 2)

- [x] `projects` + `scenes` CRUD API (list, create, update, delete, reorder).
- [x] Studio dashboard: list projects + "New comic".
- [x] Comic editor: add/reorder scenes, type narration, add per-scene speech bubbles.
- [x] Cast tab: define characters + places (`cast_json`).
- [x] Save/load drafts to D1.

✅ **Done when:** you can write a full 6-scene story with bubbles, no AI, and reload it from the DB.

### Step 3 — Text AI + level check (Day 3)

- [ ] Implement the `TextModel` interface (`models.md`) against the Meta Model API.
- [ ] Wire the story pipeline: `muse-spark-1.3` drafts → `muse-spark-1.3` QA-validates (`prompts.md` §2).
- [ ] Wire `POST /suggest/idea`, `/finish` ("3E Finish", a `kind='finish'` job), `/meanings`, `/simplify`.
- [ ] Build the **level check** (`levels.ts` hard gate + `muse-spark-1.3` score) and **length check**.
- [ ] Require a valid session on every AI endpoint; add a per-user daily generation counter (rate limit).
- [ ] Log every attempt to `ai_usage` (provider, model, task, kind, op_id, attempt, tokens, cost_usd).
      A retry reuses the `op_id` with `attempt + 1`.

✅ **Done when:** "3E Finish" writes valid, leveled scenes that pass the level + length check.

### Step 4 — Art + publish + reader (Day 4)

- [ ] **4a (local, backend):** `ImageModel` (`muse-image-1.0`) + `SegmentModel`
      (`sam-3.1`) adapters, config routing + prices, `kind='scene'` art-job pipeline,
      R2 upload/storage. Done when a scene job returns stored panel URLs.
- [ ] **4b (local, backend):** publish endpoint (owner-only) + Muse Spark
      safe/unsafe screen + **manifest v2** packaging → `books.manifest_json` +
      cover. Done when a draft becomes a `books` row via one call.
- [ ] **4c (local, UI):** per-scene "Generate" button with job progress +
      publish button wiring in the Editor. Needs 4a/4b contract. Done when art
      and publish run from clicks.
- [ ] **4d (local, UI):** reader — swipe scenes, tap a word for its meaning
      (`/meanings`), show `reading_level`. Needs 4b output shape (mock with a
      fixture until then). Done when a published book reads swipeably.
- [ ] **4e (codespace/content):** prompt-template review + character-sheet
      authoring — **anytime, needs nothing**. Phone preview of the reader needs
      4d. Done when the character looks identical across all scenes on a phone.
- [ ] (Optional, local) Muse Spark multimodal validation loop before showing a panel.
- [ ] **SAM 3.1 character consistency (required)** is covered by 4a + 4e together.

Sub-steps run in parallel (local = `local`, codespace slices =
`codespace`, human QA). UI builds against the API contract in
`src/lib/api.ts` — 4a/4b land it first.

✅ **Done when:** a comic with art publishes and reads end-to-end, with one consistent character across
   all scenes.

### Step 5 — PWA + share → MVP DONE (Day 5)

- [ ] **5a (local, backend):** share backend — public read route for published
      books; `/admin/costs` endpoints serving the §Cost & usage tracking queries.
      Done when share URLs resolve and costs endpoints return ledger numbers.
- [ ] **5b (local, UI):** PWA shell (manifest + service worker, book saved to
      IndexedDB for offline reading), chunked per-scene loading, share UI,
      `/admin/costs` page (read-only). Needs 5a shapes. Done when the app
      installs offline and a book reads from cache.
- [ ] **5c (human):** record the first test book end-to-end (the demo seed) + QA.
- [ ] **5d (codespace):** share-link check via public URL.

✅ **Done when:** **MVP DONE** — creator → leveled comic → publish → read → share, all working.

### Step 6 — UAT + dual reading (Days 6–7)

- [ ] **6a (local, backend):** dual-reading sync — shared link where two
      readers stay in sync (polling first; Durable Objects only if polling
      proves inadequate). Done when two sessions track one position.
- [ ] **6b (human):** get 2–3 real people to make test books; file the bugs.
- [ ] **6c (codespace):** dual-device sync test over public URLs.
- [ ] **6d (local):** fix the bugs from 6b. Runs after 6b reports land.

✅ **Done when:** test books are live and two devices can read one book together.

### Step 7 — Spotlight walkthrough + polish (Day 8)

- [ ] **7a (local, UI):** onboarding/spotlight walkthrough so a judge
      understands the app in 30 seconds.
- [ ] **7b (local, UI):** visual/UX rough-edge fix pass.
- [ ] **7c (human):** first-run test with a real user (they explain the app
      back with no help) + UX issue list feeding 7b.

✅ **Done when:** a first-run user can explain the app back to you without help.

### Step 8 — Demo video + submit (Day 9)

- [ ] Record the 2–3 min demo video. Shot list (in order):
      1. Problem (10s): "Teachers need leveled reading material; making it is slow."
      2. Write (20s): type one scene → "3E Finish" writes the rest.
      3. Level check (15s): show it flag an out-of-level word → "Simplify" fixes it.
      4. Art + consistency (30s): Muse Image draws each scene, SAM 3.1 keeps the character identical.
      5. Cost (15s): `/admin/costs` — "this book cost $0.0X."
      6. Read (20s): publish → read on a phone → tap a word → (milestone) second device.
- [ ] **8a (human):** record the 2–3 min demo video (shot list above).
- [ ] **8b (human):** write README + submission form, submit on the Cerebral
      Valley portal before the deadline.
- [ ] **8c (local):** tech support on demand — last fixes only, no features.

✅ **Done when:** submission is in before 9:00 AM Nov 5 (your time).

---

## Conventions

- **Manifest v2** for the comic format (layers + bubbles + text).
- **JSON validation:** every structured AI reply is validated against its schema; retry once, then surface the error.
- **Cost is visible:** every AI call lands in `ai_usage`; the admin view reads that table, never a guess.
- **Small commits:** commit every ~2 hours with descriptive messages, so the git timeline proves the work.
- **Tests run on CI only:** never `npm test`, `npm run typecheck`, or `npm run build` locally.
  That is reserved for GitHub Actions on `develop`/`local`/`codespace` pushes. Write the tests, commit, push, read CI.
- **Who does what (explicit):** tracks are named by branch.
  - **Local (this session, Mac checkout):** all implementation — backend AND
    frontend — on the `local` branch, plus commits, plan checkoffs, reviews.
    Cannot push, run authed CLIs, reach your localhost, or run Docker.
  - **Codespace (when linked):** parallel implementation slices on the
    `codespace` branch merged via PR; plus heavy/Linux-only jobs, public
    preview URLs, and pre-authenticated git. Metered — deliberate use only:
    spin up, run, capture, stop/delete. Smallest machine that works.
  - **Human (you):** Zed as reference, QA/UAT in the browser, content and
    pricing research, decisions, `git push`, billing, submissions. No routine
    editing — no branch needed.
  - Routing: local by default; codespace only for parallel slices,
    Linux-only, heavy, public-URL, or authed-git jobs. Never two writers on
    the same file at once; pull before starting, push when done. `develop` is
    integration: work merges in via PR. CI gates every push to
    `develop`/`local`/`codespace` and every PR targeting `develop`.

## Where each step runs (parallel by default)

Local implements on `local`; codespace takes parallel slices on `codespace`
(PR to `develop`); human QA/decides/pushes. Merge via PR.

| Step | Local (`local`) | Human | Codespace (`codespace`) |
|---|---|---|---|
| 1 — Scaffold + auth | Done | Done (verified) | — |
| 2 — Creator editor | Done | Done (verified reload) | — |
| 3 — Text AI + level check | Provider, gate, endpoints, ledger | Container QA, pricing research | — |
| 4 — Art + publish + reader | 4a, 4b, 4c, 4d | QA flows, prompt review | 4e preview, authed git |
| 5 — PWA + share | Endpoints, PWA shell, offline store, share + costs UI | Demo seed run, QA | Share-link public check |
| 6 — UAT + dual reading | Sync backend, fixes | Testers, reports, dual-device pass | Sync-test session |
| 7 — Walkthrough + polish | Fixes | UX review, walkthrough | Phone check (optional) |
| 8 — Demo + submit | Tech support | Video, form, submit | — |

If a step lists no job for a track, that track sits the step out.

## Parallel rules

- A sub-step with no "Needs" runs **anytime**, on any track, in any order —
  including before earlier steps finish. "Needs X" is the only gate.
- Anytime work (start today): 4e content (prompt review, character sheet),
  6b (line up testers — needs only the Step 2 editor), 7c prep (find a
  first-run user), 8a prep (script from the shot list), Step 3 pricing research.
- Gated work waits: 4e preview needs 4d; 5c needs the 4a–4d chain; 6d needs 6b
  reports; 7b feeds off 7c findings; 4c needs the 4a/4b contract.
- Critical path to MVP: 4a → 4b → 4c/4d → 5a → 5b. Everything else floats.

## Definition of done (the demo)

1. Sign in as a creator → start a comic → pick a CEFR level.
2. Write one scene, then let **"3E Finish"** write the rest.
3. **Muse Image** draws each scene; the main character looks the same throughout (SAM 3.1).
4. The **level + length check** flags something, and "Simplify" fixes it.
5. Publish → the book is on the shelf → read on a phone → tap a word → (milestone) open the share link on a second device.
