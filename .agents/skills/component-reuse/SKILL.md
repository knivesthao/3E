---
name: component-reuse
description: Component and code reuse guardrails for the 3E app (React + Vite + TS, Hono on Cloudflare Workers). Apply before adding any new component, helper, hook, endpoint, or type so shared code stays single-sourced and the repo stays small.
---

# Component reuse — 3E guardrails

Before writing any new component, hook, helper, endpoint, type, or constant: search the repo
for an existing one that does the job. Reuse wins over writing new; extending wins over copying.

## Rules

1. **Search first:** grep `src/`, `api/`, and shared `lib/` for the concept (component name,
   hook, error string, type) before creating a file. If it exists, import it.
2. **Single source of truth:** one canonical definition each for shared types, Zod/API schemas,
   CEFR level lists (`levels.ts`), prompt templates, cost-meter (`ai_usage`), and auth helpers.
   Import from the canonical module — never redefine locally.
3. **Rule of two:** the second time you need similar logic, extract it to a shared module and
   refactor the first call site to use it. No copy-paste siblings.
4. **Shared UI primitives:** buttons, inputs, cards, loading/empty/error states, and layout live
   in one components directory with props — not per-page duplicates. Page files compose; they
   do not reimplement.
5. **API reuse:** one Hono helper for session-gating, one for JSON validation errors, one for
   rate-limit checks. New endpoints wire those helpers instead of inline copies.
6. **AI pipeline reuse:** all model calls go through the provider interfaces in `models.md`
   (`TextModel`, `ImageModel`, `SegmentModel`, `VisionModel`). No new call path, no inline fetch
   to the model API, no second cost-logging implementation.
7. **Small, named modules:** one concern per file, descriptive names, props/options objects over
   positional args. Prefer composition (props, children, callbacks) over forks and boolean-mode
   components.
8. **Delete the old copy:** when logic moves to shared code, remove the original inline version
   in the same change. No dead exports, no commented-out code, no "legacy" duplicates.

## Quick self-check before finishing a change

- [ ] Searched for an existing component/helper first.
- [ ] No new duplicate of shared types, schemas, levels, prompts, or auth/rate-limit helpers.
- [ ] Similar logic used twice is extracted, first call site refactored.
- [ ] No dead code, commented-out blocks, or orphaned exports left behind.
