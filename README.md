# 3E — leveled webcomics for English learners (A1–B2)

Teachers need leveled reading material and making it is slow. 3E turns one
scene idea into a complete leveled webcomic — written, level-checked, drawn,
and costed — in minutes. Learners read on a phone, tap hard words, hear Pip
read aloud, read back for a score, drill flashcards and the alphabet, and
earn belts. A full book costs about $0.06 to make; reading is free forever.

Built for the Meta AI Global Hackathon (English readers, CEFR A1–B2).

## What it does

- **Studio** — start a comic, pick A1–B2, write one scene; 3E Finish writes
  the rest. Every word is gate-checked against the level; Simplify fixes
  misses. Art per page with a consistent cast, then publish.
- **Reader** — one page at a time, Pip buddy reads aloud with word
  highlighting, read-back mode scores the learner, tap any word for its
  meaning (dictionary-first, $0 per tap after seeding).
- **Practice** — flashcards from each book's own words (syllable splits, not
  whole-word guessing), a full alphabet + digraph deck (`s`, `th`, `ph`…),
  and A1 belt exams.
- **Admin** — per-book AI cost and time ledger, latency, guardian view.

## Stack (all free tiers)

React + Vite + TS · Hono on Cloudflare Workers · D1 · R2 · Meta Model API
(text + image) · Baseten free credits (batch text + dictionary seeding).
Work happens on `develop`; CI runs typecheck + tests + build on every push.

## First-time setup

```bash
npm install
npx wrangler login
npx wrangler d1 create 3e-db
```

Paste the returned `database_id` into `api/wrangler.toml`, then:

```bash
npx wrangler d1 migrations apply DB --local    # local dev database
npx wrangler d1 migrations apply DB --remote   # Cloudflare D1
npx wrangler secret put MODEL_API_KEY          # needed for AI calls
```

## Daily dev — container (this Mac)

Local workerd cannot run on macOS 12, so dev runs inside one lean Linux
container where it can. One command starts everything:

```bash
./run.sh dev
```

Frontend on `:5173`, API on `:8787`, local D1 migrated automatically. First
run needs network (image + npm + workerd download); restarts are fast and
offline. After changing dependencies, reset with
`docker volume rm 3e-node-modules` and re-run.

Requires Docker Desktop 4.x for macOS 12 (do not upgrade past Monterey support).

## Daily dev — native (macOS 13.5+ only, two terminals)

```bash
npm run dev:api   # --remote: worker runs in Cloudflare; API on :8787
npm run dev       # frontend on :5173, /api proxied to :8787
```

Done-when check: open `:5173`, request a magic link, click the dev link,
land signed-in on `/`; `curl :8787/api/health` → `{"ok":true}`.

## Checks (run sequentially — one at a time on the 2015 MBP)

```bash
npm test        # vitest (also runs on CI for every develop push)
npm run typecheck
npm run build
```

## QA factories (Baseten free credits + live pipeline)

```bash
node qa/seed-definitions.mjs --dry-run --limit 30   # English dictionary
node qa/seed-definitions-zh.mjs --dry-run --limit 30 # Mandarin dictionary
node qa/make-books.mjs --dry --limit 3 --allow-wired # 3-book cost proof
```

Seeders batch-generate glosses, verify against the level gate, and push to
the dev-only admin endpoint. The book factory measures real per-book cost
via `/api/admin/costs/book`.

## Pre-prod checklist (before anything beyond local dev)

- [x] Add a real email sender for magic links (Resend via `api/src/email.ts`).
- [ ] `wrangler login`, then set prod secrets (never in files):
  `wrangler secret put MODEL_API_KEY --env production` (+ `RESEND_API_KEY`,
  `EMAIL_FROM`, and the Baseten/Modal keys you actually use).
- [ ] Deploy: `wrangler deploy --env production` (`[env.production]` forces
  `DEV_LINKS=false`, so dev magic links die even if forgotten).
- [ ] Custom domain + route in the Cloudflare dashboard.
- [ ] Post-deploy smoke: request a magic link → real email arrives → sign-in
  works; `curl <domain>/api/health` → `{"ok":true}`.
- [ ] `npm audit` clean.
