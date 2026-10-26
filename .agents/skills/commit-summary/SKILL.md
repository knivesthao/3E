---
name: commit-summary
description: GitHub commit workflow for the 3E repo. Use whenever committing: inspects the change, writes a descriptive message, and reports a summary of the commits and work done.
---

# Commit summary — 3E GitHub workflow

Every commit gets a descriptive message, and every commit ends with a summary report of the
commits and work done. Never commit, amend, or push unless the user asked for that exact
write in this session.

## Steps

1. **Inspect:** run `git status --short` and `git diff --stat` (plus `git diff --cached`
   after staging). Stage only the files this task changed — never broad-add unknown or
   unrelated files. Leave the user's unrelated files alone.
2. **Message:** short imperative subject (≤ 72 chars), then a body listing what changed
   and why. Name the PLAN step when the commit closes one (e.g. `Step 1 — scaffold + auth`).
   Reference the skill or rule that drove the change when useful.
3. **Commit:** one task = one commit. Commit every ~2 hours of active work so the timeline
   proves progress (see `Meta AI Hackathon/PLAN.md` conventions).
4. **Report (always, after the commit):** reply with a summary containing:
   - commit hash + message;
   - files changed (added / modified / deleted);
   - work done (what the change implements, in 1–3 lines);
   - relation to prior commits (builds on / closes Step N / follow-up to `<hash>`);
   - next step.

## Rules

- No secrets in messages, diffs, or the repo (keys, tokens, session IDs). `$VAR`
  placeholders only.
- Push only when explicitly asked. Linking a remote is not permission to push.
- If `git status` shows changes you did not make and cannot explain, stop and report
  instead of committing.
