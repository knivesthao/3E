export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error('unauthorized');
    throw new Error('request failed');
  }
  return (await res.json()) as T;
}

export const getMe = () =>
  api<{ user: { id: string; email: string } }>('/api/auth/me');

export const requestLink = (email: string) =>
  api<{ ok: true; devLink?: string }>('/api/auth/request-link', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });

export const logout = () => api<{ ok: true }>('/api/auth/logout', { method: 'POST' });

export const LEVELS = ['A1', 'A2', 'B1', 'B2'];

export interface Project {
  id: string;
  title: string;
  description: string;
  level: string;
  purpose: string;
  status: string;
  cast_json: string;
  created_at: string;
  updated_at: string;
}

export interface Scene {
  id: string;
  project_id: string;
  scene_number: number;
  data_json: string;
  updated_at: string;
}

export interface SceneData {
  narration: string;
  bubbles: { speaker: string; text: string }[];
}

export const parseScene = (s: Scene): SceneData => JSON.parse(s.data_json) as SceneData;

export const listProjects = () => api<{ projects: Project[] }>('/api/projects');

export const createProject = (title: string, level: string) =>
  api<{ project: Project }>('/api/projects', { method: 'POST', body: JSON.stringify({ title, level }) });

export const getProject = (id: string) =>
  api<{ project: Project; scenes: Scene[] }>(`/api/projects/${id}`);

export const updateProject = (id: string, patch: Record<string, unknown>) =>
  api<{ project: Project }>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteProject = (id: string) =>
  api<{ ok: true }>(`/api/projects/${id}`, { method: 'DELETE' });

export const createScene = (projectId: string, data: SceneData) =>
  api<{ scene: Scene }>(`/api/projects/${projectId}/scenes`, {
    method: 'POST',
    body: JSON.stringify({ data_json: data }),
  });

export const updateScene = (projectId: string, sceneId: string, data: SceneData) =>
  api<{ scene: Scene }>(`/api/projects/${projectId}/scenes/${sceneId}`, {
    method: 'PATCH',
    body: JSON.stringify({ data_json: data }),
  });

export const deleteScene = (projectId: string, sceneId: string) =>
  api<{ ok: true }>(`/api/projects/${projectId}/scenes/${sceneId}`, { method: 'DELETE' });

export const reorderScenes = (projectId: string, order: string[]) =>
  api<{ scenes: Scene[] }>(`/api/projects/${projectId}/scenes/reorder`, {
    method: 'POST',
    body: JSON.stringify({ order }),
  });

export const aiFinish = (projectId: string) =>
  api<{ job: { id: string; status: string }; saved: number[]; failed: { scene_number: number; reason: string }[] }>(
    '/api/ai/finish',
    { method: 'POST', body: JSON.stringify({ projectId }) },
  );

export const aiSimplify = (text: string, level: string) =>
  api<{ rewritten: string; check: { passed: boolean; coverage: number; unknown: string[]; words: number } }>(
    '/api/ai/simplify',
    { method: 'POST', body: JSON.stringify({ text, level }) },
  );

export interface QuizQuestion {
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
}

export const aiQuiz = (projectId: string, sceneNumbers?: number[]) =>
  api<{ questions: QuizQuestion[] }>('/api/ai/quiz', {
    method: 'POST',
    body: JSON.stringify(sceneNumbers ? { projectId, sceneNumbers } : { projectId }),
  });

export interface BuddyTurn {
  role: 'learner' | 'pip';
  text: string;
}

export const aiBuddy = (projectId: string, sceneNumber: number | null, message: string, history: BuddyTurn[]) =>
  api<{ reply: string }>('/api/ai/buddy', {
    method: 'POST',
    body: JSON.stringify({ projectId, sceneNumber, message, history }),
  });

export interface Panel {
  scene_number: number;
  image_url: string;
  mask_url: string;
}

export const aiArt = (projectId: string, sceneNumber: number) =>
  api<{ job: { id: string; status: string }; panels: Panel[] }>('/api/ai/art', {
    method: 'POST',
    body: JSON.stringify({ projectId, sceneNumber }),
  });

export type CastKind = 'characters' | 'places';

export interface CastEntry {
  name: string;
  description?: string;
  image_url?: string;
}

export interface Cast {
  characters: CastEntry[];
  places: CastEntry[];
}

export const aiPortrait = (projectId: string, kind: CastKind, index: number) =>
  api<{ image_url: string; cast: Cast }>('/api/ai/art/portrait', {
    method: 'POST',
    body: JSON.stringify({ projectId, kind, index }),
  });

export interface ManifestScene {
  scene_number: number;
  narration: string;
  bubbles: { speaker: string; text: string }[];
  image_url: string | null;
  mask_url: string | null;
}

export interface Manifest {
  version: 2;
  project_id: string;
  title: string;
  description: string;
  level: string;
  reading_level: string;
  cover: string | null;
  scenes: ManifestScene[];
}

export interface Book {
  id: string;
  project_id: string;
  creator_id: string;
  title: string;
  description: string;
  level: string;
  reading_level: string;
  cover_url: string | null;
  manifest_json: string;
  published_at: string;
  updated_at: string;
  manifest: Manifest;
}

export const publishProject = (id: string) =>
  api<{ job: { id: string; status: string }; book: Book }>(`/api/projects/${id}/publish`, { method: 'POST' });

export const getBook = (projectId: string) => api<{ book: Book }>(`/api/projects/${projectId}/book`);

export const getSharedBook = (bookId: string) => api<{ book: Book }>(`/api/share/${bookId}`);

export interface CatalogBook {
  id: string;
  title: string;
  level: string;
  cover_url: string | null;
  published_at: string;
}

export const listBooks = () => api<{ books: CatalogBook[] }>('/api/share/books');

export const getPosition = (bookId: string) =>
  api<{ scene_number: number; updated_at: string | null }>(`/api/share/${bookId}/position`);

export const setPosition = (bookId: string, sceneNumber: number) =>
  api<{ ok: true; scene_number: number }>(`/api/share/${bookId}/position`, {
    method: 'POST',
    body: JSON.stringify({ scene_number: sceneNumber }),
  });

export interface CostTotals {
  total: number;
  first_try_cost: number;
  retry_overhead: number;
}

export interface BookCosts {
  totals: CostTotals;
  by_task: { task: string; cost: number; calls: number; tokens_in: number; tokens_out: number }[];
  by_model: { model: string; cost: number; calls: number; tokens_in: number; tokens_out: number }[];
  retries: { model: string; task: string; retries: number; max_attempt: number }[];
  attempts: {
    op_id: string;
    attempt: number;
    task: string;
    provider: string;
    model: string;
    input_tokens: number | null;
    output_tokens: number | null;
    cost_usd: number;
    ok: number;
    error: string | null;
    created_at: string;
  }[];
}

export interface AdminSpecs {
  models: { text: string; hard: string; image: string; segment: string; glimmer: string };
  basetenTasks: string[];
  basetenConfigured: boolean;
  dailyAiLimit: number;
}

export interface AdminStats {
  counts: Record<string, number>;
}

export const getAdminSpecs = () => api<AdminSpecs>('/api/admin/specs');
export const getAdminStats = () => api<AdminStats>('/api/admin/stats');

export interface ExamQuestion {
  id: string;
  part: 1 | 2 | 3 | 4;
  section: 'words' | 'grammar' | 'reading';
  prompt: string;
  passage?: string;
  options: string[];
}

export interface ExamItemStat {
  id: string;
  attempts: number;
  correct: number;
  pct: number | null;
}

export const getExamItems = () => api<{ items: ExamItemStat[] }>('/api/admin/exam-items');

export interface ExamResult {
  score: number;
  total: number;
  passed: boolean;
  message: string;
  review: { id: string; correct: boolean; answer: number; explanation: string }[];
}

export const getExam = () =>
  api<{ questions: ExamQuestion[]; total: number; passMark: number }>('/api/exam');

export const getExamBest = () =>
  api<{ attempts: number; best: number | null; total: number; passMark: number }>('/api/exam/best');

export const submitExam = (form: string[], answers: { id: string; choice: number }[]) =>
  api<ExamResult>('/api/exam/submit', { method: 'POST', body: JSON.stringify({ form, answers }) });

export const getBookCosts = (projectId: string) =>
  api<BookCosts>(`/api/admin/costs/book?projectId=${encodeURIComponent(projectId)}`);

export const getCostsOverview = () =>
  api<{ by_user_month: { user_id: string; month: string; cost: number }[] }>('/api/admin/costs/overview');

export const aiMeanings = (words: string[], level: string) =>
  api<{ meanings: { word: string; meaning: string }[] }>('/api/ai/meanings', {
    method: 'POST',
    body: JSON.stringify({ words, level }),
  });
