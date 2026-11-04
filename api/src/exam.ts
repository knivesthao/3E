import { Hono } from 'hono';
import type { Bindings, Variables } from './types';
import { isRecord } from './validate';
import { recordMiss } from './misses';
import { BANKS, BANK_WORDS, EXAM_LEVELS, type ExamLevel } from './exam-banks';

// Level-parameterized exams: one exam per CEFR level, each generated from
// its bank (rotating 3-per-part forms, 12 items per form). Users may take any
// level; every attempt is stored with its level so the history below can
// replay what was taken, when, how it scored, and each question for review.
// Practice only, not a certificate. Server-side grading, $0 per attempt.

export interface ExamQuestion {
  id: string;
  part: 1 | 2 | 3 | 4;
  section: 'words' | 'grammar' | 'reading';
  prompt: string;
  passage?: string;
  options: string[];
  answer: number;
  explanation: string;
}

// Rotating forms: 3 served per part from a 6-per-part bank, so repeat
// takers see fresh mixes and per-item stats accumulate across forms.
export const FORM_SIZE = 12;
const PER_PART = 3;
const PASS_RATE = 2 / 3;
export const PASS_MARK = Math.ceil(FORM_SIZE * PASS_RATE);

const PART_SECTION: Record<number, ExamQuestion['section']> = {
  1: 'words',
  2: 'reading',
  3: 'grammar',
  4: 'grammar',
};

function toQuestions(level: ExamLevel): ExamQuestion[] {
  return BANKS[level].map((q) => ({
    id: q.id,
    part: q.part,
    section: PART_SECTION[q.part],
    prompt: q.prompt,
    options: q.options,
    answer: q.answer,
    explanation: q.explanation,
    ...(q.passage ? { passage: q.passage } : {}),
  }));
}

const BANK_BY_LEVEL: Record<ExamLevel, ExamQuestion[]> = {
  A1: toQuestions('A1'),
  A2: toQuestions('A2'),
  B1: toQuestions('B1'),
  B2: toQuestions('B2'),
};

const byId = new Map<ExamLevel, Map<string, ExamQuestion>>(
  EXAM_LEVELS.map((level) => [level, new Map(BANK_BY_LEVEL[level].map((q) => [q.id, q]))]),
);

// A1 surface kept for existing consumers (feedback summary, old tests).
export const QUESTIONS = BANK_BY_LEVEL.A1;

function pickForm(level: ExamLevel): ExamQuestion[] {
  const form: ExamQuestion[] = [];
  for (let part: 1 | 2 | 3 | 4 = 1; part <= 4; part = (part + 1) as 1 | 2 | 3 | 4) {
    const pool = BANK_BY_LEVEL[level].filter((q) => q.part === part);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    form.push(...pool.slice(0, PER_PART));
  }
  return form;
}

// Level comes only from this allowlist; anything else is a 400.
function levelFrom(c: { req: { query: (name: string) => string | undefined } }): ExamLevel | null {
  const raw = c.req.query('level');
  if (!raw) return 'A1';
  return (EXAM_LEVELS as string[]).includes(raw) ? (raw as ExamLevel) : null;
}

function passedFor(score: number, total: number): boolean {
  return total > 0 && score >= Math.ceil(total * PASS_RATE);
}

export const exam = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false });

// Questions only — answers stay server-side. A fresh 12-item form per call.
exam.get('/', (c) => {
  const level = levelFrom(c);
  if (!level) return c.json({ error: 'unknown level' }, 400);
  return c.json({
    level,
    questions: pickForm(level).map(({ answer, ...q }) => q),
    total: FORM_SIZE,
    passMark: PASS_MARK,
  });
});

exam.get('/best', async (c) => {
  const level = levelFrom(c);
  if (!level) return c.json({ error: 'unknown level' }, 400);
  const row = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n, MAX(score) AS best FROM exam_attempts WHERE user_id = ? AND level = ?',
  )
    .bind(c.get('userId'), level)
    .first<{ n: number | null; best: number | null }>();
  return c.json({ level, attempts: row?.n ?? 0, best: row?.best ?? null, total: FORM_SIZE, passMark: PASS_MARK });
});

// Attempt history: what was taken, when, and how it scored. Newest first.
exam.get('/history', async (c) => {
  const raw = c.req.query('level');
  const level = raw ? ((EXAM_LEVELS as string[]).includes(raw) ? (raw as ExamLevel) : null) : null;
  if (raw && !level) return c.json({ error: 'unknown level' }, 400);
  const { results } = await c.env.DB.prepare(
    level
      ? 'SELECT id, level, score, total, created_at FROM exam_attempts WHERE user_id = ? AND level = ? ORDER BY created_at DESC, rowid DESC'
      : 'SELECT id, level, score, total, created_at FROM exam_attempts WHERE user_id = ? ORDER BY created_at DESC, rowid DESC',
  )
    .bind(...(level ? [c.get('userId'), level] : [c.get('userId')]))
    .all<{ id: string; level: string; score: number; total: number; created_at: string }>();
  return c.json({
    attempts: (results ?? []).map((r) => ({
      id: r.id,
      level: r.level,
      score: r.score,
      total: r.total,
      passed: passedFor(r.score, r.total),
      created_at: r.created_at,
    })),
  });
});

// One attempt with every question, the taker's choice, and the key —
// everything needed to go back and review. Owner-only.
exam.get('/history/:id', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT id, level, score, total, answers_json, created_at FROM exam_attempts WHERE id = ? AND user_id = ?',
  )
    .bind(c.req.param('id'), c.get('userId'))
    .first<{ id: string; level: string; score: number; total: number; answers_json: string; created_at: string }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  const level = (EXAM_LEVELS as string[]).includes(row.level) ? (row.level as ExamLevel) : 'A1';
  const lookup = byId.get(level) ?? new Map<string, ExamQuestion>();
  let stored: { form?: string[]; review?: { id: string; correct: boolean; answer: number; explanation: string }[]; choices?: Record<string, number> };
  try {
    stored = JSON.parse(row.answers_json) as typeof stored;
  } catch {
    return c.json({ error: 'unreadable attempt' }, 500);
  }
  const choices = stored.choices ?? {};
  const items = (stored.review ?? [])
    .map((r) => {
      const q = lookup.get(r.id);
      if (!q) return null;
      const choice = typeof choices[r.id] === 'number' ? (choices[r.id] as number) : null;
      return {
        id: q.id,
        part: q.part,
        section: q.section,
        prompt: q.prompt,
        ...(q.passage ? { passage: q.passage } : {}),
        options: q.options,
        choice,
        answer: r.answer,
        correct: r.correct,
        explanation: r.explanation,
      };
    })
    .filter((x) => x !== null);
  return c.json({
    id: row.id,
    level,
    score: row.score,
    total: row.total,
    passed: passedFor(row.score, row.total),
    created_at: row.created_at,
    items,
  });
});

exam.post('/submit', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid request' }, 400);
  }
  if (!isRecord(body) || !Array.isArray(body.form) || !Array.isArray(body.answers)) {
    return c.json({ error: 'invalid request' }, 400);
  }
  const rawLevel = typeof body.level === 'string' ? body.level : 'A1';
  if (!(EXAM_LEVELS as string[]).includes(rawLevel)) return c.json({ error: 'unknown level' }, 400);
  const level = rawLevel as ExamLevel;
  const lookup = byId.get(level) as Map<string, ExamQuestion>;
  const bankSize = BANK_BY_LEVEL[level].length;
  const form = body.form as unknown[];
  if (form.length === 0 || form.length > bankSize) return c.json({ error: 'invalid request' }, 400);
  const formSet = new Set<string>();
  for (const id of form) {
    if (typeof id !== 'string' || !lookup.has(id) || formSet.has(id)) return c.json({ error: 'invalid request' }, 400);
    formSet.add(id);
  }
  const seen = new Set<string>();
  const choices: Record<string, number> = {};
  let score = 0;
  const review: { id: string; correct: boolean; answer: number; explanation: string }[] = [];
  for (const a of body.answers as unknown[]) {
    if (!isRecord(a) || typeof a.id !== 'string' || typeof a.choice !== 'number') {
      return c.json({ error: 'invalid request' }, 400);
    }
    const q = lookup.get(a.id);
    if (!q || !formSet.has(a.id) || seen.has(a.id)) return c.json({ error: 'invalid request' }, 400);
    seen.add(a.id);
    choices[a.id] = a.choice;
    const correct = a.choice === q.answer;
    if (correct) score += 1;
    review.push({ id: q.id, correct, answer: q.answer, explanation: q.explanation });
  }
  // Served but unanswered counts as missed.
  for (const id of formSet) {
    if (!seen.has(id)) {
      const q = lookup.get(id) as ExamQuestion;
      review.push({ id, correct: false, answer: q.answer, explanation: q.explanation });
    }
  }
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    'INSERT INTO exam_attempts (id, user_id, score, total, answers_json, created_at, level) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(crypto.randomUUID(), c.get('userId'), score, formSet.size, JSON.stringify({ form: [...formSet], review, choices }), now, level)
    .run();
  const passed = passedFor(score, formSet.size);
  const weak = [...new Set(review.filter((r) => !r.correct).map((r) => lookup.get(r.id)?.section ?? ''))];
  // Missed items feed the word-miss loop: the My Words deck drills these.
  const missedWords = [
    ...new Set(review.filter((r) => !r.correct).flatMap((r) => BANK_WORDS[level][r.id] ?? [])),
  ];
  for (const w of missedWords) {
    await recordMiss(c.env.DB, c.get('userId'), w, level, 'exam');
  }
  return c.json({
    level,
    score,
    total: formSet.size,
    passed,
    message: passed
      ? level === 'A1'
        ? 'Ready for A1. Try a B1 book next, or a real certificate such as LanguageCert ESOL A1.'
        : `Ready for ${level}. Try a ${level} book next, or a real ${level} certificate.`
      : `Keep practicing${weak.length ? ` — focus on: ${weak.join(', ')}` : ''}. Reread a ${level} book, then try again.`,
    review,
    missedWords,
  });
});
