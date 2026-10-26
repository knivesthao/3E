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
