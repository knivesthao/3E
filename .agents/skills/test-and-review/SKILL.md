---
name: test-and-review
description: Test-and-review workflow for the 3E repo. Invoke after implementing a PLAN step or before committing: writes tests (never runs them until asked), then reviews the diff with emphasis on security, code reuse, and service decoupling. CI runs the tests on push.
---

# Test and review — 3E workflow

Invoke this skill after each PLAN step (or before any commit) to cover and review the
change. **Write-only policy:** write the tests, commit them, and let GitHub Actions run
them — never run tests locally unless the user explicitly asks. Never report a test
result you did not observe; unrun tests are reported as "written, awaiting CI".

## Phase 1 — write tests (do not run)

1. **Cover the change:** unit tests for new lib logic (`levels.ts`, prompt builders, cost
   math, validators), route tests for new/modified Hono endpoints (auth-gated, validation,
   rate-limit paths), and contract tests for any new adapter (interface shape, error type,
   token/cost normalization).
2. **Keep tests fast and hermetic:** no network, no real model calls — stub at the provider
   interface boundary. One behavior per test, descriptive names. Follow the repo's normal
   test layout so CI picks them up.
3. **Do not run:** no local `npm test`, no watchers, no ad-hoc execution — even to "check".
   Staging a test file for review (`git diff --cached`) is fine. CI is the runner.

## Phase 2 — review the diff (security, reuse, decoupling)

Read the full diff, then check it against the three emphasis skills:

- **Security** (`.agents/skills/secure-coding/SKILL.md`): auth on every route, owner checks
  on mutations, parameterized D1, no secrets/PII in code/logs/client, AI rate limits, AI
  JSON validated, AI text escaped on render.
- **Reuse** (`.agents/skills/component-reuse/SKILL.md`): no duplicated components, helpers,
  types, schemas, or validators; second use extracted; dead code removed.
- **Decoupling** (`.agents/skills/service-decoupling/SKILL.md`): no vendor imports or model
  strings outside adapter + config; new providers behind the existing interfaces;
  `ai_usage` shape unchanged.

Also verify the PLAN non-negotiables: CEFR A1–B2 level + length enforced, every AI attempt
logged (`op_id`, `attempt`, model, tokens, `cost_usd`), correct model strings
(`muse-spark-1.3` / `muse-image-1.0` / `sam-3.1`), images from the template only.

## Report format

- **Tests written** (files + what each covers; status: awaiting CI).
- **Blocking** (must fix before commit): review findings on security, contract breaks,
  wrong model/API usage, missing `ai_usage` logging, secrets committed.
- **Non-blocking** (may defer): style, naming, edge cases outside the happy path, polish.
- End with: blocking count, non-blocking count, and a commit/no-commit recommendation.
  Never commit as part of review — report, then wait.
