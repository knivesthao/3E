import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import app from './index';

// In-memory subset for the self-activity endpoint: real day-union, streak,
// and final-page logic over seeded exam + reading rows.
function makeDb() {
  const users = new Map<string, { id: string; email: string }>();
  const sessions = new Map<string, { user_id: string; expires_at: number }>();
  const exam: { user_id: string; created_at: string }[] = [];
  const sync = new Map<string, { book_id: string; scene_number: number; updated_by: string | null; updated_at: string }>();
  const books = new Map<string, { id: string; title: string; cover_url: string | null; manifest_json: string }>();
  return {
    seedExam(user_id: string, created_at: string) {
      exam.push({ user_id, created_at });
    },
    seedSync(book_id: string, scene_number: number, updated_by: string | null, updated_at: string) {
      sync.set(book_id, { book_id, scene_number, updated_by, updated_at });
    },
    seedBook(id: string, title: string, scenes: number) {
      books.set(id, {
        id,
        title,
        cover_url: null,
        manifest_json: JSON.stringify({ scenes: Array.from({ length: scenes }, (_, i) => ({ scene_number: i + 1 })) }),
      });
    },
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, ' ').trim();
      return {
        bind(...params: unknown[]) {
          return {
            first: async () => {
              if (q.startsWith('SELECT id FROM users WHERE email')) {
                const u = [...users.values()].find((x) => x.email === params[0]);
                return u ? { id: u.id } : null;
              }
              if (q.startsWith('SELECT user_id, expires_at FROM sessions')) {
                return sessions.get(params[0] as string) ?? null;
              }
              if (q.startsWith('SELECT users.id, users.email')) {
                const s = sessions.get(params[0] as string);
                if (!s) return null;
                const u = users.get(s.user_id);
                return u ? { id: u.id, email: u.email, expires_at: s.expires_at } : null;
              }
              return null;
            },
            all: async () => {
              if (q.startsWith('SELECT DISTINCT substr(created_at, 1, 10)')) {
                const days = [...new Set(exam.filter((e) => e.user_id === params[0]).map((e) => e.created_at.slice(0, 10)))];
                return { results: days.map((day) => ({ day })) };
              }
              if (q.startsWith('SELECT DISTINCT substr(updated_at, 1, 10)')) {
                const days = [
                  ...new Set(
                    [...sync.values()].filter((s) => s.updated_by === params[0]).map((s) => s.updated_at.slice(0, 10)),
                  ),
                ];
                return { results: days.map((day) => ({ day })) };
              }
              if (q.startsWith('SELECT b.id, b.title, b.cover_url, b.manifest_json, r.scene_number FROM books b')) {
                const results = [...sync.values()]
                  .filter((s) => s.updated_by === params[0])
                  .map((s) => ({ ...books.get(s.book_id), scene_number: s.scene_number }))
                  .filter((b) => b.id !== undefined);
                return { results };
              }
              return { results: [] };
            },
            run: async () => {
              if (q.startsWith('INSERT INTO users')) {
                const [id, email] = params as [string, string, ...unknown[]];
                users.set(id, { id, email });
              } else if (q.startsWith('INSERT INTO sessions')) {
                const [h, uid, exp] = params as [string, string, number];
                sessions.set(h, { user_id: uid, expires_at: exp });
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
}

type Db = ReturnType<typeof makeDb>;
const ENV = (db: Db) => ({ DB: db as unknown as D1Database, DEV_LINKS: 'true' });

async function signIn(db: Db): Promise<{ cookie: string; userId: string }> {
  const env = ENV(db);
  const rl = await app.request(
    '/api/auth/request-link',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 's@example.com' }) },
    env,
  );
  const { devLink } = (await rl.json()) as { devLink: string };
  const token = new URL(devLink).searchParams.get('token') as string;
  const v = await app.request(`/api/auth/verify?token=${token}`, {}, env);
  const cookie = (v.headers.get('set-cookie') ?? '').split(';')[0];
  const me = (await (await app.request('/api/auth/me', { headers: { cookie } }, env)).json()) as { user: { id: string } };
  return { cookie, userId: me.user.id };
}

const dayAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString();

describe('GET /api/me/activity', () => {
  it('requires a session', async () => {
    expect((await app.request('/api/me/activity')).status).toBe(401);
  });

  it('unions exam + reading days and counts the streak back from today', async () => {
    const db = makeDb();
    const { cookie, userId } = await signIn(db);
    db.seedExam(userId, dayAgo(0));
    db.seedExam(userId, dayAgo(1));
    db.seedSync('book-x', 1, userId, dayAgo(3));
    db.seedExam('someone-else', dayAgo(0));
    const res = await app.request('/api/me/activity', { headers: { cookie } }, ENV(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { days: string[]; streak: number; totalDays: number; finished: unknown[] };
    expect(body.totalDays).toBe(3);
    expect(body.days).toEqual([...body.days].sort());
    // Today + yesterday active, day before yesterday quiet: streak is 2.
    expect(body.streak).toBe(2);
    expect(body.finished).toEqual([]);
  });

  it('shelves only books the user left on the final page', async () => {
    const db = makeDb();
    const { cookie, userId } = await signIn(db);
    db.seedBook('done', 'Done Book', 2);
    db.seedBook('open', 'Open Book', 3);
    db.seedBook('theirs', 'Their Book', 2);
    db.seedSync('done', 2, userId, dayAgo(0));
    db.seedSync('open', 1, userId, dayAgo(0));
    db.seedSync('theirs', 2, 'someone-else', dayAgo(0));
    const res = await app.request('/api/me/activity', { headers: { cookie } }, ENV(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { finished: { id: string; title: string }[] };
    expect(body.finished).toEqual([{ id: 'done', title: 'Done Book', cover_url: null }]);
  });
});
