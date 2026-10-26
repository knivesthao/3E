---
name: post-commit-check
description: Post-commit integrity check for the 3E repo. Invoke after a commit is pushed to GitHub: watches the CI run for that commit and reports whether anything broke, with failure details and a fix recommendation.
---

# Post-commit check — 3E integrity watch

Invoke after a push (manually or when the commit-summary skill recommends it). Requires
GitHub auth on this machine (`gh auth login -h github.com`); if auth is missing, report
that instead of guessing.

## Steps

1. **Identify the run:** `git rev-parse HEAD` for the SHA, then
   `gh run list --commit <sha> --repo knivesthao/3E --limit 5`. If no run exists yet
   (push still propagating), wait briefly and retry at most twice.
2. **Watch it:** `gh run watch <run-id> --repo knivesthao/3E` (bounded wait). Do not
   poll in a loop — one watch call, then read the result.
3. **Report integrity:**
   - Green: commit SHA, workflow + run id, jobs passed, "nothing broke".
   - Red: failed jobs, failing step names, and the relevant log excerpt
     (`gh run view <run-id> --log-failed --repo knivesthao/3E`).
4. **Recommend, don't fix:** map each failure to its cause area (tests, typecheck,
   build, security gate) and propose the smallest next change. Implement it only when
   asked — never commit as part of this check.

## Rules

- Read-only against GitHub: `gh run list/view/watch` only. No re-runs, no merges, no
  pushes from this skill.
- Never claim green from anything but the CI run result for that exact commit SHA.
  A local suite, an older run, or a different branch proves nothing about this commit.
