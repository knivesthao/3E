# Workflow

## The one-prompt setup (run once, at project start)

Point Muse Code at the agent folder and say:

```
Scan Meta AI Hackathon/agent and set up your rules.
```

`README.md` in that folder tells it exactly what to do (copy `.muserules.md`, read the workflow,
confirm the docs). Do not start coding until you say `execute Step 1`.

## Daily loop

1. **Start** — tell the agent: `execute Step N` (first time: `execute Step 1`).
2. **Build** — the builder works the Step's checklist; each Step has a **Done when** gate.
3. **Review** — spawn the `reviewer` subagent on the diff; fix blocking issues.
4. **Commit** — commit with a descriptive message (every ~2 hours).
5. **Report** — the agent ends with "Step completed · files changed · next step."

## Which agent does what

| Job | Agent |
|---|---|
| Write code (Steps 1–8) | Muse Code (`muse`) |
| Plan / docs / context | Zed agent (this skill) |
| Code review | `reviewer` subagent |
| Verify API/pricing/license | `researcher` subagent |

## Rules that apply everywhere

- **Speed-first:** ship the happy path; skip edge cases; no tests unless asked; no code explanation
  unless asked. Minimize tokens and round-trips.
- **Security (simple, once):** API key server-side; gate the app behind login; rate-limit AI calls;
  validate inputs.
- **Flaky network:** retry a failed command/request at most twice, then report and stop.
- `.muserules.md` — Muse Code token + architecture + non-negotiables.
- `PLAN.md` — the Steps and data model.
- `models.md` — verified model strings + base URL.
- `prompts.md` — the runtime prompts.
- `rules.md` — hackathon eligibility + IP.
