import { Hono } from 'hono';
import type { Bindings, Variables } from './types';
import { isRecord } from './validate';

// Student surfaces: enrolled classes with their curriculum, and the personal
// saved shelf. Book metadata lives in LIBRARY_DB, so rows are matched in
// code after the app-DB reads — the same pattern as finishedBooks.
export const student = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false });

const INVALID = { error: 'invalid request' } as const;
const NOT_FOUND = { error: 'not found' } as const;

interface CurriculumEntry {
  book_id: string;
  position: number;
  title: string;
  level: string;
  cover_url: string | null;
}

async function wordsFor(db: Bindings['DB'], classId: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT word FROM class_words WHERE class_id = ? ORDER BY position ASC')
    .bind(classId)
    .all<{ word: string }>();
  return (results ?? []).map((r) => r.word);
}

async function curriculumFor(
  libraryDb: Bindings['LIBRARY_DB'],
  classId: string,
  db: Bindings['DB'],
): Promise<CurriculumEntry[]> {
  const { results } = await db
    .prepare('SELECT book_id, position FROM class_books WHERE class_id = ? ORDER BY position ASC')
    .bind(classId)
    .all<{ book_id: string; position: number }>();
  const entries: CurriculumEntry[] = [];
  for (const row of results ?? []) {
    const book = await libraryDb
      .prepare('SELECT id, title, level, cover_url FROM books WHERE id = ?')
      .bind(row.book_id)
      .first<{ id: string; title: string; level: string; cover_url: string | null }>();
    if (book) entries.push({ book_id: row.book_id, position: row.position, title: book.title, level: book.level, cover_url: book.cover_url });
  }
  return entries;
}

student.get('/classes', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT classes.id, classes.name, classes.level FROM classes
     JOIN class_students ON class_students.class_id = classes.id
     WHERE class_students.user_id = ? ORDER BY classes.name ASC`,
  )
    .bind(c.get('userId'))
    .all<{ id: string; name: string; level: string }>();
  const classes = [];
  for (const cls of results ?? []) {
    classes.push({
      ...cls,
      books: await curriculumFor(c.env.LIBRARY_DB, cls.id, c.env.DB),
      words: await wordsFor(c.env.DB, cls.id),
    });
  }
  return c.json({ classes });
});

student.get('/shelf', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT book_id, added_at FROM library_shelf WHERE user_id = ? ORDER BY added_at DESC')
    .bind(c.get('userId'))
    .all<{ book_id: string; added_at: string }>();
  const books = [];
  for (const row of results ?? []) {
    const book = await c.env.LIBRARY_DB.prepare('SELECT id, title, level, cover_url FROM books WHERE id = ?')
      .bind(row.book_id)
      .first<{ id: string; title: string; level: string; cover_url: string | null }>();
    if (book) books.push({ ...book, added_at: row.added_at });
  }
  return c.json({ books });
});

student.post('/shelf', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(INVALID, 400);
  }
  const bookId = isRecord(body) && typeof body.bookId === 'string' ? body.bookId : '';
  if (bookId === '') return c.json(INVALID, 400);
  const book = await c.env.LIBRARY_DB.prepare('SELECT id FROM books WHERE id = ?')
    .bind(bookId)
    .first<{ id: string }>();
  if (!book) return c.json(NOT_FOUND, 404);
  await c.env.DB.prepare('INSERT OR IGNORE INTO library_shelf (user_id, book_id, added_at) VALUES (?, ?, ?)')
    .bind(c.get('userId'), bookId, new Date().toISOString())
    .run();
  return c.json({ saved: true as const });
});

student.delete('/shelf/:bookId', async (c) => {
  await c.env.DB.prepare('DELETE FROM library_shelf WHERE user_id = ? AND book_id = ?')
    .bind(c.get('userId'), c.req.param('bookId'))
    .run();
  return c.json({ ok: true as const });
});
