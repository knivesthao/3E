import type { ExamLevel } from './api';
import { EXAM_LEVELS } from './api';

// One exam per level, generated from that level's bank. Anyone may take any
// level; history records which level each attempt was.
export { EXAM_LEVELS };
export type { ExamLevel };

export const LEVEL_BLURB: Record<ExamLevel, string> = {
  A1: 'First words and short sentences',
  A2: 'Past time and everyday life',
  B1: 'Longer texts and everyday talk',
  B2: 'Complex grammar and long texts',
};

export function levelBlurb(level: ExamLevel): string {
  return LEVEL_BLURB[level];
}

export function isExamLevel(value: unknown): value is ExamLevel {
  return typeof value === 'string' && (EXAM_LEVELS as string[]).includes(value);
}

// Short local date for history rows, e.g. "Nov 4, 2026, 3:02 PM".
// Falls back to the raw value when it is not a date.
export function formatAttemptDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
