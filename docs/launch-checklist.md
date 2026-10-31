# 3E pre-launch checklist (deferred verification + gates)

Checked in while the agent sandbox had no shell — everything here needs a
human run before it counts as done. Work through top to bottom.

## Phase 0 verification (code already written, NEVER verified)

- [ ] `npm run typecheck` clean (new: `api/src/email.ts`, index route, SignIn)
- [ ] `npm test` green (new: `api/src/email.test.ts`, 3 tests)
- [ ] `npm run build` succeeds
- [ ] Dev sign-in still works (`DEV_LINKS=true`, click dev link)
- [ ] Prod-path sign-in: set `DEV_LINKS=false` locally, request link, confirm
      `{ok:true, emailed:...}` and NO token in the response
- [ ] Real email round trip (Resend key + verified domain in `api/.dev.vars`)

## Prod deploy gate

- [ ] `wrangler login`
- [ ] Prod secrets set (`MODEL_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, + any
      Baseten/Modal keys in use) — never in files
- [ ] `wrangler deploy --env production`
- [ ] Custom domain + route
- [ ] Post-deploy smoke: magic-link email → sign-in → reader loads a book
- [ ] `npm audit` clean

## Phase 1 verification (dictionary, code written, NEVER run)

- [ ] `npm run typecheck` clean (new: `easierLevels`, admin endpoint, route rewrite, email/unrelated)
- [ ] `npm test` green (new: levels `easierLevels`, 2 meanings cache tests, 3 admin endpoint tests, email tests from Phase 0)
- [ ] `npm run build` succeeds
- [ ] `npm run db:migrate:local` applies `0005_definitions.sql` with no error
- [ ] Proof run (dev stack up): `npm run qa:definitions -- --dry-run` lists A1/A2 words, then `npm run qa:definitions -- --limit 30` seeds 30 glosses
- [ ] Review `qa/definitions-sample-A1.md` + A2: fix or drop bad glosses in D1 before B1/B2
- [ ] Kill-keys test: empty the model keys, tap a seeded word → instant answer from the table, no 503
- [ ] Rerun proof (`--limit 30` again): zero new Baseten calls (progress file + INSERT OR IGNORE), SQL dump grows only with new rows
- [ ] B1/B2 full seed only after A1/A2 sample sign-off: `npm run qa:definitions -- --levels B1,B2`

## Phase 2 verification (timing + cache + speed, code written, NEVER run)

- [ ] `npm run typecheck` clean (new: `cache.ts`, share route, `fmtMs`, costs tests)
- [ ] `npm test` green (new: `costs.test.ts` 3 tests, publish cache/bust test)
- [ ] `npm run build` succeeds
- [ ] `npm run db:migrate:local` applies `0006_indexes.sql` with no error
- [ ] Admin Costs tab shows avg/slowest per task and model on a book with real usage rows (art should read seconds, text ms)
- [ ] Cache proof: dev worker, GET `/api/share/books` twice → second response carries `Cache-Control: public`; publish → catalog updates immediately (bust works)
- [ ] 404-then-publish: GET unknown `/api/share/<uuid>` → 404; publish that book → GET returns 200 (brief miss-cache busted)
- [ ] Library paints instantly on revisit (SWR from localStorage), Reader turns pages with art already loaded
- [ ] Positions still poll fresh every few seconds (never cached by design)

## Later phase gates (master plan order)

- [ ] Phase 1 dictionary: A1/A2 human sample reviewed before B1/B2 seed
- [ ] Phase 1 dictionary: kill-keys test (taps still instant with AI keys off)
- [ ] Phase 2: Cache API spike proven (repeat GET → `rows_read` 0) before routes depend on it
- [ ] Phase 2: publish invalidates catalog cache (manual check)
- [ ] Phase 3: `MediaRecorder` clip verified on real Chrome + Safari
- [ ] Phase 3: belt appears after a passing exam; streak survives reload
- [ ] Image decision: art p50/p95 read from Admin BEFORE any Modal spend
- [ ] Modal image spike only after payment access confirmed
- [ ] Legal: privacy policy + terms + parental consent live before strangers sign up
- [ ] Monitoring: D1 row-metric watch for month one
