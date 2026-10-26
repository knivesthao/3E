---
name: 3e-hackathon
description: Meta AI Global Hackathon build of 3E (English webcomic creator + reader for ESL learners, CEFR A1-B2). Loads the hackathon plan, models, prompts, and rules, then executes the next build step. Use whenever working on the 3E MVP (Oct 26 - Nov 4).
---

# 3E — Hackathon Agent

You are working on the Meta AI Global Hackathon build of **3E**: an English webcomic
creator + reader for English-language learners (CEFR A1–B2).

## Load context first (every session, in this order)

1. `Meta AI Hackathon/PLAN.md` — the build plan, Steps 1–8.
2. `Meta AI Hackathon/models.md` — models, API base URL, verified target strings.
3. `Meta AI Hackathon/prompts.md` — the exact runtime prompts.
4. `Meta AI Hackathon/rules.md` — hackathon rules (eligibility, IP).
5. `Meta AI Hackathon/agent/agents.md` — subagent roles (builder / reviewer / researcher).
6. `Meta AI Hackathon/agent/workflow.md` — daily loop.
7. `.muserules.md` — token discipline + architecture + non-negotiables (read automatically).
8. `.agents/skills/hardware-limits/SKILL.md` — hardware guardrails (priority #2, 2015 Intel MacBook).
9. `.agents/skills/secure-coding/SKILL.md` — OWASP guardrails (priority #3).
10. `.agents/skills/component-reuse/SKILL.md` — reuse guardrails (priority #4, no duplicates).
11. `.agents/skills/service-decoupling/SKILL.md` — decoupling guardrails (priority #5, swappable models).
12. `.agents/skills/commit-summary/SKILL.md` — commit workflow (summary with every commit).

If any file is missing, tell the user to copy it from the planning repo first.

## How to work

- Say which **Step** you are executing, then do it; each Step ends with a **Done when** gate. Do not
  start the next Step until the current one passes.
- Follow the non-negotiables in `PLAN.md`: fresh code in a new repo, CEFR A1–B2, `ai_usage`
  logging of every attempt, all AI through the provider interfaces, images from a template.
- **Speed-first:** ship the happy path, skip edge cases, no tests unless asked, no code explanation
  unless asked. Minimize tokens and round-trips.
- **Security (simple, once):** API key server-side; gate everything behind login; rate-limit AI calls;
  validate inputs.
- **Flaky network:** retry a failed command/request at most twice, then report and stop.
- Keep code concise and modular. No filler, no tutorials, no intro text.

## Models (verified 2026-10-26)

- Base URL: `https://api.meta.ai/v1`, auth `Authorization: Bearer $MODEL_API_KEY`.
- Text: `muse-spark-1.3` (`muse-wonder-1.0` for harder tasks).
- Image: `muse-image-1.0`.
- Segmentation: `sam-3.1`.

## End of session

Summarize: "Step completed · files changed · next step."
