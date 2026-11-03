// Audit published books for partial drafts (fewer scenes than the /finish
// minimum of 6). Exit 0 when clean, 1 when partials exist — gate the morning
// batches on this before promoting anything to the shared library.
// Usage: node qa/audit-books.mjs [--api http://localhost:8787]
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const MIN_SCENES = Number(opt('--min-scenes', '6')) || 6;
const SQL = `SELECT substr(id,1,8) id, title, level, json_array_length(manifest_json, '$.scenes') scenes FROM books;`;

function query(label, cmd, argv) {
  try {
    const out = execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const rows = JSON.parse(out)[0].results ?? [];
    return { label, rows };
  } catch {
    console.log(`${label}: unreadable (container down?) — skipped`);
    return { label, rows: null };
  }
}

const libs = [
  query('local', 'docker', ['exec', '3e-dev', 'sh', '-c',
    `cd /app && npx wrangler --config api/wrangler.toml d1 execute 3e-books --local --command "${SQL}" --json`]),
  query('remote', 'npx', ['wrangler', 'd1', 'execute', '3e-books', '--remote', '--command', SQL, '--json']),
];

let partials = 0;
for (const { label, rows } of libs) {
  if (!rows) continue;
  const short = rows.filter((r) => (r.scenes ?? 0) < MIN_SCENES);
  partials += short.length;
  console.log(`${label}: ${rows.length} books, ${short.length} partial (<${MIN_SCENES} scenes)`);
  for (const b of short) console.log(`  PARTIAL ${b.id} ${b.level} ${b.title} (${b.scenes} scenes)`);
}
process.exit(partials > 0 ? 1 : 0);
