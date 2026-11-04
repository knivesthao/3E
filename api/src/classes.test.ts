import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import app from './index';

function makeLibraryDb() {
  const books = new Map<string, { id: string; title: string; level: string; cover_url: string | null; published_at: string }>();
  return {
    books,
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, ' ').trim();
      const first = async (params: unknown[]) => {
        if (q.startsWith('SELECT id, title, level, tags_json, cover_url, published_at FROM books WHERE id = ?')) {
          return books.get(params[0] as string) ?? null;
        }
        if (q.startsWith('SELECT id, title, level, cover_url, published_at FROM books WHERE id = ?')) {
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
        if (q.includes('FROM classes JOIN users')) {
          return {
            results: [...classes.values()].map((cls) => ({
              ...cls,
              teacher_email: users.get(cls.teacher_id as string)?.email ?? '',
              student_count: [...enrollment.keys()].filter((k) => k.startsWith(`${cls.id}|`)).length,
              book_count: (curriculum.get(cls.id as string) ?? []).length,
            })),
          };
        }
        if (q.startsWith('SELECT classes.*,') && q.includes('FROM classes WHERE teacher_id = ?')) {
          return {
            results: [...classes.values()]
              .filter((cls) => cls.teacher_id === params[0])
              .map((cls) => ({
                ...cls,
                student_count: [...enrollment.keys()].filter((k) => k.startsWith(`${cls.id}|`)).length,
                book_count: (curriculum.get(cls.id as string) ?? []).length,
              })),
          };
        }
        if (q.includes('FROM class_students') && q.includes('JOIN users')) {
          const classId = params[0] as string;
          return {
            results: [...enrollment.entries()]
              .filter(([k]) => k.startsWith(`${classId}|`))
              .map(([k, addedAt]) => {
                const user = users.get(k.split('|')[1])!;
                return { id: user.id, email: user.email, added_at: addedAt };
              })
              .sort((a, b) => (a.email < b.email ? -1 : 1)),
          };
        }
        if (q.startsWith('SELECT book_id, position FROM class_books')) {
          return {
            results: [...(curriculum.get(params[0] as string) ?? [])].sort((a, b) => a.position - b.position),
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
        } else if (q.startsWith('UPDATE classes SET name')) {
          const cls = classes.get(params[2] as string);
          if (cls) Object.assign(cls, { name: params[0], updated_at: params[1] });
        } else if (q.startsWith('INSERT INTO class_students')) {
          const key = `${params[0]}|${params[1]}`;
          if (enrollment.has(key)) throw new Error('UNIQUE constraint failed: class_students');
          enrollment.set(key, params[2] as string);
        } else if (q.startsWith('DELETE FROM class_students')) {
          enrollment.delete(`${params[0]}|${params[1]}`);
        } else if (q.startsWith('DELETE FROM class_books')) {
          curriculum.set(params[0] as string, []);
        } else if (q.startsWith('INSERT INTO class_books')) {
          const list = curriculum.get(params[0] as string) ?? [];
          list.push({ book_id: params[1] as string, position: params[2] as number });
          curriculum.set(params[0] as string, list);
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

function seedUsers(db: AppDb) {
  db.users.set('admin-1', { id: 'admin-1', email: 'admin@example.com', role: 'admin' });
  db.users.set('teacher-1', { id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' });
  db.users.set('teacher-2', { id: 'teacher-2', email: 'other-teacher@example.com', role: 'teacher' });
  db.users.set('student-1', { id: 'student-1', email: 'student@example.com', role: 'student' });
  db.users.set('creator-1', { id: 'creator-1', email: 'creator@example.com', role: 'creator' });
}

function seedBooks(libraryDb: LibraryDb) {
  for (let i = 1; i <= 10; i++) {
    const id = `a1-${i}`;
    libraryDb.books.set(id, {
      id, title: `A1 Book ${i}`, level: 'A1', cover_url: null, published_at: `2026-01-${String(i).padStart(2, '0')}`,
    });
  }
  libraryDb.books.set('b1-1', { id: 'b1-1', title: 'B1 Book 1', level: 'B1', cover_url: null, published_at: '2026-02-01' });
}

const json = (method: string, body: unknown, cookie?: string) => ({
  method,
  headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body),
});

describe('class management', () => {
  it('denies students and strangers, allows teachers and admins', async () => {
    const db = makeAppDb();
    const libraryDb = makeLibraryDb();
    seedUsers(db);
    seedBooks(libraryDb);
    expect((await app.request('/api/classes', {}, ENV(db, libraryDb))).status).toBe(401);

    const student = await signIn(db, libraryDb, 'student@example.com');
    expect((await app.request('/api/classes', json('POST', { name: 'X', level: 'A1' }, student), ENV(db, libraryDb))).status).toBe(403);
    expect((await app.request('/api/classes', { headers: { cookie: student } }, ENV(db, libraryDb))).status).toBe(403);
  });

  it('creates a class with an auto-generated level-matched curriculum', async () => {
    const db = makeAppDb();
    const libraryDb = makeLibraryDb();
    seedUsers(db);
    seedBooks(libraryDb);
    const teacher = await signIn(db, libraryDb, 'teacher@example.com');
    const created = await app.request('/api/classes', json('POST', { name: 'Grade 2', level: 'A1' }, teacher), ENV(db, libraryDb));
    expect(created.status).toBe(201);
    const { cls, books } = (await created.json()) as { cls: { id: string }; books: { book_id: string; position: number }[] };
    expect(books).toHaveLength(8);
    expect(books.map((b) => b.book_id)).toEqual(['a1-10', 'a1-9', 'a1-8', 'a1-7', 'a1-6', 'a1-5', 'a1-4', 'a1-3']);
    expect(books.map((b) => b.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(cls.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('scopes class lists and details by ownership, except for admins', async () => {
    const db = makeAppDb();
    const libraryDb = makeLibraryDb();
    seedUsers(db);
    seedBooks(libraryDb);
    const teacher = await signIn(db, libraryDb, 'teacher@example.com');
    const other = await signIn(db, libraryDb, 'other-teacher@example.com');
    const admin = await signIn(db, libraryDb, 'admin@example.com');
    const created = await app.request('/api/classes', json('POST', { name: 'Grade 2', level: 'A1' }, teacher), ENV(db, libraryDb));
    const { cls } = (await created.json()) as { cls: { id: string } };

    const mine = (await (await app.request('/api/classes', { headers: { cookie: teacher } }, ENV(db, libraryDb))).json()) as { classes: unknown[] };
    expect(mine.classes).toHaveLength(1);
    const theirs = (await (await app.request('/api/classes', { headers: { cookie: other } }, ENV(db, libraryDb))).json()) as { classes: unknown[] };
    expect(theirs.classes).toHaveLength(0);
    const all = (await (await app.request('/api/classes', { headers: { cookie: admin } }, ENV(db, libraryDb))).json()) as {
      classes: { teacher_email: string }[];
    };
    expect(all.classes).toHaveLength(1);
    expect(all.classes[0].teacher_email).toBe('teacher@example.com');

    expect((await app.request(`/api/classes/${cls.id}`, { headers: { cookie: other } }, ENV(db, libraryDb))).status).toBe(404);
    const detail = await app.request(`/api/classes/${cls.id}`, { headers: { cookie: admin } }, ENV(db, libraryDb));
    expect(detail.status).toBe(200);
  });

  it('enrolls and removes students, rejecting non-students and duplicates', async () => {
    const db = makeAppDb();
    const libraryDb = makeLibraryDb();
    seedUsers(db);
    seedBooks(libraryDb);
    const teacher = await signIn(db, libraryDb, 'teacher@example.com');
    const created = await app.request('/api/classes', json('POST', { name: 'Grade 2', level: 'A1' }, teacher), ENV(db, libraryDb));
    const { cls } = (await created.json()) as { cls: { id: string } };

    const enrolled = await app.request(`/api/classes/${cls.id}/students`, json('POST', { email: 'student@example.com' }, teacher), ENV(db, libraryDb));
    expect(enrolled.status).toBe(201);
    const dup = await app.request(`/api/classes/${cls.id}/students`, json('POST', { email: 'student@example.com' }, teacher), ENV(db, libraryDb));
    expect(dup.status).toBe(409);
    expect((await app.request(`/api/classes/${cls.id}/students`, json('POST', { email: 'creator@example.com' }, teacher), ENV(db, libraryDb))).status).toBe(404);
    expect((await app.request(`/api/classes/${cls.id}/students`, json('POST', { email: 'ghost@example.com' }, teacher), ENV(db, libraryDb))).status).toBe(404);

    const detail = (await (await app.request(`/api/classes/${cls.id}`, { headers: { cookie: teacher } }, ENV(db, libraryDb))).json()) as {
      students: { email: string }[];
    };
    expect(detail.students.map((s) => s.email)).toEqual(['student@example.com']);
    const removed = await app.request(`/api/classes/${cls.id}/students/student-1`, { method: 'DELETE', headers: { cookie: teacher } }, ENV(db, libraryDb));
    expect(removed.status).toBe(200);
  });

  it('replaces curriculum only with unique level-matched books', async () => {
    const db = makeAppDb();
    const libraryDb = makeLibraryDb();
    seedUsers(db);
    seedBooks(libraryDb);
    const teacher = await signIn(db, libraryDb, 'teacher@example.com');
    const created = await app.request('/api/classes', json('POST', { name: 'Grade 2', level: 'A1' }, teacher), ENV(db, libraryDb));
    const { cls } = (await created.json()) as { cls: { id: string } };

    for (const payload of [{ bookIds: [] }, { bookIds: ['a1-1', 'a1-1'] }, { bookIds: ['missing'] }, { bookIds: ['b1-1'] }]) {
      expect((await app.request(`/api/classes/${cls.id}/books`, json('POST', payload, teacher), ENV(db, libraryDb))).status).toBe(400);
    }
    const replaced = await app.request(`/api/classes/${cls.id}/books`, json('POST', { bookIds: ['a1-2', 'a1-1'] }, teacher), ENV(db, libraryDb));
    expect(replaced.status).toBe(200);
    const detail = (await (await app.request(`/api/classes/${cls.id}`, { headers: { cookie: teacher } }, ENV(db, libraryDb))).json()) as {
      books: { book_id: string; position: number; title: string }[];
    };
    expect(detail.books).toEqual([
      { book_id: 'a1-2', position: 1, title: 'A1 Book 2', level: 'A1', cover_url: null },
      { book_id: 'a1-1', position: 2, title: 'A1 Book 1', level: 'A1', cover_url: null },
    ]);
  });
});
