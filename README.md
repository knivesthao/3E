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

## Pre-prod checklist (before anything beyond local dev)

- [ ] Set `DEV_LINKS = "false"` in `api/wrangler.toml` (dev magic links must die).
- [ ] Add a real email sender for magic links (currently dev-links only).
- [ ] `npm audit` clean.
