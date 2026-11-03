import type { D1Database } from '@cloudflare/workers-types';

// Shared shelf logic: which library books the reader left on the final page.
// D1 cannot join across databases, so positions are read from the app DB,
// matched against library manifests, and finished books are returned.
// Extracted from the /api/me/activity handler — both call sites use this.

export interface FinishedBook {
  id: string;
  title: string;
  cover_url: string | null;
}

export async function finishedBooks(
  db: D1Database,
  libraryDb: D1Database,
  userId: string,
): Promise<{ started: number; finished: FinishedBook[] }> {
  const { results: positions } = await db
    .prepare('SELECT book_id, scene_number FROM reading_sync WHERE updated_by = ?')
    .bind(userId)
    .all<{ book_id: string; scene_number: number }>();
  const byId = new Map((positions ?? []).map((p) => [p.book_id, p.scene_number]));
  const finished: FinishedBook[] = [];
  if (byId.size === 0) return { started: 0, finished };
  const inIds = [...byId.keys()].map(() => '?').join(',');
  const { results: found } = await libraryDb
    .prepare(`SELECT id, title, cover_url, manifest_json FROM books WHERE id IN (${inIds})`)
    .bind(...byId.keys())
    .all<{ id: string; title: string; cover_url: string | null; manifest_json: string }>();
  for (const b of found ?? []) {
    try {
      const m = JSON.parse(b.manifest_json) as { scenes?: unknown[] };
      if (Array.isArray(m.scenes) && (byId.get(b.id) ?? 0) >= m.scenes.length) {
        finished.push({ id: b.id, title: b.title, cover_url: b.cover_url });
      }
    } catch {
      // Corrupt manifest: not shelf-worthy.
    }
  }
  return { started: byId.size, finished };
}
