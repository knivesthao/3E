// Pure input validation for projects + scenes. No I/O — unit-tested.

export const LEVELS = ['A1', 'A2', 'B1', 'B2'] as const;
export type Level = (typeof LEVELS)[number];
export const PURPOSES = ['learning', 'reading'] as const;
export type Purpose = (typeof PURPOSES)[number];

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isLevel = (v: unknown): v is Level =>
  typeof v === 'string' && (LEVELS as readonly string[]).includes(v);

const isPurpose = (v: unknown): v is Purpose =>
  typeof v === 'string' && (PURPOSES as readonly string[]).includes(v);

const tryParse = (s: string): unknown => {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
};

export interface ProjectCreate {
  title: string;
  level: Level;
  purpose: Purpose;
  description: string;
}

export function validateProjectCreate(
  body: unknown,
): { ok: true; value: ProjectCreate } | { ok: false } {
  if (!isRecord(body)) return { ok: false };
  if (typeof body.title !== 'string' || body.title.trim() === '' || body.title.length > 200) {
    return { ok: false };
  }
  if (!isLevel(body.level)) return { ok: false };
  const purpose = body.purpose === undefined ? 'learning' : body.purpose;
  if (!isPurpose(purpose)) return { ok: false };
  const description = body.description === undefined ? '' : body.description;
  if (typeof description !== 'string' || description.length > 2000) return { ok: false };
  return { ok: true, value: { title: body.title.trim(), level: body.level, purpose, description } };
}

export interface ProjectPatch {
  title?: string;
  description?: string;
  level?: Level;
  purpose?: Purpose;
  cast_json?: string;
}

export function validateProjectPatch(
  body: unknown,
): { ok: true; value: ProjectPatch } | { ok: false } {
  if (!isRecord(body)) return { ok: false };
  const patch: ProjectPatch = {};
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim() === '' || body.title.length > 200) {
      return { ok: false };
    }
    patch.title = body.title.trim();
  }
  if (body.description !== undefined) {
    if (typeof body.description !== 'string' || body.description.length > 2000) return { ok: false };
    patch.description = body.description;
  }
  if (body.level !== undefined) {
    if (!isLevel(body.level)) return { ok: false };
    patch.level = body.level;
  }
  if (body.purpose !== undefined) {
    if (!isPurpose(body.purpose)) return { ok: false };
    patch.purpose = body.purpose;
  }
  if (body.cast_json !== undefined) {
    const cast = validateCast(body.cast_json);
    if (!cast.ok) return { ok: false };
    patch.cast_json = cast.value;
  }
  return { ok: true, value: patch };
}

export interface SceneBubble {
  speaker: string;
  text: string;
}

export interface SceneData {
  narration: string;
  bubbles: SceneBubble[];
}

export function validateSceneData(
  data: unknown,
): { ok: true; value: SceneData } | { ok: false } {
  if (!isRecord(data)) return { ok: false };
  if (typeof data.narration !== 'string' || data.narration.length > 2000) return { ok: false };
  if (!Array.isArray(data.bubbles) || data.bubbles.length > 10) return { ok: false };
  const bubbles: SceneBubble[] = [];
  for (const b of data.bubbles) {
    if (!isRecord(b)) return { ok: false };
    if (typeof b.speaker !== 'string' || b.speaker.length > 50) return { ok: false };
    if (typeof b.text !== 'string' || b.text.length > 500) return { ok: false };
    bubbles.push({ speaker: b.speaker, text: b.text });
  }
  return { ok: true, value: { narration: data.narration, bubbles } };
}

export function validateCast(input: unknown): { ok: true; value: string } | { ok: false } {
  const obj = typeof input === 'string' ? tryParse(input) : input;
  if (!isRecord(obj)) return { ok: false };
  const norm = (v: unknown): { name: string; description?: string }[] | null => {
    if (!Array.isArray(v) || v.length > 50) return null;
    const out: { name: string; description?: string }[] = [];
    for (const e of v) {
      if (!isRecord(e) || typeof e.name !== 'string' || e.name.trim() === '' || e.name.length > 100) {
        return null;
      }
      if (e.description !== undefined && typeof e.description !== 'string') return null;
      const description = typeof e.description === 'string' ? e.description.trim().slice(0, 500) : '';
      out.push(description === '' ? { name: e.name.trim() } : { name: e.name.trim(), description });
    }
    return out;
  };
  const characters = norm(obj.characters ?? []);
  const places = norm(obj.places ?? []);
  if (!characters || !places) return { ok: false };
  return { ok: true, value: JSON.stringify({ characters, places }) };
}

export function validateSceneOrder(
  order: unknown,
): { ok: true; value: string[] } | { ok: false } {
  if (!Array.isArray(order) || order.length === 0 || order.length > 50) return { ok: false };
  if (!order.every((id) => typeof id === 'string' && id.length > 0)) return { ok: false };
  if (new Set(order).size !== order.length) return { ok: false };
  return { ok: true, value: order as string[] };
}
