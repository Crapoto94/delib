import axios from 'axios';

/**
 * Client de l'espace élus. Aucun code de l'application des agents n'est importé ici : ce bundle est servi seul en DMZ / dans l'APK.
 * L'URL de l'API est paramétrable pour l'APK (window.__ELUS_API__ ou VITE_ELUS_API) ; par défaut, même origine (/api/v1).
 */
const K = { token: 'elus.token', expire: 'elus.expire', elu: 'elus.elu', device: 'elus.device' };
declare global { interface Window { __ELUS_API__?: string } }
export const apiBase: string = window.__ELUS_API__ || (import.meta.env.VITE_ELUS_API as string | undefined) || '/api/v1';

export type EluSession = { id: number; nom: string; organismeId: number };
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };

export const session = {
  token: () => { const t = read(K.token); const e = read(K.expire); return t && (!e || new Date(e) > new Date()) ? t : null; },
  elu: (): EluSession | null => { try { return JSON.parse(read(K.elu) || 'null'); } catch { return null; } },
  set: (s: { token: string; expiresAt: string; elu: EluSession }) => { write(K.token, s.token); write(K.expire, s.expiresAt); write(K.elu, JSON.stringify(s.elu)); },
  clear: () => { write(K.token, null); write(K.expire, null); write(K.elu, null); },
};

/** Identifiant aléatoire de l'appareil (généré une fois) : sert à mémoriser un appareil de confiance. */
export const deviceId = () => {
  let d = read(K.device);
  if (!d) { d = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`) + '-elus'; write(K.device, d); }
  return d;
};

export const api = axios.create({ baseURL: apiBase, timeout: 60000 });
api.interceptors.request.use((cfg) => { const t = session.token(); if (t) cfg.headers.Authorization = `Bearer ${t}`; return cfg; });
api.interceptors.response.use((r) => r, (e) => {
  if (e.response?.status === 401 && !String(e.config?.url).includes('/elus-auth/')) { session.clear(); if (!location.hash.startsWith('#/connexion')) location.hash = '#/connexion'; }
  return Promise.reject(e);
});

export function errMsg(e: any): string {
  const d = e?.response?.data;
  if (d?.error) return d.error;
  if (!e?.response) return 'Pas de connexion au serveur.';
  return e?.message || 'Erreur inconnue';
}
export const enLigne = () => (typeof navigator === 'undefined' ? true : navigator.onLine);
