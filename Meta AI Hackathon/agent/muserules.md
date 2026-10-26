# Muse Agent Profile — 3E (copy this to `.muserules.md` in the project root)

## Speed-first (hackathon MVP)
- Ship the happy path. Skip edge cases unless they block the main flow.
- No tests unless explicitly asked. Do not write or run tests unless told to.
- No code explanation unless asked — just make the change.
- **Security (simple, once):** API key server-side only; gate everything behind login; rate-limit AI
  calls; validate inputs. No gold-plating beyond that.
- Prefer the shortest correct implementation. Minimize tokens and round-trips.
- Network is flaky: retry a failed command/request at most twice, then report and stop.

## Token discipline
- Concise, modular code blocks. No conversational intros, no tutorials, no filler.
- For large files, output only the modified snippet or the requested function.

## Architecture context
- Mobile-first webcomic. Continuous vertical-scrolling panel viewer.
- Pre-calculate image aspect ratios to eliminate layout shift during scroll.

## Project context
- English webcomic creator + reader for English learners (CEFR A1–B2).
- Stack: React + Vite + TypeScript, Hono on Cloudflare Workers, D1, R2.
- Fresh code in a NEW repo — do not copy source from the existing reference repo.

## Models (Meta Model API, base https://api.meta.ai/v1)
- Text: `muse-spark-1.3` (`muse-wonder-1.0` for harder tasks).
- Image: `muse-image-1.0`.
- Segmentation: `sam-3.1`.

## Non-negotiables
- Reading levels CEFR A1–B2; enforce level + length on every scene.
- Log every AI attempt to `ai_usage` (op_id, attempt, task, model, tokens, cost_usd).
- All AI through the provider interfaces; images from a template, never free-text.
- Follow `PLAN.md` Steps 1–8 in order; commit every ~2 hours with descriptive messages.
