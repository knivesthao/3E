# 3E pre-launch checklist (deferred verification + gates)

Checked in while the agent sandbox had no shell — everything here needs a
human run before it counts as done. Work through top to bottom.

## Phase 0 verification (code already written, NEVER verified)

- [x] `npm run typecheck` clean — verified Oct 31 (fixed: `?.`/`??` parens in cache tests, `CacheStorage.default` typing, one real TS2307 workaround)
- [x] `npm test` green — verified Oct 31: 20 files, 113 tests pass (fixed: missing `SELECT * FROM books WHERE id` stub; cache manifest test caught it)
- [x] `npm run build` succeeds — verified Oct 31
- [x] Static-audit fixes confirmed by compiler+tests: missing `});` restored in `ai/routes.ts`, rank-map simplified to chain-order lookup, seed `done`-marking only on produced glosses, seed SQL esc single-lines values, cache test uses full Hono generics
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
- [x] Migration chain SQL-verified Oct 31 (sqlite3 replay 0001–0006 clean; fixed duplicate `idx_ai_usage_project`; dropped redundant definitions index — PK covers the lookup per EXPLAIN QUERY PLAN). Real D1 apply still needs `./run.sh dev` + `npm run db:migrate:local` on your machine (workerd can't run on macOS 12, docker is sandbox-blocked here)
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

## Phase 3 verification (shelf + streaks, code written, NEVER run)

- [ ] `npm run typecheck` clean (new: `/api/me/activity`, shelf UI)
- [ ] `npm test` green (new: `activity.test.ts` 3 tests)
- [ ] `npm run build` succeeds
- [ ] Signed-in Library shows flame + streak after reading a book to its last page; anon Library shows no shelf
- [ ] Streak survives reload; increments only on a new UTC day with activity
- [ ] Shared-link caveat confirmed understood: shelf "finished" follows the shared position, so a second reader turning pages can un-shelve the first
- [ ] Karaoke: full Listen on page N advances to N+1 exactly once; Next mid-play does NOT double-advance; last page stays put; menu closes on auto-advance
- [ ] Legal: /privacy + /terms render without sign-in, footer links present on every page, contact@example.com replaced with a real inbox before launch
- [ ] Onboarding: first Library visit shows the 3-step reader tour; Creator tour button shows the 4-step studio tour; Skip/Done never shows that track again; private mode shows no tour
- [ ] Pip feelings: 100% shows dancing Pip, pass shows cheering Pip, miss shows believing Pip; face readable on the dark score box
- [ ] Share clip: records mic over page art, 9:16 webm downloads/shares, 30s cap auto-stops, unsupported browser shows guidance (not silence)
- [ ] Belts: attempt shows white, pass shows yellow, perfect shows black — on Exam intro, result, and Library row; chip colors readable
- [ ] Image decision: read art avg/slowest in Admin Costs, then decide Modal spike (still needs payment access) — no code until numbers justify it
- [ ] Guardian tab: streak, finished books, and practice-test best all render; own-data note visible
- [ ] Offline PWA: first visit registers /sw.js (Application tab); airplane mode still opens Library from cache and reads a cached book; art loads from cache
- [ ] Content batch: 20+ A1–B2 books via the factory (needs a working shell — blocked until then)
- [ ] Month-one monitoring: D1 row metrics + deploy log watch after prod deploy
- [x] Phase 5.1 foundation (verified Oct 31): real HSK 2.0 lists embedded (5000 words, counts match source), `hsk.ts` segmentation + gate + easier-chain, 10 tests green
- [x] Phase 5 meanings slice (verified Oct 31): HSK levels ride `/api/ai/meanings` (zh dictionary, bilingual prompt, A2-gated English glosses), `books`/`projects`.`lang` migration, zh-CN/en-US voice plumbing end to end — 124/124 tests green
- [ ] Phase 5 remaining: Mandarin factory prompts (draft/check zh), zh dictionary seed script, per-book language switch UI, pinyin toggle (deferred — needs a pinyin lib)

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
