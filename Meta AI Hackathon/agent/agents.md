# Subagent definitions

Three roles you can hand off to. In Zed, spawn each with the `spawn_agent` tool using the prompt
below. Muse Code itself is the primary **builder** (run `muse`, give it "execute Step N").

## 1. builder (primary — usually Muse Code, not a subagent)

- **Does:** implements a `PLAN.md` Step, end to end, against `.muserules.md`.
- **Prompt to Muse Code:** `Read PLAN.md and .muserules.md, then execute Step N. Check the Done-when gate before stopping.`

## 2. reviewer

- **Does:** reads the diff for the current Step and checks it against the non-negotiable rules and
  the model strings; flags errors, wrong API usage, and missing `ai_usage` logging.
- **Prompt:**

```
Review the current changes against Meta AI Hackathon/PLAN.md, models.md, and prompts.md.
Check only blocking correctness of the main path: (1) fresh code only, (2) CEFR A1–B2 level+length
enforced, (3) every AI attempt logged to ai_usage with op_id/attempt/cost_usd, (4) AI only via the
provider interfaces, (5) correct model strings (muse-spark-1.3 / muse-image-1.0 / sam-3.1), (6) no
secrets committed.
Do NOT flag missing tests, edge cases, or security hardening — this is a speed-first MVP.
Return a short list of blocking vs. non-blocking issues.
```

## 3. researcher

- **Does:** verifies anything we aren't sure about (API endpoint, pricing, a license) and returns a
  one-paragraph answer with the source URL.
- **Prompt:**

```
Answer this question using only reliable sources and return the answer + source URL, no filler:
<QUESTION>
```
