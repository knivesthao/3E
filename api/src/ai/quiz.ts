import type { D1Database } from '@cloudflare/workers-types';
import type { BasetenConfig } from './config';
import { generate, parseJson } from './client';
import { quizPrompt } from './prompts';
import type { Level } from '../levels';

// Static book quizzes: generated once at publish, served forever. Students
// never pay for a quiz view, and republish regenerates from the new scenes.
export interface QuizQuestion {
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
}

export function isQuizReply(t: unknown): t is { questions: QuizQuestion[] } {
  if (typeof t !== 'object' || t === null || !Array.isArray((t as { questions: unknown }).questions)) return false;
  const qs = (t as { questions: unknown }).questions as unknown[];
  if (qs.length < 4 || qs.length > 8) return false;
  return qs.every((q) => {
    if (typeof q !== 'object' || q === null) return false;
    const r = q as Record<string, unknown>;
    if (typeof r.prompt !== 'string' || r.prompt === '' || r.prompt.length > 300) return false;
    if (!Array.isArray(r.options) || r.options.length < 2 || r.options.length > 4) return false;
    if (!(r.options as unknown[]).every((o) => typeof o === 'string' && o !== '' && (o as string).length <= 100)) return false;
    if (typeof r.answer !== 'number' || !Number.isInteger(r.answer) || r.answer < 0 || r.answer >= (r.options as unknown[]).length) {
      return false;
    }
    return typeof r.explanation === 'string' && r.explanation !== '' && r.explanation.length <= 300;
  });
}

export function parseStoredQuiz(value: unknown): QuizQuestion[] | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const v = JSON.parse(value) as unknown;
    if (isQuizReply(v) && v.questions.length > 0) return v.questions;
    return null;
  } catch {
    return null;
  }
}

export interface QuizCtx {
  apiKey: string;
  userId: string;
  projectId: string;
  opId: string;
  apiUrl?: string;
  baseten: BasetenConfig | null;
}

// One model call, validated. Throws AiError on failure like every task.
export async function buildQuiz(
  db: D1Database,
  ctx: QuizCtx,
  level: Level,
  story: string,
): Promise<QuizQuestion[]> {
  const { text } = await generate(db, {
    ...ctx,
    task: 'quiz',
    prompt: quizPrompt(level, story),
    json: true,
    validate: (t) => parseJson(t, isQuizReply) !== null,
  });
  const v = parseJson(text, isQuizReply) as { questions: QuizQuestion[] };
  return v.questions;
}
