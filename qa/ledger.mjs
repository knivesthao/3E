#!/usr/bin/env node
// Ledger status view: merges every qa/book-ledger*.json (one per shard)
// into a single per-title table so parallel jobs stay observable.
// Usage: node qa/ledger.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const QA_DIR = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(QA_DIR)
  .filter((f) => /^book-ledger.*\.json$/.test(f))
  .sort();
if (files.length === 0) {
  console.log('no ledgers yet — run qa/make-books.mjs first');
  process.exit(0);
}
const merged = new Map(); // title -> {entry, file}
for (const f of files) {
  let ledger = {};
  try {
    ledger = JSON.parse(readFileSync(join(QA_DIR, f), 'utf8'));
  } catch {
    continue;
  }
  for (const [title, entry] of Object.entries(ledger)) merged.set(title, { entry, file: f });
}
const rows = [...merged.entries()].sort((a, b) => a[0].localeCompare(b[0]));
let published = 0;
for (const [title, { entry, file }] of rows) {
  const detail =
    entry.status === 'published'
      ? `book ${entry.bookId ?? '?'} $${(entry.total ?? 0).toFixed(4)}`
      : `project ${entry.projectId ?? '?'} saved [${(entry.saved ?? []).join(',')}] art [${(entry.art ?? []).join(',')}]${entry.error ? ` err: ${String(entry.error).slice(0, 80)}` : ''}`;
  if (entry.status === 'published') published++;
  console.log(`${(entry.status ?? '?').padEnd(9)} ${(entry.level ?? '?').padEnd(3)} ${title} :: ${detail} [${file}]`);
}
console.log(`\n${published}/${rows.length} published across ${files.length} ledger file(s): ${files.join(', ')}`);
