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

export const aiMeanings = (words: string[], level: string) =>
  api<{ meanings: { word: string; meaning: string }[] }>('/api/ai/meanings', {
    method: 'POST',
    body: JSON.stringify({ words, level }),
  });
