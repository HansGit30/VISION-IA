// Cliente de la API de VISION AI.
// En local, Vite redirige /api → http://localhost:4000 (ver vite.config.ts), así que VITE_API_URL puede ir vacío.
// En Vercel, define VITE_API_URL con la URL de tu backend en Render (ej. https://vision-ai-api.onrender.com).
export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export type Role = 'admin' | 'supervisor' | 'operador' | 'auditor';
export type Permission = 'data:read' | 'data:write' | 'alerts:review' | 'data:clear' | 'users:manage';
export type SessionUser = { id: string; email: string; name: string; role: Role; permissions: Permission[] };
export type AppUser = { id: string; email: string; name: string; role: Role; active: boolean; createdAt: string; lastLoginAt: string | null };

export const roleNames: Record<Role, string> = { admin: 'Administrador', supervisor: 'Supervisor', operador: 'Operador', auditor: 'Auditor' };

const TOKEN_KEY = 'vision-ai-token';
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } };
export const setToken = (t: string | null) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* sin almacenamiento */ } };

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn };

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(init.headers || {}) },
    });
  } catch {
    throw new Error('No se pudo conectar con el servidor. Si usas Render gratis, espera ~50 s a que despierte y reintenta.');
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/auth/login') onUnauthorized();
  if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
  return body as T;
}

export const post = <T = unknown>(path: string, data: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(data) });
export const patch = <T = unknown>(path: string, data: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(data) });
export const del = <T = unknown>(path: string) => api<T>(path, { method: 'DELETE' });

export const newId = (prefix = '') =>
  prefix + (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
