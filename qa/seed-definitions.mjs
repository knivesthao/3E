#!/usr/bin/env node
// Dictionary seed (Phase 1): generates leveled glosses on the Baseten
// hackathon model and pushes them to the local worker's dev-only
// POST /api/admin/definitions. Idempotent: the table is UNIQUE(word, level,
// lang) with INSERT OR IGNORE, and a local progress file skips finished
// words, so reruns only generate gaps. Nothing is committed with secrets.
//
// Word lists come from api/src/levels.ts (parsed, not duplicated — one source
// of truth). The verifier below mirrors its tokenize/stem/allowedSet logic;
// keep the two in sync when levels.ts changes.
//
// Usage:
//   node qa/seed-definitions.mjs [--api http://localhost:8787]
//     [--email qa@example.com] [--levels A1,A2] [--limit 50] [--dry-run]
//     [--max-tokens 2000000] [--batch 10] [--sql-out qa/definitions-seed.sql]
//     [--no-push] [--clean] [--key $BASETEN_API_KEY]
//   Requires the dev stack: ./run.sh dev
//   Key: --key, $BASETEN_API_KEY, or BASETEN_API_KEY= in .dev.vars / api/.dev.vars

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const flag = (name) => args.includes(name);

const API = opt('--api', process.env.API ?? 'http://localhost:8787').replace(/\/$/, '');
const EMAIL = opt('--email', process.env.EMAIL ?? 'qa@example.com');
const LEVELS = opt('--levels', 'A1,A2').split(',').map((s) => s.trim().toUpperCase());
const LIMIT = Number(opt('--limit', '0')) || 0;
const DRY = flag('--dry-run');
const MAX_TOKENS = Number(opt('--max-tokens', '2000000')) || 2000000;
const BATCH = Number(opt('--batch', '10')) || 10;
const SQL_OUT = opt('--sql-out', 'qa/definitions-seed.sql');
const PUSH = !flag('--no-push');
const PROGRESS_FILE = 'qa/definitions-progress.json';
const MODEL = 'meta-models/muse-spark-open-1026';
const BASE_URL = 'https://inference.baseten.co/v1/chat/completions';

function apiKey() {
  if (opt('--key', '')) return opt('--key', '');
  if (process.env.BASETEN_API_KEY) return process.env.BASETEN_API_KEY;
  for (const f of ['.dev.vars', 'api/.dev.vars']) {
    try {
      const m = readFileSync(f, 'utf8').match(/^BASETEN_API_KEY=(.+)$/m);
      if (m && m[1].trim()) return m[1].trim();
    } catch { /* missing file: try next */ }
  }
  return '';
}

// ---- Word lists: parsed from api/src/levels.ts (single source of truth).
function loadLists() {
  const src = readFileSync('api/src/levels.ts', 'utf8');
  const lists = {};
  for (const lvl of ['A1', 'A2', 'B1', 'B2']) {
    const m = src.match(new RegExp(`const ${lvl} = \\[([\\s\\S]*?)\\];`));
    if (!m) throw new Error(`list ${lvl} not found in api/src/levels.ts`);
    lists[lvl] = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1].toLowerCase());
  }
  return lists;
}

// ---- Verifier: mirrors api/src/levels.ts tokenize/stem/allowedSet/checkLevel.
function tokenize(text) {
  return (text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? []).filter((t) => t.length > 0);
}
function stem(token) {
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  for (const suffix of ['ing', 'ed', 'es', 's', 'd']) {
    const minStem = suffix === 'ing' ? 2 : 3;
    if (token.endsWith(suffix) && token.length - suffix.length >= minStem) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}
function allowedSet(lists, level, extra = []) {
  const set = new Set();
  for (const l of ['A1', 'A2', 'B1', 'B2']) {
    for (const w of lists[l]) set.add(w);
    if (l === level) break;
  }
  for (const w of extra) set.add(w.toLowerCase());
  return set;
}
// A gloss passes when >=90% of its tokens are level-known (the word itself
// is always allowed input) and it is not circular (not just the word again).
function verifyGloss(lists, word, gloss, level) {
  const allowed = allowedSet(lists, level, [word]);
  const tokens = tokenize(gloss);
  if (tokens.length === 0 || tokens.length > 40) return { ok: false, reason: 'length' };
  const unknown = tokens.filter((t) => !allowed.has(t) && !allowed.has(stem(t)));
  if (unknown.length / tokens.length > 0.1) return { ok: false, reason: `hard words: ${unknown.slice(0, 5).join(',')}` };
  const content = tokens.filter((t) => stem(t) !== stem(word.toLowerCase()));
  if (content.length === 0) return { ok: false, reason: 'circular' };
  return { ok: true };
}

// ---- Baseten call: one batch of words, strict JSON, level-appropriate.
const LEVEL_STYLE = {
  A1: 'a 6-year-old beginner. Use ONLY very easy everyday words in short sentences',
  A2: 'a 7-year-old elementary learner. Use only easy everyday words',
  B1: 'an intermediate young learner. Keep it clear and simple',
  B2: 'an upper-intermediate young learner. Keep it clear, one short sentence',
};
async function defineBatch(key, words, level, strict) {
  const numbered = words.map((w, i) => `${i + 1}. ${w}`).join('\n');
  const style = strict
    ? 'Use ONLY the 500 most common English words. Short sentences'
    : LEVEL_STYLE[level];
  const prompt =
    `Define each English word for ${style}.\n` +
    `Words:\n${numbered}\n` +
    `Reply with JSON only: {"meanings":[{"word":"<exact word>","meaning":"<one short definition>"}]} in the same order.`;
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' }, max_tokens: 2000 }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`baseten ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  const usage = data?.usage ?? {};
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.meanings)) throw new Error('bad gloss json');
  return { meanings: parsed.meanings, tokens: (usage.total_tokens ?? 0) };
}

// ---- Dev worker session (magic dev link, manual redirect to keep cookies).
async function signIn() {
  const rl = await fetch(`${API}/api/auth/request-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL }),
  });
  const { devLink } = await rl.json();
  if (!devLink) throw new Error('no devLink — is the dev stack running with DEV_LINKS=true?');
  const v = await fetch(devLink, { redirect: 'manual' });
  const cookie = (v.headers.get('set-cookie') ?? '').split(';')[0];
  if (!cookie) throw new Error('no session cookie from verify');
  return cookie;
}

function esc(s) {
  // Single-line the value: newlines inside a SQL string literal would
  // corrupt the dump file. Glosses are one sentence by construction.
  return s.replace(/[\r\n]+/g, ' ').replace(/'/g, "''");
}
function sqlLine(r, lang) {
  return `INSERT OR IGNORE INTO definitions (word, level, lang, gloss, source, verified, created_at) VALUES ('${esc(r.word)}', '${r.level}', '${lang}', '${esc(r.gloss)}', '${esc(r.source)}', ${r.verified}, datetime('now'));`;
}

async function main() {
  const lists = loadLists();
  const key = apiKey();
  if (!key && !DRY) throw new Error('no Baseten key: --key, $BASETEN_API_KEY, or BASETEN_API_KEY= in .dev.vars');
  let progress = { done: [] };
  if (existsSync(PROGRESS_FILE) && !flag('--clean')) {
    try { progress = JSON.parse(readFileSync(PROGRESS_FILE, 'utf8')); } catch { /* start fresh */ }
  }
  const done = new Set(progress.done);
  const targets = [];
  for (const level of LEVELS) {
    if (!lists[level]) throw new Error(`unknown level ${level}`);
    for (const word of lists[level]) {
      if (!done.has(`${level}|${word}`)) targets.push({ level, word });
    }
  }
  const queue = LIMIT > 0 ? targets.slice(0, LIMIT) : targets;
  console.log(`${queue.length} glosses to generate (${done.size} already done)${DRY ? ' [dry run]' : ''}`);
  if (DRY) {
    console.log(queue.slice(0, 20).map((t) => `${t.level}:${t.word}`).join(', ') + (queue.length > 20 ? ' …' : ''));
    return;
  }
  const cookie = PUSH ? await signIn() : '';
  let tokens = 0;
  let generated = 0;
  const sample = {};
  const sql = ['-- 3E dictionary seed: run with `wrangler d1 execute 3e-db --file=<this>` for prod.'];
  for (let i = 0; i < queue.length; i += BATCH) {
    const chunk = queue.slice(i, i + BATCH);
    if (tokens >= MAX_TOKENS) { console.log(`token budget reached (${tokens}) — stopping, rerun resumes`); break; }
    const byLevel = {};
    for (const t of chunk) (byLevel[t.level] ??= []).push(t.word);
    for (const [level, words] of Object.entries(byLevel)) {
      let meanings;
      try {
        ({ meanings, tokens: used } = await defineBatch(key, words, level, false));
        tokens += used;
      } catch (e) {
        console.log(`batch failed (${level}): ${e.message} — skipping, rerun resumes`);
        continue;
      }
      const rows = [];
      const succeeded = new Set();
      for (let k = 0; k < words.length; k++) {
        const word = words[k];
        const gloss = meanings?.[k]?.word === word ? String(meanings[k].meaning ?? '') : '';
        let v = gloss ? verifyGloss(lists, word, gloss, level) : { ok: false, reason: 'missing' };
        let finalGloss = gloss;
        let verified = v.ok ? 1 : 0;
        if (!v.ok && gloss) {
          // One stricter retry before shipping it unverified.
          try {
            const retry = await defineBatch(key, [word], level, true);
            tokens += retry.tokens;
            const g2 = retry.meanings?.[0]?.word === word ? String(retry.meanings[0].meaning ?? '') : '';
            const v2 = g2 ? verifyGloss(lists, word, g2, level) : { ok: false, reason: 'missing' };
            if (v2.ok) { finalGloss = g2; verified = 1; v = v2; }
          } catch { /* keep first attempt as unverified */ }
        }
        if (!finalGloss) { console.log(`no gloss for ${level}:${word} — skipping`); continue; }
        rows.push({ word, level, gloss: finalGloss, source: 'baseten', verified });
        succeeded.add(word);
        (sample[level] ??= []).push({ word, gloss: finalGloss, verified, note: v.ok ? '' : v.reason });
        sql.push(sqlLine(rows[rows.length - 1], 'en'));
      }
      if (PUSH && rows.length > 0) {
        const pr = await fetch(`${API}/api/admin/definitions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ rows }),
        });
        if (!pr.ok) throw new Error(`push failed: ${pr.status} (is DEV_LINKS=true?)`);
      }
      // Only words that actually produced a gloss count as done: failures
      // stay in the queue so the next run retries them (no wasted tokens).
      for (const w of succeeded) done.add(`${level}|${w}`);
      generated += rows.length;
      writeFileSync(PROGRESS_FILE, JSON.stringify({ done: [...done] }));
    }
    console.log(`[${Math.min(i + BATCH, queue.length)}/${queue.length}] tokens=${tokens} generated=${generated}`);
  }
  writeFileSync(SQL_OUT, sql.join('\n') + '\n');
  console.log(`\nSQL dump: ${SQL_OUT} (${sql.length - 1} rows) — prod import: wrangler d1 execute 3e-db --file=${SQL_OUT}`);
  for (const [level, items] of Object.entries(sample)) {
    const bad = items.filter((s) => !s.verified);
    console.log(`\n— ${level} sample (${items.length} shown, ${bad.length} unverified) —`);
    const shown = [...items.filter((s) => s.verified).slice(0, 20), ...bad.slice(0, 20)];
    for (const s of shown) console.log(`  ${s.verified ? 'ok ' : 'FIX'} ${s.word}: ${s.gloss}${s.note ? `  [${s.note}]` : ''}`);
    writeFileSync(`qa/definitions-sample-${level}.md`,
      `# ${level} gloss sample\n\n` + shown.map((s) => `- [${s.verified ? 'x' : ' '}] **${s.word}** — ${s.gloss}${s.note ? ` (${s.note})` : ''}`).join('\n') + '\n');
  }
}

main().catch((e) => { console.error(`seed-definitions: ${e.message}`); process.exit(1); });
