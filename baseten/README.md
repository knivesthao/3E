# Baseten — PARKED (cost decision, 2026-10-28)

Status: disabled by default. All tasks run on the Meta Model API until the
$150 credits say otherwise. Rationale: per-token Spark text is cheaper than
an H100 at $6.50/hr at hackathon volume (see Cost control below).

To re-enable later: deploy Glimmer under the free-credits workspace, then
`./baseten/link-dev.sh <model-id>`. To confirm it stays off:
`npm run baseten:check` should report missing wiring.

No production wiring lives in this repo in any case.

## How it connects to the app

The app never hardcodes Baseten. Two files own the integration:

- [config.ts](/Users/yeethao/dev/ADMAIS/3E/api/src/ai/config.ts) — task routing
  (`BASETEN_TASKS`), model names, prices. Swap models here.
- [baseten.ts](/Users/yeethao/dev/ADMAIS/3E/api/src/ai/baseten.ts) — the only
  module that speaks the Baseten URL shape.

`basetenConfig()` returns null unless both `BASETEN_API_URL` and
`BASETEN_API_KEY` are set, so an unlinked checkout falls back to the Meta
Model API. Nothing else changes.

## Setup (one time)

1. Install the CLI on your Mac (not in the container) and log in:

```bash
brew tap basetenlabs/baseten
brew install baseten
export BASETEN_API_KEY="<your-key>"
```

Use the Baseten-issued free-credits key — the one already in `api/.dev.vars`.
That workspace is empty (no models yet), so there is nothing to shut off there.
Shut off the old H100 deployment in its own workspace dashboard instead.

2. Get a development endpoint. Recommended: one-click deploy from the
   [Muse Glimmer 30B library page](https://www.baseten.co/library/muse-glimmer-30b),
   then copy the model ID. Alternative as code:

```bash
cd baseten
# fill weights revision in config.yaml first
baseten model push --watch
```

3. Link it into the Worker dev env:

```bash
./baseten/link-dev.sh <model-id>
# or: MODEL_ID=<model-id> npm run baseten:link
```

This writes `BASETEN_API_URL` + `BASETEN_MODEL` to `api/.dev.vars`,
which is what `wrangler dev --config api/wrangler.toml` actually reads.
The repo-root `.dev.vars` is not read by the Worker. Secrets stay in
that gitignored file and are never printed.

4. Verify without leaking the key:

```bash
npm run baseten:check
./run.sh dev
```

## Cost control (read this — idle GPUs bill)

On 10/27 a single idle H100 billed $9.75 for 90 minutes with 0 requests
(~$0.10833/min). Glimmer 30B BF16 needs the H100, so the saving comes from
running it as little as possible, not from a smaller GPU:

- Development environment only. Never promote to production.
- One replica max, scale to zero when idle (`minReplicas: 0`, recorded in
  [dev.json](/Users/yeethao/dev/ADMAIS/3E/baseten/dev.json)). Apply it to the
  environment with `baseten model environment update-autoscaling` — see
  [schedule autoscaling](https://docs.baseten.co/deployment/autoscaling/schedules).
- Deactivate the deployment in the dashboard when you stop for the day.
  Deactivated costs $0; idle costs $6.50/hr.
- Batch your test prompts into one session instead of spreading them across
  the day — every wake-up reloads 30B and bills load time too.
- Expect slow cold starts after idle (multi-minute model reload). That is the
  trade for $0 idle cost. Do not raise `minReplicas` to fix it.

## Daily use

- `npm run baseten:check` — confirms dev wiring is present.
- `baseten model watch` — reattach to the dev deployment after Ctrl+C.
- Deactivate the deployment in the dashboard when done. The H100
  billing in your screenshot (~$0.11/min) stops only when no replica
  is running; keep dev `min_replicas` at 0.

## Files

- [dev.json](/Users/yeethao/dev/ADMAIS/3E/baseten/dev.json) — env record:
  model, endpoint path shape, routed tasks. Fill `modelId` via the link script.
- [config.yaml](/Users/yeethao/dev/ADMAIS/3E/baseten/config.yaml) — Truss
  template reproducing the library deployment (single H100, vLLM,
  OpenAI-compatible). Library deploy is preferred; this is the as-code backup.
- [link-dev.sh](/Users/yeethao/dev/ADMAIS/3E/baseten/link-dev.sh) — builds the
  dev URL from `dev.json` and upserts it into `api/.dev.vars`.
