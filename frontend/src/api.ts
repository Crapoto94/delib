import axios from 'axios';
import { showPdf } from './PdfViewer';

const TOKEN_KEY = 'ivrydelib.token';
const ORG_KEY = 'ivrydelib.org';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));
export const getOrgId = (): number | null => { const v = localStorage.getItem(ORG_KEY); return v ? Number(v) : null; };
export const setOrgId = (id: number) => localStorage.setItem(ORG_KEY, String(id));

const ACT_AS_KEY = 'ivrydelib.actas';
export const getActAs = () => localStorage.getItem(ACT_AS_KEY);
export const setActAs = (u: string | null) => (u ? localStorage.setItem(ACT_AS_KEY, u) : localStorage.removeItem(ACT_AS_KEY));

export const api = axios.create({ baseURL: '/api/v1' });
api.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  const a = getActAs();
  if (a) cfg.headers['X-Act-As'] = a; // « Afficher en tant que » : mêmes droits que cet utilisateur
  return cfg;
});
api.interceptors.response.use((r) => r, (e) => {
  if (getActAs() && [403, 404].includes(e.response?.status) && String(e.config?.url) === '/me') { setActAs(null); location.href = '/'; }
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

/** Message d'une erreur dont le corps est un Blob (les aperçus PDF demandent `responseType: 'blob'`). */
export async function blobErrMsg(e: any): Promise<string> {
  const d = e?.response?.data;
  if (d instanceof Blob) { try { const j = JSON.parse(await d.text()); return j.error || 'Erreur du serveur'; } catch { return 'Erreur du serveur'; } }
  return errMsg(e);
}

/** Affiche un PDF dans la visionneuse de l'application (modale avec zoom) ; renvoie null ou le message d'erreur. */
export async function openPdf(request: () => Promise<{ data: Blob }>, title?: string): Promise<string | null> {
  try {
    const r = await request();
    showPdf(r.data, title);
    return null;
  } catch (e) { return blobErrMsg(e); }
}
