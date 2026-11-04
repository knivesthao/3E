import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { Bindings, Variables } from './types';
import { requireRole } from './roles';
import { LEVELS, isRecord } from './validate';
import { BANK_WORDS, EXAM_LEVELS } from './exam-banks';
import type { ExamLevel } from './exam-banks';

// Class management: one teacher owns each class; admins see everything.
// Curriculum entries reference published library books by id — D1 cannot
// join across databases, so book existence and level are checked here.
export const classes = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false });

const CURRICULUM_SIZE = 8;

// Flashcards per class curriculum. Auto-filled from the level's exam bank —
// those words are curated, level-appropriate, and already inside the level
// vocabulary by construction — so teachers start with a drillable set and
// edit from there. C-level classes reuse the B2 bank (no C banks yet).
const CURRICULUM_WORDS = 12;

export function autoWords(level: string): string[] {
  const tag = (EXAM_LEVELS as string[]).includes(level) ? (level as ExamLevel) : 'B2';
  const words = new Set<string>();
  for (const list of Object.values(BANK_WORDS[tag])) {
    for (const w of list) words.add(w);
  }
  return [...words].sort().slice(0, CURRICULUM_WORDS);
}

interface ClassRow {
  id: string;
  teacher_id: string;
  name: string;
  level: string;
  created_at: string;
  updated_at: string;
}

interface LibraryBookRow {
  id: string;
  title: string;
  level: string;
  tags_json: string | null;
  cover_url: string | null;
  published_at: string;
}

const NOT_FOUND = { error: 'not found' } as const;
const INVALID = { error: 'invalid request' } as const;

function isLevel(value: unknown): value is (typeof LEVELS)[number] {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
}

async function ownClass(db: D1Database, id: string, teacherId: string): Promise<ClassRow | null> {
  return db
    .prepare('SELECT * FROM classes WHERE id = ? AND teacher_id = ?')
    .bind(id, teacherId)
    .first<ClassRow>();
}

async function getClass(db: D1Database, id: string): Promise<ClassRow | null> {
  return db.prepare('SELECT * FROM classes WHERE id = ?').bind(id).first<ClassRow>();
}

async function libraryBook(db: D1Database, bookId: string): Promise<LibraryBookRow | null> {
  return db.prepare('SELECT id, title, level, tags_json, cover_url, published_at FROM books WHERE id = ?')
    .bind(bookId)
    .first<LibraryBookRow>();
}

// Newest published books at the class level. Teacher edits after creation.
async function autoCurriculum(libraryDb: D1Database, level: string): Promise<string[]> {
  const { results } = await libraryDb
    .prepare('SELECT id FROM books WHERE level = ? ORDER BY published_at DESC')
    .bind(level)
    .all<{ id: string }>();
  return (results ?? []).slice(0, CURRICULUM_SIZE).map((r) => r.id);
}

async function setCurriculum(db: D1Database, classId: string, bookIds: string[], now: string) {
  await db.prepare('DELETE FROM class_books WHERE class_id = ?').bind(classId).run();
  for (let i = 0; i < bookIds.length; i++) {
    await db
      .prepare('INSERT INTO class_books (class_id, book_id, position, added_at) VALUES (?, ?, ?, ?)')
      .bind(classId, bookIds[i], i + 1, now)
      .run();
  }
}

// Teachers manage their own classes; admins manage all of them.
classes.post('/', async (c) => {
  const denied = requireRole(c, ['teacher', 'admin']);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(INVALID, 400);
  }
  if (!isRecord(body) || typeof body.name !== 'string' || body.name.trim() === '' || body.name.length > 200) {
    return c.json(INVALID, 400);
  }
  if (!isLevel(body.level)) return c.json(INVALID, 400);

  const now = new Date().toISOString();
  const cls: ClassRow = {
    id: crypto.randomUUID(),
    teacher_id: c.get('userId'),
    name: body.name.trim(),
    level: body.level,
    created_at: now,
    updated_at: now,
  };
  await c.env.DB.prepare(
    'INSERT INTO classes (id, teacher_id, name, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(cls.id, cls.teacher_id, cls.name, cls.level, cls.created_at, cls.updated_at)
    .run();
  const bookIds = await autoCurriculum(c.env.LIBRARY_DB, cls.level);
  await setCurriculum(c.env.DB, cls.id, bookIds, now);
  return c.json({ cls, books: bookIds.map((book_id, i) => ({ book_id, position: i + 1 })) }, 201);
});

classes.get('/', async (c) => {
  const denied = requireRole(c, ['teacher', 'admin']);
  if (denied) return denied;
  const role = c.get('userRole');
  const { results } = role === 'admin'
    ? await c.env.DB.prepare(
        `SELECT classes.*, users.email AS teacher_email,
          (SELECT COUNT(*) FROM class_students WHERE class_id = classes.id) AS student_count,
          (SELECT COUNT(*) FROM class_books WHERE class_id = classes.id) AS book_count
         FROM classes JOIN users ON users.id = classes.teacher_id ORDER BY classes.updated_at DESC`,
      )
        .bind()
        .all<ClassRow & { teacher_email: string; student_count: number; book_count: number }>()
    : await c.env.DB.prepare(
        `SELECT classes.*,
          (SELECT COUNT(*) FROM class_students WHERE class_id = classes.id) AS student_count,
          (SELECT COUNT(*) FROM class_books WHERE class_id = classes.id) AS book_count
         FROM classes WHERE teacher_id = ? ORDER BY updated_at DESC`,
      )
        .bind(c.get('userId'))
        .all<ClassRow & { student_count: number; book_count: number }>();
  return c.json({ classes: results ?? [] });
});

classes.get('/:id', async (c) => {
  const denied = requireRole(c, ['teacher', 'admin']);
  if (denied) return denied;
  const role = c.get('userRole');
  const cls = role === 'admin'
    ? await getClass(c.env.DB, c.req.param('id'))
    : await ownClass(c.env.DB, c.req.param('id'), c.get('userId'));
  if (!cls) return c.json(NOT_FOUND, 404);
  const [students, books] = await Promise.all([
    c.env.DB.prepare(
      `SELECT users.id, users.email, class_students.added_at FROM class_students
       JOIN users ON users.id = class_students.user_id WHERE class_id = ? ORDER BY users.email ASC`,
    )
      .bind(cls.id)
      .all<{ id: string; email: string; added_at: string }>(),
    c.env.DB.prepare('SELECT book_id, position FROM class_books WHERE class_id = ? ORDER BY position ASC')
      .bind(cls.id)
      .all<{ book_id: string; position: number }>(),
  ]);
  const detailed = [];
  for (const b of books.results ?? []) {
    const book = await libraryBook(c.env.LIBRARY_DB, b.book_id);
    if (book) detailed.push({ ...b, title: book.title, level: book.level, cover_url: book.cover_url });
  }
  return c.json({ cls, students: students.results ?? [], books: detailed });
});

classes.patch('/:id', async (c) => {
  const denied = requireRole(c, ['teacher', 'admin']);
  if (denied) return denied;
  const role = c.get('userRole');
  const cls = role === 'admin'
    ? await getClass(c.env.DB, c.req.param('id'))
    : await ownClass(c.env.DB, c.req.param('id'), c.get('userId'));
  if (!cls) return c.json(NOT_FOUND, 404);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(INVALID, 400);
  }
  if (!isRecord(body) || typeof body.name !== 'string' || body.name.trim() === '' || body.name.length > 200) {
    return c.json(INVALID, 400);
  }
  const now = new Date().toISOString();
  await c.env.DB.prepare('UPDATE classes SET name = ?, updated_at = ? WHERE id = ?')
    .bind(body.name.trim(), now, cls.id)
    .run();
  return c.json({ cls: { ...cls, name: body.name.trim(), updated_at: now } });
});

classes.post('/:id/students', async (c) => {
  const denied = requireRole(c, ['teacher', 'admin']);
  if (denied) return denied;
  const role = c.get('userRole');
  const cls = role === 'admin'
    ? await getClass(c.env.DB, c.req.param('id'))
    : await ownClass(c.env.DB, c.req.param('id'), c.get('userId'));
  if (!cls) return c.json(NOT_FOUND, 404);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(INVALID, 400);
  }
  const email =
    isRecord(body) && typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email === '') return c.json(INVALID, 400);
  const user = await c.env.DB.prepare('SELECT id, role FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; role: string }>();
  if (!user || user.role !== 'student') return c.json(NOT_FOUND, 404);
  try {
    await c.env.DB.prepare('INSERT INTO class_students (class_id, user_id, added_at) VALUES (?, ?, ?)')
      .bind(cls.id, user.id, new Date().toISOString())
      .run();
  } catch {
    return c.json({ error: 'already enrolled' }, 409);
  }
  return c.json({ added: true, user_id: user.id }, 201);
});

classes.delete('/:id/students/:userId', async (c) => {
  const denied = requireRole(c, ['teacher', 'admin']);
  if (denied) return denied;
  const role = c.get('userRole');
  const cls = role === 'admin'
    ? await getClass(c.env.DB, c.req.param('id'))
    : await ownClass(c.env.DB, c.req.param('id'), c.get('userId'));
  if (!cls) return c.json(NOT_FOUND, 404);
  await c.env.DB.prepare('DELETE FROM class_students WHERE class_id = ? AND user_id = ?')
    .bind(cls.id, c.req.param('userId'))
    .run();
  return c.json({ ok: true as const });
});

// Teacher-edited curriculum: full ordered replacement, level-matched so the
// class guarantee survives manual edits.
classes.post('/:id/books', async (c) => {
  const denied = requireRole(c, ['teacher', 'admin']);
  if (denied) return denied;
  const role = c.get('userRole');
  const cls = role === 'admin'
    ? await getClass(c.env.DB, c.req.param('id'))
    : await ownClass(c.env.DB, c.req.param('id'), c.get('userId'));
  if (!cls) return c.json(NOT_FOUND, 404);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(INVALID, 400);
  }
  if (!isRecord(body) || !Array.isArray(body.bookIds) || body.bookIds.length === 0 || body.bookIds.length > 50) {
    return c.json(INVALID, 400);
  }
  const bookIds = body.bookIds.filter((b): b is string => typeof b === 'string' && b !== '');
  if (bookIds.length !== body.bookIds.length || new Set(bookIds).size !== bookIds.length) {
    return c.json(INVALID, 400);
  }
  for (const bookId of bookIds) {
    const book = await libraryBook(c.env.LIBRARY_DB, bookId);
    if (!book || book.level !== cls.level) return c.json(INVALID, 400);
  }
  await setCurriculum(c.env.DB, cls.id, bookIds, new Date().toISOString());
  return c.json({ books: bookIds.map((book_id, i) => ({ book_id, position: i + 1 })) });
});
