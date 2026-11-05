#!/usr/bin/env node
// Factory status: one command that answers "have we already done this?"
// before anyone (or any schedule) fires off another make-books run.
//
// Prints three things:
//   1. Local ledger state (committed qa/book-ledger*.json merged).
//   2. Recent make-books runs on GitHub (schedule vs manual dispatch).
//   3. The pre-dispatch checklist.
//
// Usage: npm run qa:factory-status
// Needs `gh` authenticated for part 2; parts 1 and 3 work without it.
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const QA_DIR = dirname(fileURLToPath(import.meta.url));

console.log('=== local ledgers (committed baseline; scheduled runs resume from Actions cache) ===');
spawnSync('node', ['qa/ledger.mjs'], { stdio: 'inherit', cwd: new URL('..', import.meta.url) });

console.log('\n=== recent make-books runs (remote truth) ===');
try {
  const out = execFileSync(
    'gh',
    ['run', 'list', '--workflow', 'make-books', '--limit', '5'],
    { encoding: 'utf8', timeout: 30000 },
  );
  console.log(out.trim() || '(no runs found)');
} catch {
  console.log('(gh unavailable or not authenticated — check the Actions tab instead: make-books workflow)');
}

console.log(`
=== before you dispatch (so nothing runs twice) ===
- If a run above is in_progress, do nothing: --resume retries only the
  unfinished, and a second run just burns AI spend in parallel.
- Preview first: node qa/make-books.mjs --dry --shard 0/10
  (shows [new|partial|failed|published] per book in that shard).
- Live runs use --resume: published/stalled books are skipped, partials
  continue on the SAME project (no duplicate drafts), finished art scenes
  are skipped. Watch for the "--resume: skipping N" line in the logs.
- Per-run detail lives in run artifacts (factory-ledger-shardNof10-RUN);
  download them to see exactly what a remote run did.
- Committed qa/book-ledger-shard*of3.json files are the 3-shard baseline
  only — the nightly 10-shard schedule resumes from Actions cache, so the
  repo files alone never tell you what is done. This command does.
`);
