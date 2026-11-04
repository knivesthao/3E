import { afterEach, describe, expect, it } from 'vitest';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import app from './index';
import { CONSECUTIVE_FAIL_LIMIT } from './ai/config';
import { makeBucket, type TestBucket } from './test-utils';

// In-memory D1 subset for the publish route (projects/scenes/panels seeded
// directly, books + jobs + ai_usage tracked). Model calls stubbed at fetch.
function makeDb() {
  const users = new Map<string, { id: string; email: string }>();
  const sessions = new Map<string, { user_id: string; expires_at: number }>();
  const projects = new Map<string, Record<string, unknown>>();
  const scenes = new Map<string, Record<string, unknown>>();
  const panels: Record<string, unknown>[] = [];
  const books = new Map<string, Record<string, unknown>>();
  const usage: Record<string, unknown>[] = [];
  const jobs = new Map<string, Record<string, unknown>>();
  const defs = new Map<string, Record<string, unknown>>();
  const wordRows: Record<string, unknown>[] = [];

  const db = {
    usage,
    jobs,
    books,
    projects,
    scenes,
    defs,
    wordRows,
    seedProject(row: Record<string, unknown>) {
      projects.set(row.id as string, row);
    },
    seedScene(projectId: string, sceneNumber: number, data: unknown) {
      const id = crypto.randomUUID();
      scenes.set(id, { id, project_id: projectId, scene_number: sceneNumber, data_json: JSON.stringify(data), updated_at: new Date().toISOString() });
    },
    seedPanel(projectId: string, sceneNumber: number, imageKey: string, maskKey: string) {
      panels.push({ id: crypto.randomUUID(), project_id: projectId, scene_number: sceneNumber, image_key: imageKey, mask_key: maskKey, created_at: new Date().toISOString() });
    },
    seedFailures(userId: string, n: number) {
      for (let i = 0; i < n; i++) {
        usage.push({ user_id: userId, task: 'safety', created_at: new Date(Date.now() + i).toISOString(), attempt: 1, ok: 0 });
      }
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
              if (q.startsWith('SELECT * FROM projects WHERE id = ? AND creator_id')) {
                const r = projects.get(params[0] as string);
                return r && r.creator_id === params[1] ? r : null;
              }
              if (q.startsWith('SELECT COUNT(*) AS n FROM ai_usage')) {
                const today = new Date().toISOString().slice(0, 10);
                const n = usage.filter(
                  (u) => u.user_id === params[0] && (u.created_at as string).slice(0, 10) === today,
                ).length;
                return { n };
              }
              return null;
            },
            all: async () => {
              if (q.startsWith('SELECT ok FROM ai_usage WHERE user_id')) {
                // Streak check: insertion order is chronological in the double.
                const rows = usage
                  .filter((u) => u.user_id === params[0])
                  .reverse()
                  .slice(0, CONSECUTIVE_FAIL_LIMIT)
                  .map((u) => ({ ok: u.ok }));
                return { results: rows };
              }
              if (q.startsWith('SELECT * FROM scenes WHERE project_id = ? ORDER BY')) {
                return {
                  results: [...scenes.values()]
                    .filter((x) => x.project_id === params[0])
                    .sort((a, b) => (a.scene_number as number) - (b.scene_number as number)),
                };
              }
              if (q.startsWith('SELECT scene_number, image_key, mask_key FROM panels WHERE project_id')) {
                return { results: panels.filter((x) => x.project_id === params[0]) };
              }
              if (q.startsWith('SELECT word FROM definitions WHERE level = ? AND word IN')) {
                const [level, ...words] = params as string[];
                const set = new Set(words);
                return {
                  results: [...defs.values()]
                    .filter((d) => d.level === level && set.has(d.word as string))
                    .map((d) => ({ word: d.word })),
                };
              }
              return { results: [] };
            },
            run: async () => {
              if (q.startsWith('INSERT INTO users')) {
                const [id, email] = params as string[];
                users.set(id, { id, email });
              } else if (q.startsWith('INSERT INTO sessions')) {
                const [h, uid, exp] = params as [string, string, number];
                sessions.set(h, { user_id: uid, expires_at: exp });
              } else if (q.startsWith('DELETE FROM sessions WHERE user_id')) {
                for (const [k, v] of sessions) {
                  if (v.user_id === params[0] && v.expires_at < (params[1] as number)) sessions.delete(k);
                }
              } else if (q.startsWith('DELETE FROM sessions WHERE id_hash')) {
                sessions.delete(params[0] as string);
              } else if (q.startsWith('INSERT INTO ai_usage')) {
                const [project_id, user_id, op_id, attempt, task, provider, model, kind, input_tokens, output_tokens, cost_usd, ms, ok, error, created_at] =
                  params as unknown[];
                usage.push({ project_id, user_id, op_id, attempt, task, provider, model, kind, input_tokens, output_tokens, cost_usd, ms, ok, error, created_at });
              } else if (q.startsWith('INSERT OR IGNORE INTO definitions')) {
                const [word, level, lang, gloss, source, verified, created_at] = params as unknown[];
                const k = `${word}|${level}|${lang}`;
                if (!defs.has(k)) defs.set(k, { word, level, lang, gloss, source, verified, created_at });
              } else if (q.startsWith('INSERT INTO jobs')) {
                const [id, user_id, project_id, payload, created_at, updated_at] = params as string[];
                jobs.set(id, { id, user_id, project_id, kind: 'package', payload, status: 'running', created_at, updated_at });
              } else if (q.startsWith('UPDATE jobs SET')) {
                const [status, result, error, updated_at, id] = params as [string, string | null, string | null, string, string];
                const row = jobs.get(id);
                if (row) Object.assign(row, { status, result, error, updated_at });
              } else if (q.startsWith("UPDATE projects SET status = 'published'")) {
                const [updated_at, id] = params as [string, string];
                const row = projects.get(id);
                if (row) Object.assign(row, { status: 'published', updated_at });
              } else if (q.startsWith('UPDATE projects SET title')) {
                const [title, description, level, purpose, cast_json, updated_at, id] = params as string[];
                const row = projects.get(id);
                if (row) Object.assign(row, { title, description, level, purpose, cast_json, updated_at });
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
  return db;
}

type Db = ReturnType<typeof makeDb>;

// Library-store stub (3e-books): owns ONLY the books table, sharing the
// same in-memory map so assertions can verify publish landed in the
// library and NOT in the app DB (whose stub answers null for books).
function makeLibraryDb(db: { books: Map<string, Record<string, unknown>>; wordRows: Record<string, unknown>[] }) {
  const books = db.books;
  const wordRows = db.wordRows;
  return {
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, ' ').trim();
      return {
        bind(...params: unknown[]) {
          return {
            first: async () => {
              if (q.startsWith('SELECT id, published_at FROM books WHERE project_id')) {
                const r = [...books.values()].find((x) => x.project_id === params[0]);
                return r ? { id: r.id, published_at: r.published_at } : null;
              }
              if (q.startsWith('SELECT * FROM books WHERE id = ?') || q.startsWith('SELECT id FROM books WHERE id = ?')) {
                return books.get(params[0] as string) ?? null;
              }
              return null;
            },
            all: async () => {
              if (q.startsWith('SELECT id, title, cover_url, manifest_json FROM books WHERE id IN')) {
                return { results: (params as string[]).map((id) => books.get(id)).filter((b) => b !== undefined) };
              }
              if (q.startsWith('SELECT id, title, level, tags_json, cover_url, published_at FROM books ORDER BY')) {
                return {
                  results: [...books.values()]
                    .map((b) => ({
                      id: b.id,
                      title: b.title,
                      level: b.level,
                      tags_json: (b.tags_json as string | undefined) ?? '[]',
                      cover_url: b.cover_url,
                      published_at: b.published_at,
                    }))
                    .sort((a, b) => ((a.published_at as string) < (b.published_at as string) ? 1 : -1)),
                };
              }
              return { results: [] };
            },
            run: async () => {
              if (q.startsWith('INSERT INTO books')) {
                const [id, project_id, creator_id, title, description, level, reading_level, tags_json, cover_url, manifest_json, published_at, updated_at] =
                  params as unknown[];
                books.set(id as string, { id, project_id, creator_id, title, description, level, reading_level, tags_json, cover_url, manifest_json, published_at, updated_at });
              } else if (q.startsWith('UPDATE books SET')) {
                const [title, description, level, reading_level, tags_json, cover_url, manifest_json, updated_at, id] = params as unknown[];
                const row = books.get(id as string);
                if (row) Object.assign(row, { title, description, level, reading_level, tags_json, cover_url, manifest_json, updated_at });
              } else if (q.startsWith('DELETE FROM book_words WHERE book_id = ? AND scene_number = ?')) {
                for (let i = wordRows.length - 1; i >= 0; i--) {
                  if (wordRows[i].book_id === params[0] && wordRows[i].scene_number === params[1]) wordRows.splice(i, 1);
                }
              } else if (q.startsWith('INSERT INTO book_words')) {
                const [id, book_id, scene_number, word, level, defined, updated_at] = params as unknown[];
                wordRows.push({ id, book_id, scene_number, word, level, defined, updated_at });
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
}

const ENV = (db: Db, withKey = true, r2?: { art?: TestBucket; library?: TestBucket }) => ({
  DB: db as unknown as D1Database,
  LIBRARY_DB: makeLibraryDb(db as unknown as { books: Map<string, Record<string, unknown>>; wordRows: Record<string, unknown>[] }) as unknown as D1Database,
  DEV_LINKS: 'true',
  ...(withKey ? { MODEL_API_KEY: 'test-key' } : {}),
  ...(r2?.art ? { ART: r2.art as unknown as R2Bucket } : {}),
  ...(r2?.library ? { LIBRARY_ART: r2.library as unknown as R2Bucket } : {}),
});

type Env = ReturnType<typeof ENV>;

async function signIn(db: Db): Promise<string> {
  const env = ENV(db);
  const rl = await app.request(
    '/api/auth/request-link',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'p@example.com' }) },
    env,
  );
  const { devLink } = (await rl.json()) as { devLink: string };
  const token = new URL(devLink).searchParams.get('token') as string;
  const v = await app.request(`/api/auth/verify?token=${token}`, {}, env);
  return (v.headers.get('set-cookie') ?? '').split(';')[0];
}

const realFetch = globalThis.fetch;

function stubSafety(verdict: string) {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: verdict } }],
        usage: { prompt_tokens: 50, completion_tokens: 1 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;
}

// Word pipeline: safety passes, every scene yields the same three words,
// every define returns one gloss. The book therefore maps 6 scenes x 3
// words and backfills all three glosses exactly once.
function stubWordPipeline() {
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse((init?.body ?? '{}') as string) as { messages?: { content: string }[] };
    const content = body.messages?.[0]?.content ?? '';
    let reply: string;
    if (content.includes('Answer with exactly one word')) reply = 'safe';
    else if (content.includes('List the important content words')) reply = JSON.stringify({ words: ['dog', 'cat', 'zebra'] });
    else if (content.includes('Define this English word')) reply = JSON.stringify({ meaning: 'a test animal' });
    else reply = 'safe';
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: reply } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;
}

async function userIdOf(cookie: string, env: Env): Promise<string> {
  const me = (await (
    await app.request('/api/auth/me', { headers: { cookie } }, env)
  ).json()) as { user: { id: string } };
  return me.user.id;
}

function seedBook(db: Db, creatorId: string, level = 'A1') {
  const pid = crypto.randomUUID();
  db.seedProject({
    id: pid,
    creator_id: creatorId,
    title: 'T',
    description: 'A test comic',
    level,
    purpose: 'learning',
    status: 'draft',
    cast_json: '{"characters":[{"name":"Noy"}],"places":[]}',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  // All words are A1-clean (Noy rides the cast exemption, like /finish drafts).
  db.seedScene(pid, 1, { narration: 'Noy sees a red dog.', bubbles: [{ speaker: 'Noy', text: 'Run!' }] });
  db.seedScene(pid, 2, { narration: 'A white cat drinks cold water.', bubbles: [] });
  db.seedScene(pid, 3, { narration: 'The sun is hot and big.', bubbles: [] });
  db.seedScene(pid, 4, { narration: 'A girl eats red food.', bubbles: [] });
  db.seedScene(pid, 5, { narration: 'A boy is happy in school.', bubbles: [] });
  db.seedScene(pid, 6, { narration: 'A dog and a cat go home.', bubbles: [] });
  return pid;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (method: string, body: unknown, cookie?: string) => ({
  method,
  headers: { ...(cookie ? { cookie } : {}), 'Content-Type': 'application/json' },
  body: body === null ? undefined : JSON.stringify(body),
});

interface BookBody {
  job: { id: string; status: string };
  book: {
    id: string;
    project_id: string;
    reading_level: string;
    cover_url: string | null;
    manifest_json: string;
    published_at: string;
    manifest: {
      version: number;
      title: string;
      level: string;
      reading_level: string;
      cover: string | null;
      scenes: { scene_number: number; image_url: string | null; mask_url: string | null }[];
    };
  };
}

describe('Publish endpoint', () => {
  it('screens safe, packages manifest v2, creates the book with cover', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const env = ENV(db);
    const uid = await userIdOf(cookie, env);
    const pid = seedBook(db, uid);
    db.seedPanel(pid, 1, `${pid}-1.png`, `${pid}-1-mask.png`);
    stubSafety('safe');

    const res = await app.request(`/api/projects/${pid}/publish`, json('POST', {}, cookie), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BookBody;
    expect(body.job.status).toBe('complete');
    expect(body.book.project_id).toBe(pid);
    expect(body.book.reading_level).toBe('beginner');
    expect(body.book.cover_url).toBe(`/api/ai/art/${pid}-1.png`);
    expect(body.book.manifest.version).toBe(2);
    expect(body.book.manifest.title).toBe('T');
    expect(body.book.manifest.scenes).toHaveLength(6);
    expect(body.book.manifest.scenes[0].image_url).toBe(`/api/ai/art/${pid}-1.png`);
    expect(body.book.manifest.scenes[0].mask_url).toBe(`/api/ai/art/${pid}-1-mask.png`);
    expect(body.book.manifest.scenes[1].image_url).toBeNull();
    expect(JSON.parse(body.book.manifest_json) as { version: number }).toEqual(body.book.manifest);

    expect(db.books.size).toBe(1);
    const proj = (await (
      await app.request(`/api/projects/${pid}`, { headers: { cookie } }, env)
    ).json()) as { project: { status: string } };
    expect(proj.project.status).toBe('published');

    const job = db.jobs.get(body.job.id);
    expect(job?.status).toBe('complete');
    const safety = db.usage.filter((u) => u.task === 'safety');
    expect(safety).toHaveLength(1);
    expect(safety[0].ok).toBe(1);
    expect(safety[0].model).toBe('muse-spark-1.3');
  });

  it('copies panel art into the library bucket on publish', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const art = makeBucket();
    const library = makeBucket();
    const env = ENV(db, true, { art, library });
    const uid = await userIdOf(cookie, env);
    const pid = seedBook(db, uid);
    db.seedPanel(pid, 1, `${pid}-1.png`, `${pid}-1-mask.png`);
    const bytes = new TextEncoder().encode('panel-bytes').buffer as ArrayBuffer;
    await art.put(`${pid}-1.png`, bytes, { httpMetadata: { contentType: 'image/png' } });
    await art.put(`${pid}-1-mask.png`, bytes, { httpMetadata: { contentType: 'image/png' } });
    stubSafety('safe');

    const res = await app.request(`/api/projects/${pid}/publish`, json('POST', {}, cookie), env);
    expect(res.status).toBe(200);
    expect(library.store.has(`${pid}-1.png`)).toBe(true);
    expect(library.store.has(`${pid}-1-mask.png`)).toBe(true);
  });

  it('publishes fine with no buckets (local dev skips the copy)', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const env = ENV(db);
    const uid = await userIdOf(cookie, env);
    const pid = seedBook(db, uid);
    db.seedPanel(pid, 1, `${pid}-1.png`, `${pid}-1-mask.png`);
    stubSafety('safe');

    const res = await app.request(`/api/projects/${pid}/publish`, json('POST', {}, cookie), env);
    expect(res.status).toBe(200);
    expect(db.books.size).toBe(1);
  });

  it('rejects partial drafts with 400 and no book', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const env = ENV(db);
    const uid = await userIdOf(cookie, env);
    const pid = seedBook(db, uid);
    // Drop scenes 3-6: a gate-rejected middle must never ship a short book.
    for (const [id, row] of [...db.scenes.entries()]) {
      if ((row as { scene_number: number }).scene_number > 2) db.scenes.delete(id);
    }
    stubSafety('safe');

    const res = await app.request(`/api/projects/${pid}/publish`, json('POST', {}, cookie), env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'incomplete draft', missing: [3, 4, 5, 6] });
    expect(db.books.size).toBe(0);
    const proj = (await (
      await app.request(`/api/projects/${pid}`, { headers: { cookie } }, env)
    ).json()) as { project: { status: string } };
    expect(proj.project.status).toBe('draft');
  });

  it('stores focus tags on publish, republish, and the catalog', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const env = ENV(db);
    const uid = await userIdOf(cookie, env);
    const pid = seedBook(db, uid);
    stubWordPipeline();

    const tagged = (t: unknown) => json('POST', { tags: t }, cookie);
    const res = await app.request(`/api/projects/${pid}/publish`, tagged(['nouns']), env);
    expect(res.status).toBe(200);
    const book = ((await res.json()) as { book: { tags: string[]; manifest: { tags: string[] } } }).book;
    expect(book.tags).toEqual(['nouns']);
    expect(book.manifest.tags).toEqual(['nouns']);

    const catalog = (await (await app.request('/api/share/books', {}, env)).json()) as {
      books: { tags: string[] }[];
    };
    expect(catalog.books).toHaveLength(1);
    expect(catalog.books[0].tags).toEqual(['nouns']);

    // Republish replaces the tag set; unknown tags never store.
    const res2 = await app.request(`/api/projects/${pid}/publish`, tagged(['verbs', 'adjectives']), env);
    expect(res2.status).toBe(200);
    expect(((await res2.json()) as { book: { tags: string[] } }).book.tags).toEqual(['verbs', 'adjectives']);
    const bad = await app.request(`/api/projects/${pid}/publish`, tagged(['nouns', 'pirates']), env);
    expect(bad.status).toBe(400);
    const kept = (await (await app.request('/api/share/books', {}, env)).json()) as {
      books: { tags: string[] }[];
    };
    expect(kept.books[0].tags).toEqual(['verbs', 'adjectives']);
  });

  it('blocks self-written pages above the book level', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const env = ENV(db);
    const uid = await userIdOf(cookie, env);
    const pid = seedBook(db, uid);
    for (const [, row] of [...db.scenes.entries()]) {
      if ((row as { scene_number: number }).scene_number === 3) {
        row.data_json = JSON.stringify({ narration: 'Photosynthesis baffles xenobiologists.', bubbles: [] });
      }
    }
    stubSafety('safe');

    const res = await app.request(`/api/projects/${pid}/publish`, json('POST', {}, cookie), env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; pages: { scene_number: number; unknown: string[] }[] };
    expect(body.error).toBe('level too high');
    expect(body.pages).toHaveLength(1);
    expect(body.pages[0].scene_number).toBe(3);
    expect(body.pages[0].unknown).toContain('photosynthesis');
    expect(db.books.size).toBe(0);

    const words = (await (
      await app.request(`/api/projects/${pid}/words`, { headers: { cookie } }, env)
    ).json()) as { flags: { scene_number: number }[]; unknown: { word: string; defined: boolean }[] };
    expect(words.flags.map((f) => f.scene_number)).toEqual([3]);
    expect(words.unknown.find((u) => u.word === 'photosynthesis')).toMatchObject({ defined: false });
  });

  it('syncs scene words and backfills missing glosses on publish', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const env = ENV(db);
    const uid = await userIdOf(cookie, env);
    const pid = seedBook(db, uid);
    stubWordPipeline();

    const res = await app.request(`/api/projects/${pid}/publish`, json('POST', {}, cookie), env);
    expect(res.status).toBe(200);
    const bookId = ((await res.json()) as { book: { id: string } }).book.id;

    expect(db.wordRows).toHaveLength(18);
    expect(new Set(db.wordRows.map((r) => r.word as string))).toEqual(new Set(['dog', 'cat', 'zebra']));
    expect(db.wordRows.every((r) => r.book_id === bookId && r.defined === 1)).toBe(true);
    expect(db.defs.size).toBe(3);
    expect(db.defs.get('dog|A1|en')).toMatchObject({ gloss: 'a test animal', verified: 0 });

    const words = (await (
      await app.request(`/api/projects/${pid}/words`, { headers: { cookie } }, env)
    ).json()) as { flags: unknown[]; unknown: { word: string; defined: boolean }[] };
    expect(words.flags).toEqual([]);
  });

  it('unsafe content blocks publish with 422 and no book', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const env = ENV(db);
    const uid = await userIdOf(cookie, env);
    const pid = seedBook(db, uid);
    stubSafety('unsafe');

    const res = await app.request(`/api/projects/${pid}/publish`, json('POST', {}, cookie), env);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'unsafe content' });
    expect(db.books.size).toBe(0);
    const failed = [...db.jobs.values()].find((j) => j.status === 'failed');
    expect(failed?.error).toBe('unsafe content');
    const proj = (await (
      await app.request(`/api/projects/${pid}`, { headers: { cookie } }, env)
    ).json()) as { project: { status: string } };
    expect(proj.project.status).toBe('draft');
  });

  it('rejects foreign projects, empty drafts, missing key, spent quota, anon users', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const env = ENV(db);
    const uid = await userIdOf(cookie, env);
    const pid = seedBook(db, uid);
    // A draft with no scenes at all.
    const pidEmpty = crypto.randomUUID();
    db.seedProject({
      id: pidEmpty,
      creator_id: uid,
      title: 'E',
      description: '',
      level: 'A1',
      purpose: 'learning',
      status: 'draft',
      cast_json: '{"characters":[],"places":[]}',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    stubSafety('safe');

    expect((await app.request(`/api/projects/missing/publish`, json('POST', {}, cookie), env)).status).toBe(404);
    expect((await app.request(`/api/projects/${pidEmpty}/publish`, json('POST', {}, cookie), env)).status).toBe(
      400,
    );
    expect(
      (await app.request(`/api/projects/${pid}/publish`, json('POST', {}, cookie), ENV(db, false))).status,
    ).toBe(503);
    expect((await app.request(`/api/projects/${pid}/publish`, json('POST', {}), env)).status).toBe(401);
    db.seedFailures(uid, 10);
    expect((await app.request(`/api/projects/${pid}/publish`, json('POST', {}, cookie), env)).status).toBe(429);
  });

  it('republish updates the same book row and keeps published_at', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const env = ENV(db);
    const uid = await userIdOf(cookie, env);
    const pid = seedBook(db, uid);
    stubWordPipeline();

    const first = (await (
      await app.request(`/api/projects/${pid}/publish`, json('POST', {}, cookie), env)
    ).json()) as BookBody;
    await app.request(
      `/api/projects/${pid}`,
      json('PATCH', { title: 'T2' }, cookie),
      env,
    );
    const second = (await (
      await app.request(`/api/projects/${pid}/publish`, json('POST', {}, cookie), env)
    ).json()) as BookBody;

    expect(second.book.id).toBe(first.book.id);
    expect(db.books.size).toBe(1);
    expect(second.book.manifest.title).toBe('T2');
    expect(second.book.published_at).toBe(first.book.published_at);
  });

  it('catalog lists published books newest-first without auth or manifest', async () => {
    const db = makeDb();
    const cookie = await signIn(db);
    const env = ENV(db);
    const uid = await userIdOf(cookie, env);
    const pid = seedBook(db, uid);
    stubSafety('safe');

    // Empty catalog before anything is published.
    expect(((await (await app.request('/api/share/books', {}, env)).json()) as { books: unknown[] }).books).toEqual(
      [],
    );

    await app.request(`/api/projects/${pid}/publish`, json('POST', {}, cookie), env);
    const catalog = (await (await app.request('/api/share/books', {}, env)).json()) as {
      books: { id: string; title: string; level: string; cover_url: string | null; published_at: string }[];
    };
    expect(catalog.books).toHaveLength(1);
    expect(catalog.books[0].title).toBe('T');
    expect(catalog.books[0].level).toBe('A1');
    expect(catalog.books[0]).not.toHaveProperty('manifest_json');
    expect(catalog.books[0]).not.toHaveProperty('manifest');
  });

  it('serves catalog + manifest from edge cache and busts both on publish', async () => {
    const store = new Map<string, Response>();
    const key = (r: Request | string) => (typeof r === 'string' ? r : r.url);
    (globalThis as { caches?: unknown }).caches = {
      default: {
        match: async (r: Request) => (store.get(key(r))?.clone() ?? undefined),
        put: async (r: Request, res: Response) => {
          store.set(key(r), res.clone());
        },
        delete: async (r: Request | string) => store.delete(key(r)),
      },
    };
    try {
      const db = makeDb();
      const cookie = await signIn(db);
      const env = ENV(db);
      const uid = await userIdOf(cookie, env);
      const pid = seedBook(db, uid);
      stubSafety('safe');

      // Empty catalog warms the cache…
      expect(
        ((await (await app.request('/api/share/books', {}, env)).json()) as { books: unknown[] }).books,
      ).toEqual([]);
      expect(store.size).toBe(1);
      // …and stays empty until publish busts it.
      const pub = await app.request(`/api/projects/${pid}/publish`, json('POST', {}, cookie), env);
      expect(pub.status).toBe(200);
      expect(store.size).toBe(0);
      const bookId = ((await pub.json()) as { book: { id: string } }).book.id;
      const catalog = (await (await app.request('/api/share/books', {}, env)).json()) as {
        books: { id: string }[];
      };
      expect(catalog.books).toHaveLength(1);

      // Manifest is cached too: wiping the DB row still serves the page.
      const first = await app.request(`/api/share/${bookId}`, {}, env);
      expect(first.status).toBe(200);
      expect(((await first.json()) as { book: { id: string } }).book.id).toBe(bookId);
      db.books.clear();
      const cached = await app.request(`/api/share/${bookId}`, {}, env);
      expect(cached.status).toBe(200);
      expect(((await cached.json()) as { book: { id: string } }).book.id).toBe(bookId);
    } finally {
      delete (globalThis as { caches?: unknown }).caches;
    }
  });
});
