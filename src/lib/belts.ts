// Practice-exam belts: a visible ladder over the existing grading.
// White = tried, yellow = passed, black = perfect. Thresholds come from
// the server's own best/passMark/total, so the belt can never disagree
// with the grade. Per-level belts (B1, B2…) reuse this when those forms exist.
export type Belt = 'none' | 'white' | 'yellow' | 'black';

export function beltFor(best: number | null, passMark: number, total: number): Belt {
  if (best === null || total <= 0) return 'none';
  if (best >= total) return 'black';
  if (best >= passMark) return 'yellow';
  return 'white';
}

export const BELT_LABEL: Record<Exclude<Belt, 'none'>, string> = {
  white: 'White belt — good try',
  yellow: 'Yellow belt — passed!',
  black: 'Black belt — perfect!',
};

export const BELT_STYLE: Record<Exclude<Belt, 'none'>, string> = {
  white: 'border-stone-400 bg-white text-stone-900',
  yellow: 'border-amber-500 bg-amber-300 text-stone-900',
  black: 'border-stone-900 bg-stone-900 text-white',
};
