# 3E — Step 1 scaffold + magic-link auth

React + Vite + TS frontend, Hono API on Cloudflare Workers, D1 database.
Work happens on `develop`; CI runs on pushes to `develop` and PRs targeting it.

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
npx wrangler secret put MODEL_API_KEY          # needed from Step 3 (AI calls)
```

## Daily dev (two terminals)

```bash
npm run dev:api   # worker + API on :8787 (add --remote to emulate in the cloud)
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

## Pre-prod checklist (before anything beyond local dev)

- [ ] Set `DEV_LINKS = "false"` in `api/wrangler.toml` (dev magic links must die).
- [ ] Add a real email sender for magic links (currently dev-links only).
- [ ] `npm audit` clean.
