import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import app from './index';

function makeLibraryDb() {
  const books = new Map<string, { id: string; title: string; level: string; cover_url: string | null; published_at: string }>([
    ['a1-1', { id: 'a1-1', title: 'A1 Book 1', level: 'A1', cover_url: null, published_at: '2026-01-01' }],
    ['a1-2', { id: 'a1-2', title: 'A1 Book 2', level: 'A1', cover_url: null, published_at: '2026-01-02' }],
  ]);
  return {
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, ' ').trim();
      const first = async (params: unknown[]) => {
        if (q.startsWith('SELECT id FROM books WHERE id = ?')) {
          return books.get(params[0] as string) ? { id: params[0] } : null;
        }
        if (q.startsWith('SELECT id, title, level, cover_url FROM books WHERE id = ?')) {
          return books.get(params[0] as string) ?? null;
        }
        if (q.startsWith('SELECT id, title, level, tags_json, cover_url, published_at FROM books WHERE id = ?')) {
          return books.get(params[0] as string) ?? null;
        }
        return null;
      };
      const all = async (params: unknown[]) => {
        if (q.startsWith('SELECT id FROM books WHERE level = ? ORDER BY published_at DESC')) {
          return {
            results: [...books.values()]
              .filter((b) => b.level === params[0])
              .sort((a, b) => (a.published_at < b.published_at ? 1 : -1))
              .map((b) => ({ id: b.id })),
          };
        }
        return { results: [] };
      };
      return {
        bind: (...params: unknown[]) => ({ first: () => first(params), all: () => all(params) }),
        first: () => first([]),
      };
    },
  };
}

function makeAppDb() {
  const users = new Map<string, { id: string; email: string; role: string }>();
  const sessions = new Map<string, { user_id: string; expires_at: number }>();
  const classes = new Map<string, Record<string, unknown>>();
  const enrollment = new Map<string, string>();
  const curriculum = new Map<string, { book_id: string; position: number }[]>();
  const shelf = new Map<string, string>();
  const words = new Map<string, { word: string; position: number }[]>();
  return {
    users,
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, ' ').trim();
      const first = async (params: unknown[]) => {
        if (q.startsWith('SELECT id FROM users WHERE email')) {
          const found = [...users.values()].find((u) => u.email === params[0]);
          return found ? { id: found.id } : null;
        }
        if (q.startsWith('SELECT id, role FROM users WHERE email')) {
          const found = [...users.values()].find((u) => u.email === params[0]);
          return found ? { id: found.id, role: found.role } : null;
        }
        if (q.startsWith('SELECT user_id, expires_at FROM sessions')) {
          return sessions.get(params[0] as string) ?? null;
        }
        if (q.startsWith('SELECT users.id, users.email, users.role')) {
          const session = sessions.get(params[0] as string);
          const user = session ? users.get(session.user_id) : undefined;
          return user
            ? { id: user.id, email: user.email, role: user.role, expires_at: session!.expires_at }
            : null;
        }
        if (q.startsWith('SELECT * FROM classes WHERE id = ? AND teacher_id = ?')) {
          const cls = classes.get(params[0] as string);
          return cls && cls.teacher_id === params[1] ? cls : null;
        }
        if (q.startsWith('SELECT * FROM classes WHERE id = ?')) {
          return classes.get(params[0] as string) ?? null;
        }
        return null;
      };
      const all = async (params: unknown[]) => {
        if (q.includes('JOIN class_students') && q.includes('FROM classes')) {
          return {
            results: [...classes.values()]
              .filter((cls) => enrollment.has(`${cls.id}|${params[0]}`))
              .map((cls) => ({ id: cls.id, name: cls.name, level: cls.level })),
          };
        }
        if (q.startsWith('SELECT book_id, position FROM class_books')) {
          return { results: [...(curriculum.get(params[0] as string) ?? [])] };
        }
        if (q.startsWith('SELECT word FROM class_words')) {
          return {
            results: [...(words.get(params[0] as string) ?? [])].sort((a, b) => a.position - b.position),
          };
        }
        if (q.startsWith('SELECT book_id, added_at FROM library_shelf')) {
          return {
            results: [...shelf.entries()]
              .filter(([k]) => k.startsWith(`${params[0]}|`))
              .map(([k, addedAt]) => ({ book_id: k.split('|')[1], added_at: addedAt })),
          };
        }
        return { results: [] };
      };
      const run = async (params: unknown[]) => {
        if (q.startsWith('INSERT INTO users')) {
          const [id, email, , role] = params as [string, string, string, string, string];
          users.set(id, { id, email, role });
        } else if (q.startsWith('INSERT INTO sessions')) {
          const [idHash, userId, expiresAt] = params as [string, string, number];
          sessions.set(idHash, { user_id: userId, expires_at: expiresAt });
        } else if (q.startsWith('DELETE FROM sessions WHERE user_id')) {
          for (const [key, value] of sessions) {
            if (value.user_id === params[0] && value.expires_at < (params[1] as number)) sessions.delete(key);
          }
        } else if (q.startsWith('DELETE FROM sessions WHERE id_hash')) {
          sessions.delete(params[0] as string);
        } else if (q.startsWith('INSERT INTO classes')) {
          const [id, teacher_id, name, level, created_at, updated_at] = params as string[];
          classes.set(id, { id, teacher_id, name, level, created_at, updated_at });
        } else if (q.startsWith('INSERT INTO class_students')) {
          enrollment.set(`${params[0]}|${params[1]}`, params[2] as string);
        } else if (q.startsWith('DELETE FROM class_books')) {
          curriculum.set(params[0] as string, []);
        } else if (q.startsWith('INSERT INTO class_books')) {
          const list = curriculum.get(params[0] as string) ?? [];
          list.push({ book_id: params[1] as string, position: params[2] as number });
          curriculum.set(params[0] as string, list);
        } else if (q.startsWith('DELETE FROM class_words')) {
          words.set(params[0] as string, []);
        } else if (q.startsWith('INSERT INTO class_words')) {
          const list = words.get(params[0] as string) ?? [];
          list.push({ word: params[1] as string, position: params[2] as number });
          words.set(params[0] as string, list);
        } else if (q.startsWith('INSERT OR IGNORE INTO library_shelf')) {
          shelf.set(`${params[0]}|${params[1]}`, params[2] as string);
        } else if (q.startsWith('DELETE FROM library_shelf')) {
          shelf.delete(`${params[0]}|${params[1]}`);
        }
        return { success: true };
      };
      return {
        bind: (...params: unknown[]) => ({ first: () => first(params), run: () => run(params), all: () => all(params) }),
        first: () => first([]),
      };
    },
  };
}

type AppDb = ReturnType<typeof makeAppDb>;
type LibraryDb = ReturnType<typeof makeLibraryDb>;
const ENV = (db: AppDb, libraryDb: LibraryDb) => ({
  DB: db as unknown as D1Database,
  LIBRARY_DB: libraryDb as unknown as D1Database,
  DEV_LINKS: 'true',
});

async function signIn(db: AppDb, libraryDb: LibraryDb, email: string): Promise<string> {
  const env = ENV(db, libraryDb);
  const requested = await app.request(
    '/api/auth/request-link',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) },
    env,
  );
  const { devLink } = (await requested.json()) as { devLink: string };
  const token = new URL(devLink).searchParams.get('token') as string;
  const verified = await app.request(`/api/auth/verify?token=${token}`, {}, env);
  return (verified.headers.get('set-cookie') ?? '').split(';')[0];
}

const json = (method: string, body: unknown, cookie?: string) => ({
  method,
  headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body),
});

describe('student classes and shelf', () => {
  it('shows enrolled classes with curriculum and hides the rest', async () => {
    const db = makeAppDb();
    const libraryDb = makeLibraryDb();
    db.users.set('teacher-1', { id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' });
    db.users.set('student-1', { id: 'student-1', email: 'student@example.com', role: 'student' });
    db.users.set('student-2', { id: 'student-2', email: 'other@example.com', role: 'student' });
    const teacher = await signIn(db, libraryDb, 'teacher@example.com');
    const created = await app.request('/api/classes', json('POST', { name: 'Grade 2', level: 'A1' }, teacher), ENV(db, libraryDb));
    const { cls } = (await created.json()) as { cls: { id: string } };
    await app.request(`/api/classes/${cls.id}/students`, json('POST', { email: 'student@example.com' }, teacher), ENV(db, libraryDb));

    const student = await signIn(db, libraryDb, 'student@example.com');
    const mine = (await (await app.request('/api/me/classes', { headers: { cookie: student } }, ENV(db, libraryDb))).json()) as {
      classes: { name: string; books: { title: string }[]; words: string[] }[];
    };
    expect(mine.classes).toHaveLength(1);
    expect(mine.classes[0].books.map((b) => b.title)).toEqual(['A1 Book 2', 'A1 Book 1']);
    expect(mine.classes[0].words).toHaveLength(12);

    const other = await signIn(db, libraryDb, 'other@example.com');
    const theirs = (await (await app.request('/api/me/classes', { headers: { cookie: other } }, ENV(db, libraryDb))).json()) as {
      classes: unknown[];
    };
    expect(theirs.classes).toHaveLength(0);
  });

  it('saves, lists, and removes shelf books per student', async () => {
    const db = makeAppDb();
    const libraryDb = makeLibraryDb();
    db.users.set('student-1', { id: 'student-1', email: 'student@example.com', role: 'student' });
    db.users.set('student-2', { id: 'student-2', email: 'other@example.com', role: 'student' });
    const student = await signIn(db, libraryDb, 'student@example.com');
    const other = await signIn(db, libraryDb, 'other@example.com');

    expect((await app.request('/api/me/shelf', json('POST', { bookId: 'missing' }, student), ENV(db, libraryDb))).status).toBe(404);
    expect((await app.request('/api/me/shelf', json('POST', { bookId: 'a1-1' }, student), ENV(db, libraryDb))).status).toBe(200);
    expect((await app.request('/api/me/shelf', json('POST', { bookId: 'a1-1' }, student), ENV(db, libraryDb))).status).toBe(200);
    const shelf = (await (await app.request('/api/me/shelf', { headers: { cookie: student } }, ENV(db, libraryDb))).json()) as {
      books: { id: string }[];
    };
    expect(shelf.books.map((b) => b.id)).toEqual(['a1-1']);
    const theirs = (await (await app.request('/api/me/shelf', { headers: { cookie: other } }, ENV(db, libraryDb))).json()) as {
      books: unknown[];
    };
    expect(theirs.books).toHaveLength(0);

    expect((await app.request('/api/me/shelf/a1-1', { method: 'DELETE', headers: { cookie: student } }, ENV(db, libraryDb))).status).toBe(200);
    const empty = (await (await app.request('/api/me/shelf', { headers: { cookie: student } }, ENV(db, libraryDb))).json()) as {
      books: unknown[];
    };
    expect(empty.books).toHaveLength(0);
  });
});
