import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import app from './index';

// Defined-words map: the Reader's tap gate. Public like the book itself;
// reachability is the gate. one cheap D1 read per book-open, never cached.
function makeLibraryDb(bookIds: string[], wordRows: { book_id: string; word: string; defined: number }[]) {
  return {
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, ' ').trim();
      return {
        bind(...params: unknown[]) {
          return {
            first: async () => {
              if (q.startsWith('SELECT id FROM books WHERE id = ?')) {
                return bookIds.includes(params[0] as string) ? { id: params[0] } : null;
              }
              return null;
            },
            all: async () => {
              if (q.startsWith('SELECT word FROM book_words WHERE book_id = ? AND defined = 1')) {
                return {
                  results: wordRows
                    .filter((r) => r.book_id === params[0] && r.defined === 1)
                    .map((r) => ({ word: r.word })),
                };
              }
              return { results: [] };
            },
            run: async () => ({ success: true }),
          };
        },
      };
    },
  };
}

const ENV = (bookIds: string[], wordRows: { book_id: string; word: string; defined: number }[]) => ({
  DB: {} as D1Database,
  LIBRARY_DB: makeLibraryDb(bookIds, wordRows) as unknown as D1Database,
});

describe('share book words', () => {
  it('returns the defined words for a published book', async () => {
    const env = ENV(['b1'], [
      { book_id: 'b1', word: 'cat', defined: 1 },
      { book_id: 'b1', word: 'sun', defined: 1 },
      { book_id: 'b1', word: 'xyzzy', defined: 0 },
      { book_id: 'b2', word: 'cat', defined: 1 },
    ]);
    const res = await app.request('/api/share/b1/words', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ words: ['cat', 'sun'] });
  });

  it('404s unknown books', async () => {
    const res = await app.request('/api/share/nope/words', {}, ENV([], []));
    expect(res.status).toBe(404);
  });

  it('returns an empty list when nothing is defined yet', async () => {
    const env = ENV(['b1'], [{ book_id: 'b1', word: 'xyzzy', defined: 0 }]);
    const res = await app.request('/api/share/b1/words', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ words: [] });
  });
});
