import type { D1Database } from '@cloudflare/workers-types';
import { finishedBooks, type FinishedBook } from './shelf';

export interface ActivitySummary {
  days: string[];
  totalDays: number;
  streak: number;
  finished: FinishedBook[];
  lastActive: string | null;
}

// Per-learner activity from existing tables — zero extra writes. Streak
// counts back from today, so reading today already extends it. Shared by
// the self endpoint (/api/me/activity) and teacher class tracking.
export async function summarizeActivity(
  db: D1Database,
  libraryDb: D1Database,
  userId: string,
): Promise<ActivitySummary> {
  const [examRows, readRows] = await Promise.all([
    db
      .prepare('SELECT DISTINCT substr(created_at, 1, 10) AS day FROM exam_attempts WHERE user_id = ?')
      .bind(userId)
      .all<{ day: string }>(),
    db
      .prepare('SELECT DISTINCT substr(updated_at, 1, 10) AS day FROM reading_sync WHERE updated_by = ?')
      .bind(userId)
      .all<{ day: string }>(),
  ]);
  const daySet = new Set(
    [...(examRows.results ?? []), ...(readRows.results ?? [])].map((r) => r.day),
  );
  const days = [...daySet].sort();
  let streak = 0;
  const cursor = new Date();
  while (daySet.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  // Finished books via the shared shelf helper (same fetch-then-match
  // across the app/library DB boundary the summary endpoint uses).
  const { finished } = await finishedBooks(db, libraryDb, userId);
  return { days, totalDays: days.length, streak, finished, lastActive: days.length > 0 ? days[days.length - 1] : null };
}
