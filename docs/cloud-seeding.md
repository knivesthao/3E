# Cloud seeding walkthrough (server-side dictionary)

Goal: generate all word definitions on Baseten, straight into the one
shared database — with your laptop shut the whole time. Dev and prod read
the same D1 + R2, so there is no promotion step: seeded means live.

One-time setup (do once, in order). Then the repeat loop is just step 6.

## Step 1 — Enable R2 (you, Cloudflare dashboard — I can't)

Enabling R2 is a billing/account switch with no CLI equivalent; only a
human clicking in the dashboard does it. My CLI can create the bucket
afterward, but not flip the switch.

1. Open dash.cloudflare.com → R2 Object Storage → Enable.
2. Then run locally:
   `wrangler r2 bucket create 3e-art`

Why: image/audio storage. Deploys fail without the buckets.

## Step 2 — Secrets (you create, I install — keys must come from you)

I have CLI access (`wrangler`, `gh` both logged in) and *could* type the
values in — but I don't have them, and secrets should never travel through
chat. So: you create each value, then either paste it into GitHub /
wrangler yourself, or paste it to me and I'll pipe it straight into
`gh secret set` / `wrangler secret put` without displaying it. The
`CLOUDFLARE_API_TOKEN` itself must be born in the Cloudflare dashboard
(My Profile → API Tokens); no CLI mints that first token.

| Secret | Value | Where from |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | API token | Cloudflare → My Profile → API Tokens → Create (template: Edit Cloudflare Workers; add D1 + R2 permissions), account `1205420961752ebcfaca756ce61482c0` |
| `BASETEN_API_KEY` | Baseten key | Your Baseten dashboard (free-credits key) |
| `SEED_API` | Dev worker URL | Shown after the first dev deploy, e.g. `https://3e-dev.<you>.workers.dev` |

## Step 3 — Push develop (you — committing is your call)

Repo rule: I never commit or push without your explicit ask. Review the
tree (`git status`, `git diff`), then commit + push when ready; CI takes
it from there and prints the dev worker URL in the deploy log.

Commit + push this branch. CI tests, migrates dev D1, deploys `3e-dev`.
Copy the worker URL from the deploy log → paste it into `SEED_API`.

## Step 4 — Dev secrets (same split as step 2)

Staging needs the same keys as prod so books generate identically:

```
wrangler secret put MODEL_API_KEY --env development
wrangler secret put BASETEN_API_URL --env development
wrangler secret put BASETEN_API_KEY --env development
wrangler secret put BASETEN_MODEL --env development
```

## Step 5 — Smoke test (me, then you verify)

```
node qa/seed-definitions.mjs --dry-run --limit 5 --levels A1
```

Expect: `5 glosses to generate (0 already done) [dry run]` and a word list.
Costs $0, writes nothing. Then one live handful:

```
node qa/seed-definitions.mjs --limit 3 --levels A1 --api <dev-url>
```

Expect: `3 glosses`, rows in dev `definitions`. Verify:
`wrangler d1 execute 3e-db-dev --remote --env development \
  --command "SELECT count(*) FROM definitions"` → 3 (plus any earlier rows).

## Step 6 — Cloud batch (you click, cloud works)

Actions → **seed-dictionary** → Run workflow. Inputs:

- levels: `A1,A2` first (readers hit these immediately), later `B1,B2`, then `C1,C2`
- limit: `200` per run (safe chunk; progress cache resumes on re-run)
- max-tokens: `2000000` (spend cap per run)

Close the laptop. Each run writes directly to the shared database and
uploads its SQL dump as an audit trail. Start small: review the first
200 before queuing thousands.

## Step 7 — Review (together — shared DB means seeded is live)

1. Download the dump artifact, skim a dozen glosses for tone/level fit.
2. Spot-check in the app: open an A1 book, tap a seeded word.
3. Bad batch? Rows are keyed `UNIQUE(word, level, lang)` — hand-fixed rows
   always survive a reseed; to remove a bad batch, delete by `source` +
   date from D1 directly.

## Step 8 — Repeat

Re-run step 6 with the next levels until A1–C2 are covered (~10,800 words
total). Order: A1,A2 → B1,B2 → C1,C2.

## If something fails

| Symptom | Cause → fix |
|---|---|
| Deploy job red: R2 error | Step 1 incomplete — enable R2, create both buckets |
| Seed run: `no Baseten key` | `BASETEN_API_KEY` secret missing/empty |
| Seed run: `no devLink` | Dev worker not deployed yet, or `SEED_API` wrong |
| `token budget reached` | Normal — re-run; progress cache resumes |
| `batch failed (B2)` | Transient Baseten error — re-run; failures skip, never half-write |
