import { Hono } from 'hono';
import type { Bindings, Variables } from './types';
import { isRecord } from './validate';

// Fixed A1 sample test: hand-written bank mirroring published A1 task
// families (Cambridge A1 Movers Reading & Writing: word definitions,
// yes/no judgments, dialogue responses, gap-fill). Original items only —
// format inspiration, never copied content. Server-side grading, $0 per
// attempt. Practice only, not a certificate.

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

type Item = [id: string, prompt: string, options: string[], answer: number, explanation: string, passage?: string];

const PART1: Item[] = [
  ['p1a', 'It says meow.', ['A cat', 'A dog', 'A bird', 'A fish'], 0, 'A cat says meow.'],
  ['p1b', 'You read it.', ['A house', 'A school', 'Water', 'A book'], 3, 'You read a book.'],
  ['p1c', 'It is hot and you see it in the day.', ['Rain', 'Water', 'A bird', 'The sun'], 3, 'The sun is hot and in the day sky.'],
  ['p1d', 'You drink it. It is in a glass.', ['Food', 'Water', 'A school', 'Rain'], 1, 'You drink water.'],
  ['p1e', 'It says woof. It runs.', ['A cat', 'A bird', 'A dog', 'A fish'], 2, 'A dog says woof.'],
  ['p1f', 'You live in it.', ['A school', 'A book', 'Water', 'A house'], 3, 'You live in a house.'],
];

const PART2: Item[] = [
  ['p2a', 'Tom has a cat. The cat says meow. The cat says woof.', ['Yes', 'No'], 1, 'A cat says meow, not woof.'],
  ['p2b', 'One and two is three.', ['Yes', 'No'], 0, 'One and two is three.'],
  ['p2c', 'Water is red.', ['Yes', 'No'], 1, 'Water is not red.'],
  ['p2d', 'In the day, the sun is hot.', ['Yes', 'No'], 0, 'The sun is hot in the day.'],
  ['p2e', 'A fish lives in a tree.', ['Yes', 'No'], 1, 'A fish lives in water, not a tree.'],
  ['p2f', 'A bird can fly.', ['Yes', 'No'], 0, 'A bird can fly.'],
];

const PART3: Item[] = [
  ['p3a', 'Hello! What is your name? ___', ['My name is Ana', 'It is blue', 'I am ten'], 0, '"My name is Ana" answers the name question.'],
  ['p3b', 'Is this your book? No, ___.', ['it is not', 'I am ten', 'it is blue'], 0, '"No, it is not" answers the yes/no question.'],
  ['p3c', 'Where is the cat? ___.', ['It is in the house', 'It is blue', 'I am happy'], 0, '"It is in the house" answers the where question.'],
  ['p3d', 'Do you like rain? No, ___.', ['I do not', 'it is hot', 'I am a boy'], 0, '"No, I do not" answers the do question.'],
  ['p3e', 'How are you? ___.', ['I am happy', 'It is a dog', 'You are Sam'], 0, '"I am happy" answers the how question.'],
  ['p3f', 'What color is the sun? ___.', ['It is yellow', 'It is a dog', 'I am ten'], 0, '"It is yellow" answers the color question.'],
];

const PART4: Item[] = [
  ['p4a', 'A ___ says meow.', ['dog', 'rain', 'sun', 'cat'], 3, 'A cat says meow.'],
  ['p4b', 'She ___ water every day.', ['eat', 'run', 'drinks', 'walk'], 2, 'With she, add -s: she drinks.'],
  ['p4c', 'They drink ___ every day.', ['rain', 'run', 'blue', 'water'], 3, 'They drink water.'],
  ['p4d', 'Hello! My name ___ Ana.', ['am', 'are', 'be', 'is'], 3, 'My name is Ana.'],
  ['p4e', 'I see ___ dogs. One and one.', ['three', 'blue', 'run', 'two'], 3, 'One and one is two.'],
  ['p4f', 'We ___ to school in the morning.', ['goes', 'went', 'is', 'go'], 3, 'With we, use go: we go.'],
];

function buildBank(): ExamQuestion[] {
  const out: ExamQuestion[] = [];
  for (const [part, items] of [[1, PART1], [2, PART2], [3, PART3], [4, PART4]] as const) {
    for (const [id, prompt, options, answer, explanation] of items) {
      out.push({ id, part, section: PART_SECTION[part], prompt, options, answer, explanation });
    }
  }
  return out;
}

export const QUESTIONS = buildBank();
const byId = new Map(QUESTIONS.map((q) => [q.id, q]));

function pickForm(): ExamQuestion[] {
  const form: ExamQuestion[] = [];
  for (let part: 1 | 2 | 3 | 4 = 1; part <= 4; part = (part + 1) as 1 | 2 | 3 | 4) {
    const pool = QUESTIONS.filter((q) => q.part === part);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    form.push(...pool.slice(0, PER_PART));
  }
  return form;
}

export const exam = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false });

// Questions only — answers stay server-side. A fresh 12-item form per call.
exam.get('/', (c) => {
  return c.json({
    questions: pickForm().map(({ answer, ...q }) => q),
    total: FORM_SIZE,
    passMark: PASS_MARK,
  });
});

exam.get('/best', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n, MAX(score) AS best FROM exam_attempts WHERE user_id = ?',
  )
    .bind(c.get('userId'))
    .first<{ n: number | null; best: number | null }>();
  return c.json({ attempts: row?.n ?? 0, best: row?.best ?? null, total: FORM_SIZE, passMark: PASS_MARK });
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
  const form = body.form as unknown[];
  if (form.length === 0 || form.length > QUESTIONS.length) return c.json({ error: 'invalid request' }, 400);
  const formSet = new Set<string>();
  for (const id of form) {
    if (typeof id !== 'string' || !byId.has(id) || formSet.has(id)) return c.json({ error: 'invalid request' }, 400);
    formSet.add(id);
  }
  const seen = new Set<string>();
  let score = 0;
  const review: { id: string; correct: boolean; answer: number; explanation: string }[] = [];
  for (const a of body.answers as unknown[]) {
    if (!isRecord(a) || typeof a.id !== 'string' || typeof a.choice !== 'number') {
      return c.json({ error: 'invalid request' }, 400);
    }
    const q = byId.get(a.id);
    if (!q || !formSet.has(a.id) || seen.has(a.id)) return c.json({ error: 'invalid request' }, 400);
    seen.add(a.id);
    const correct = a.choice === q.answer;
    if (correct) score += 1;
    review.push({ id: q.id, correct, answer: q.answer, explanation: q.explanation });
  }
  // Served but unanswered counts as missed.
  for (const id of formSet) {
    if (!seen.has(id)) {
      const q = byId.get(id) as ExamQuestion;
      review.push({ id, correct: false, answer: q.answer, explanation: q.explanation });
    }
  }
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    'INSERT INTO exam_attempts (id, user_id, score, total, answers_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(crypto.randomUUID(), c.get('userId'), score, formSet.size, JSON.stringify({ form: [...formSet], review }), now)
    .run();
  const passed = score >= Math.ceil(formSet.size * PASS_RATE);
  const weak = [...new Set(review.filter((r) => !r.correct).map((r) => byId.get(r.id)?.section ?? ''))];
  return c.json({
    score,
    total: formSet.size,
    passed,
    message: passed
      ? 'Ready for A1. Try a B1 book next, or a real certificate such as LanguageCert ESOL A1.'
      : `Keep practicing${weak.length ? ` — focus on: ${weak.join(', ')}` : ''}. Reread an A1 book, then try again.`,
    review,
  });
});
