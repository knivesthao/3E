# Word-list grow list (A1–C2 gate)

Confirmed-missing words go here BEFORE they enter `api/src/levels.ts`.
Rule: a word lands here only after a real gate probe or factory reject
shows it failing — never from guessing. When a batch is approved, add to
the level list (keeping lists disjoint), add a gate test, reseed affected
definitions.

## A1 candidates (probed 2026-11-02, real gate, coverage 0.67–0.70)

- love / loves
- boat
- hungry
- rice
- lunch

## A2 candidates (probed 2026-11-02)

- travelled (UK spelling; `traveled` already stems to `travel` — decide: add variant or standardize US)

## Process

1. Factory rejects or probes surface unknown words → append here with date + source.
2. Approve a batch → edit `api/src/levels.ts` (disjoint from easier levels).
3. Run `npm run typecheck && npm test` (disjointness tests guard the invariant).
4. Reseed affected levels (`--levels A1` etc.); definitions for unchanged words are untouched.
