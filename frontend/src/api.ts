import axios from 'axios';

const TOKEN_KEY = 'ivrydelib.token';
const ORG_KEY = 'ivrydelib.org';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));
export const getOrgId = (): number | null => { const v = localStorage.getItem(ORG_KEY); return v ? Number(v) : null; };
export const setOrgId = (id: number) => localStorage.setItem(ORG_KEY, String(id));

export const api = axios.create({ baseURL: '/api/v1' });
api.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});
api.interceptors.response.use((r) => r, (e) => {
  if (e.response?.status === 401 && !String(e.config?.url).includes('/auth/login')) { setToken(null); if (!location.pathname.startsWith('/connexion')) location.href = '/connexion'; }
  return Promise.reject(e);
});

/** Message lisible d'une erreur d'API (le backend renvoie { error, code, details }). */
export function errMsg(e: any): string {
  const d = e?.response?.data;
  if (d?.error) return d.details?.missing ? `${d.error} — ${d.details.missing.map((m: any) => m.label).join(', ')}` : d.error;
  if (d?.message) return d.message;
  if (e?.response?.status === 502) return "Service externe indisponible (l'annuaire ou l'API centrale).";
  return e?.message || 'Erreur inconnue';
}

/** Chemin d'une ressource de l'organisme courant : org(3, '/actes') -> /organismes/3/actes */
export const org = (id: number, path = '') => `/organismes/${id}${path}`;
