# First deploy: from laptop to cloud (one evening, ~30 min)

Takes the app from `localhost` to two live workers. Do the steps in order;
each one unlocks the next. Nothing here costs money.

## 1. Enable R2 (Cloudflare dashboard, ~2 min)

dash.cloudflare.com → R2 Object Storage → Enable (confirmed $0, 10 GB free).
Then locally:

```
wrangler r2 bucket create 3e-art
wrangler r2 bucket create 3e-library
```

## 2. Create the deploy token (Cloudflare dashboard, ~3 min)

My Profile (top right) → API Tokens → Create Token → **Use template** on
*Edit Cloudflare Workers* → **Add more**: D1 → Edit, R2 → Edit →
Continue → Create Token → **copy it** (shown once).

## 3. Save three GitHub secrets (repo Settings → Secrets → Actions, ~5 min)

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Token from step 2 |
| `BASETEN_API_KEY` | Your Baseten dashboard key (free credits) |
| `SEED_API` | **Later** — the dev worker URL from step 5 |

## 4. Push `develop` (your terminal, ~2 min + CI runs ~5 min)

Review (`git status`, `git diff`), commit, push. CI tests, migrates both
D1s, and deploys `3e-dev`. Open the green **deploy-dev** run, find the
`wrangler deploy` output, copy the `https://3e-dev.…workers.dev` URL →
that's `SEED_API`, save it as secret #3.

## 5. Staging keys (terminal, ~5 min)

```
wrangler secret put MODEL_API_KEY --env development
wrangler secret put RESEND_API_KEY --env development
wrangler secret put EMAIL_FROM --env development
wrangler secret put BASETEN_API_URL --env development
wrangler secret put BASETEN_API_KEY --env development
wrangler secret put BASETEN_MODEL --env development
```

(Paste each value when prompted. Or hand them to the agent one at a time —
it pipes them in without displaying them. Values live in `api/.dev.vars`
locally today.)

## 6. Verify dev is alive (~3 min)

- Open the dev URL → sign in with any email (one-click dev link, no inbox).
- Library loads, books list (empty until seeded/published).
- `curl <dev-url>/api/health` → `{"ok":true}`.

## 7. Seed the dictionary (no laptop needed from here)

Actions → **seed-dictionary** → Run workflow. Start with
levels `A1,A2`, limit `200`. Full walkthrough: [cloud-seeding.md](./cloud-seeding.md).

## 8. Ship to prod (when dev looks right)

Merge `develop` → `main`. CI tests, migrates, and deploys production.
Set the same secrets with `--env production` first. Then turn off
one-click sign-in on dev (`wrangler secret put` won't do booleans —
set `[env.development.vars] DEV_LINKS = "false"` in `api/wrangler.toml`).

## If something is red

| Where | Likely cause |
|---|---|
| deploy-dev, R2 error | Step 1 incomplete |
| deploy-*, auth error | `CLOUDFLARE_API_TOKEN` missing or lacks D1/R2 perms |
| seed run, `no Baseten key` | `BASETEN_API_KEY` secret missing |
| seed run, `no devLink` | Step 4 not done or `SEED_API` wrong |
| App loads, AI calls fail | Step 5 keys missing on that env |
