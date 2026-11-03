import type { D1Database } from '@cloudflare/workers-types';
import { checkLevel } from '../levels';
import type { Level } from '../levels';
import { checkHsk, isHskLevel } from '../hsk';
import type { HskLevel } from '../hsk';
import { generate, parseJson } from './client';
import type { BasetenConfig } from './config';
import { castNames, definePrompt, keywordPrompt, sceneActionText } from './prompts';
import { isRecord } from '../validate';

// Publishing pipeline: read a book's scenes, pick the words worth learning,
// map them to stored definitions, and backfill what's missing. Runs inside
// publish (and only on new/edited scenes), so AI is spent on new content.

export interface WordCtx {
  apiKey: string;
  userId: string;
  projectId: string | null;
  opId: string;
  apiUrl?: string;
  baseten?: BasetenConfig | null;
}

export interface SceneText {
  scene_number: number;
  narration: string;
  bubbles: { speaker: string; text: string }[];
  updated_at: string;
}

const isKeywordReply = (v: unknown): v is { words: string[] } =>
  isRecord(v) && Array.isArray(v.words) && v.words.every((w) => typeof w === 'string');

const isDefineReply = (v: unknown): v is { meaning: string } =>
  isRecord(v) && typeof v.meaning === 'string';

function normWords(words: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    const t = w.trim().toLowerCase();
    if (/^[a-z]+(?:'[a-z]+)?(?:-[a-z]+)*$/.test(t) && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.slice(0, 40);
}

// One AI call per scene batch: the important content words, normalized.
export async function extractKeywords(
  db: D1Database,
  ctx: WordCtx,
  level: string,
  storyText: string,
): Promise<string[]> {
  const { text } = await generate(db, {
    ...ctx,
    task: 'keywords',
    prompt: keywordPrompt(level, storyText),
    json: true,
    validate: (t) => parseJson(t, isKeywordReply) !== null,
  });
  const parsed = parseJson(text, isKeywordReply);
  return parsed ? normWords(parsed.words) : [];
}

// Which words already have a definition at this level (chunked IN query).
export async function lookupDefined(
  db: D1Database,
  words: string[],
  level: string,
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < words.length; i += 100) {
    const chunk = words.slice(i, i + 100);
    const { results } = await db
      .prepare(`SELECT word FROM definitions WHERE level = ? AND word IN (${chunk.map(() => '?').join(',')})`)
      .bind(level, ...chunk)
      .all<{ word: string }>();
    for (const r of results) found.add(r.word);
  }
  return found;
}

// Row rules mirror POST /api/admin/definitions (trim, lengths, unverified,
// source baseten). INSERT OR IGNORE so hand-fixed glosses always win.
async function storeGloss(db: D1Database, word: string, level: string, gloss: string): Promise<boolean> {
  const g = gloss.trim();
  if (g === '' || g.length > 500) return false;
  await db
    .prepare(
      'INSERT OR IGNORE INTO definitions (word, level, lang, gloss, source, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(word, level, 'en', g, 'baseten', 0, new Date().toISOString())
    .run();
  return true;
}

// Generate glosses for words the dictionary lacks, bounded per publish so
// one book can never eat the daily budget. Throws nothing: failures stay
// missing for the next run.
export async function backfillDefinitions(
  db: D1Database,
  ctx: WordCtx,
  words: string[],
  level: string,
  cap: number,
): Promise<{ written: string[]; skipped: string[] }> {
  const written: string[] = [];
  const skipped: string[] = [];
  for (const word of words.slice(0, Math.max(0, cap))) {
    try {
      const { text } = await generate(db, {
        ...ctx,
        task: 'define',
        prompt: definePrompt(word, level),
        json: true,
        validate: (t) => {
          const p = parseJson(t, isDefineReply);
          return !!p && p.meaning.trim().length > 0 && p.meaning.length <= 500;
        },
      });
      const parsed = parseJson(text, isDefineReply);
      if (parsed && (await storeGloss(db, word, level, parsed.meaning))) written.push(word);
      else skipped.push(word);
    } catch {
      skipped.push(word);
    }
  }
  for (const word of words.slice(Math.max(0, cap))) skipped.push(word);
  return { written, skipped };
}

// Deterministic level gate per scene (no AI): pages whose words sit above
// the book's level. Self-written scenes bypass /finish, so publish runs
// this — the flags ARE the report the author acts on.
export function flagHardPages(
  scenes: { scene_number: number; narration: string; bubbles: { speaker: string; text: string }[] }[],
  level: string,
  castJson: string,
): { scene_number: number; unknown: string[] }[] {
  const extra = castNames(castJson);
  const zh = isHskLevel(level);
  const out: { scene_number: number; unknown: string[] }[] = [];
  for (const s of scenes) {
    const story = sceneActionText(s.narration, s.bubbles);
    const gate = zh
      ? checkHsk(story, level as HskLevel, extra)
      : checkLevel(story, level as Level, extra);
    if (!gate.passed) out.push({ scene_number: s.scene_number, unknown: gate.unknown });
  }
  return out;
}

export const MAX_BACKFILL_PER_PUBLISH = 50;

// Incremental word sync: only scenes edited since the last publish are
// re-read (new books sync everything). Per-scene failures keep old rows.
export async function syncBookWords(
  library: D1Database,
  db: D1Database,
  ctx: WordCtx,
  book: { id: string; level: string; castJson: string },
  scenes: SceneText[],
  since: string | null,
): Promise<{ processed: number; backfilled: string[]; skipped: string[] }> {
  const changed = since ? scenes.filter((s) => s.updated_at > since) : scenes;
  const backfilled: string[] = [];
  const skipped: string[] = [];
  let processed = 0;
  let cap = MAX_BACKFILL_PER_PUBLISH;
  for (const s of changed) {
    let words: string[];
    try {
      words = await extractKeywords(db, ctx, book.level, sceneActionText(s.narration, s.bubbles));
    } catch {
      continue;
    }
    processed++;
    const defined = await lookupDefined(db, words, book.level);
    const missing = words.filter((w) => !defined.has(w));
    const { written, skipped: sk } = await backfillDefinitions(db, ctx, missing, book.level, cap);
    cap -= written.length;
    backfilled.push(...written);
    skipped.push(...sk);
    const now = new Date().toISOString();
    await library
      .prepare('DELETE FROM book_words WHERE book_id = ? AND scene_number = ?')
      .bind(book.id, s.scene_number)
      .run();
    for (const w of words) {
      await library
        .prepare(
          'INSERT INTO book_words (id, book_id, scene_number, word, level, defined, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          crypto.randomUUID(), book.id, s.scene_number, w, book.level,
          defined.has(w) || written.includes(w) ? 1 : 0, now,
        )
        .run();
    }
  }
  return { processed, backfilled, skipped };
}
