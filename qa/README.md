# QA seeding

One command builds a review-ready A1 book. Deterministic: zero AI calls and
$0 spend unless `--publish` is passed (exactly one safety call).

## Prereqs

```bash
./run.sh dev   # API on :8787, frontend on :5173
```

## Use

```bash
npm run qa:seed
npm run qa:seed -- --publish   # + reader/share links, costs 1 AI call
npm run qa:seed -- --clean     # delete the seeded project again
```

The script signs in via the dev magic link, creates project `Red Cat` (A1),
adds three hand-written scenes, and prints the pages to open: editor,
library, costs — plus reader and share links after `--publish`.

Seed scenes use A1-list vocabulary only (see `api/src/levels.ts`) and stay
under the 40-word scene cap, so the level gate passes by construction. The
printed checklist covers what to eyeball: reading flow, bubbles, level
badges, and a $0 costs page.

## Notes

- Auth is the same dev magic-link flow as the app; no test user to manage.
- The daily 50-call AI cap still applies to `--publish`.
- No new dependencies: plain Node `fetch`. Nothing here ships to production.
