# Modal — SAM isolate, development only, parked by default

Status: off. Isolate tasks run on the Meta Model API until per-cutout
Modal spend is verified cheaper. The $100 credit is for bursty GPU work
with no idle billing — not for always-on replicas.

## Why Modal for this one call

Segmentation is the most expensive 3E call and it is bursty: one cutout
per scene, then nothing. Modal bills per second of GPU with
scale-to-zero, so idle costs $0 by construction. Text stays on Meta
(cheap) and Baseten stays parked (hourly billing loses at this volume).

## Setup (one time, on your Mac — not in the container)

```bash
pip install modal && modal setup
modal deploy modal/sam.py        # prints the web endpoint URL
modal workspace proxy-tokens create   # join as <id>.ws-<secret>
```

`SAM_MODEL_ID` defaults to `facebook/sam3` (open-vocabulary text prompts —
exactly what the app sends). Override only for a mirror or fine-tune.

## Link it

```bash
./modal/link.sh <endpoint-url>   # creates APP_KEY, stores it, links it
npm run modal:check
./run.sh dev
```

Unlink any time: delete the two `MODAL_*` lines from `api/.dev.vars`
and isolate falls back to Meta with no code change.

## Cost discipline ($100 credit)

- L4 GPU, `max_containers = 1`, `min_containers = 0`. Raise only on OOM
  or real concurrent load — never preemptively.
- Weights live on a Modal Volume: no re-download billing on cold starts.
- Batch test cutouts into one session; every wake-up reloads weights.
- Watch spend in the Modal dashboard per session, not per month.

## Files

- [sam.py](/Users/yeethao/dev/ADMAIS/3E/modal/sam.py) — GPU isolate function,
  `{ image_b64, prompt }` in, `{ mask_b64, content_type }` out.
- [dev.json](/Users/yeethao/dev/ADMAIS/3E/modal/dev.json) — endpoint record,
  scaling policy, contract. No secrets.
- [link.sh](/Users/yeethao/dev/ADMAIS/3E/modal/link.sh) — writes the endpoint
  + token into `api/.dev.vars` without echoing either.
