import { useSyncExternalStore } from 'react';
import { api, enLigne, session } from './api';

/**
 * Documents de séance sur l'appareil + TÉLÉCHARGEMENT EN ARRIÈRE-PLAN (ELU-65).
 *  - Cache API (web et WebView de l'APK) : un espace PROPRE À L'ÉLU, purgé à la déconnexion ;
 *  - le manifeste du serveur donne la version de chaque document : on ne télécharge que ce qui manque ou a changé ;
 *  - trois téléchargements en parallèle, nouvel essai avec temporisation, reprise au retour du réseau, économiseur de données respecté ;
 *  - ouvrir un document déjà là est INSTANTANÉ (lecture locale) : passer d'un point au suivant ne coûte rien ;
 *  - lire n'est pas télécharger : les lectures (même hors ligne) sont mises en file et transmises au retour du réseau.
 * Sur l'APK, un service natif d'arrière-plan pourra appeler `prefetchSeance` application fermée : l'interface est la même.
 */
export type Doc = { key: string; type: string; titre: string; version: string; url: string; itemId?: number; priorite: number };
export type PrefetchState = { seanceId: number | null; total: number; prets: number; echecs: number; octets: number; enCours: boolean; horsLigne: boolean; espaceFaible: boolean };

const cacheName = () => `elus-docs-${session.elu()?.id ?? 0}`;
const fakeUrl = (key: string) => `https://elus.invalid/doc/${encodeURIComponent(key)}`;
const supporte = () => typeof caches !== 'undefined';

// --- stockage local ---------------------------------------------------------------------------------------------------------------
export async function versionLocale(key: string): Promise<string | null> {
  if (!supporte()) return null;
  try { const r = await (await caches.open(cacheName())).match(fakeUrl(key)); return r?.headers.get('X-Document-Version') ?? null; } catch { return null; }
}
async function lireLocal(key: string, version?: string): Promise<Blob | null> {
  if (!supporte()) return null;
  try {
    const r = await (await caches.open(cacheName())).match(fakeUrl(key));
    if (!r || (version && r.headers.get('X-Document-Version') !== version)) return null;
    return await r.blob();
  } catch { return null; }
}
async function ecrireLocal(key: string, version: string, blob: Blob) {
  if (!supporte()) return;
  try { await (await caches.open(cacheName())).put(fakeUrl(key), new Response(blob, { headers: { 'Content-Type': 'application/pdf', 'X-Document-Version': version } })); } catch { /* quota : le document reste lisible en ligne */ }
}
/** À la déconnexion : les documents nominatifs ne restent pas sur l'appareil. */
export async function purger() { if (supporte()) { try { await caches.delete(cacheName()); } catch { /* */ } } try { localStorage.removeItem('elus.lectures'); } catch { /* */ } etat = { ...etat, seanceId: null, total: 0, prets: 0, echecs: 0, octets: 0 }; emit(); }

async function telecharger(d: Doc): Promise<Blob> {
  const r = await api.get(d.url.replace(/^\/api\/v1/, ''), { responseType: 'blob' });
  const version = String(r.headers['x-document-version'] || d.version);
  await ecrireLocal(d.key, version, r.data);
  return r.data as Blob;
}
/** Document prêt à lire : depuis l'appareil s'il y est à la bonne version (instantané), sinon depuis le réseau (et il est alors conservé). */
export async function ouvrirDoc(d: Pick<Doc, 'key' | 'version' | 'url'>): Promise<{ blob: Blob; local: boolean }> {
  const l = await lireLocal(d.key, d.version);
  if (l) return { blob: l, local: true };
  if (!enLigne()) { const vieux = await lireLocal(d.key); if (vieux) return { blob: vieux, local: true }; throw new Error('Ce document n’est pas encore téléchargé et vous êtes hors ligne.'); }
  return { blob: await telecharger({ ...d, type: '', titre: '', priorite: 0 }), local: false };
}

// --- état du téléchargement -------------------------------------------------------------------------------------------------------
let etat: PrefetchState = { seanceId: null, total: 0, prets: 0, echecs: 0, octets: 0, enCours: false, horsLigne: false, espaceFaible: false };
const abonnes = new Set<() => void>();
const emit = () => abonnes.forEach((f) => f());
const set = (p: Partial<PrefetchState>) => { etat = { ...etat, ...p }; emit(); };
export const usePrefetch = (): PrefetchState => useSyncExternalStore((f) => { abonnes.add(f); return () => { abonnes.delete(f); }; }, () => etat);

let tour = 0;
/** Télécharge en arrière-plan tout ce qui manque ou a changé pour cette séance. Peut être rappelée à volonté (idempotente). */
export async function prefetchSeance(seanceId: number, { concurrence = 3 }: { concurrence?: number } = {}): Promise<void> {
  const mon = ++tour;
  if (!enLigne()) { set({ seanceId, horsLigne: true, enCours: false }); await recompter(seanceId).catch(() => undefined); return; }
  const conn = (navigator as any).connection; if (conn?.saveData) { set({ seanceId, enCours: false }); await recompter(seanceId).catch(() => undefined); return; } // économiseur de données : pas de téléchargement automatique
  let faible = false;
  try { const e = await navigator.storage?.estimate?.(); if (e?.quota && e.usage !== undefined && e.quota - e.usage < 150 * 1024 * 1024) faible = true; } catch { /* */ }
  let manifeste: { documents: Doc[] };
  try { manifeste = (await api.get(`/elus/seances/${seanceId}/manifeste`)).data; } catch { set({ seanceId, enCours: false }); return; }
  const docs = [...manifeste.documents].sort((a, b) => a.priorite - b.priorite);
  let prets = 0; let echecs = 0; let octets = 0;
  const aFaire: Doc[] = [];
  for (const d of docs) { if ((await versionLocale(d.key)) === d.version) prets++; else aFaire.push(d); }
  set({ seanceId, total: docs.length, prets, echecs: 0, octets: 0, enCours: aFaire.length > 0, horsLigne: false, espaceFaible: faible });
  const file = [...aFaire];
  const ouvrier = async () => {
    for (let d = file.shift(); d; d = file.shift()) {
      if (mon !== tour) return; // un autre passage a pris le relais
      let ok = false;
      for (let essai = 0; essai < 3 && !ok; essai++) {
        try { const b = await telecharger(d); octets += b.size; ok = true; } catch { if (!enLigne()) break; await new Promise((r) => setTimeout(r, 800 * (essai + 1))); }
      }
      if (ok) prets++; else echecs++;
      if (mon === tour) set({ prets, echecs, octets });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrence, Math.max(1, aFaire.length)) }, ouvrier));
  if (mon === tour) set({ enCours: false, prets, echecs, octets, horsLigne: !enLigne() });
}
async function recompter(seanceId: number) { // hors ligne : ce qui est déjà sur l'appareil
  const m = (await api.get(`/elus/seances/${seanceId}/manifeste`)).data as { documents: Doc[] };
  let prets = 0; for (const d of m.documents) if ((await versionLocale(d.key)) === d.version) prets++;
  set({ seanceId, total: m.documents.length, prets });
}

/** Reprise automatique : retour du réseau, retour au premier plan, et toutes les 10 minutes. */
let arme = false;
export function armerReprise(getSeanceId: () => number | null) {
  if (arme) return; arme = true;
  const go = () => { const id = getSeanceId(); if (id && enLigne()) { void prefetchSeance(id); void envoyerLectures(); } };
  window.addEventListener('online', go);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) go(); });
  setInterval(go, 10 * 60 * 1000);
}

// --- lectures (preuve de consultation) ---------------------------------------------------------------------------------------------
type Lecture = { seanceId: number; key: string; version: string; at: string };
const lireFile = (): Lecture[] => { try { return JSON.parse(localStorage.getItem('elus.lectures') || '[]'); } catch { return []; } };
export function noterLecture(seanceId: number, key: string, version: string) {
  const f = lireFile(); if (f.some((l) => l.seanceId === seanceId && l.key === key && l.version === version)) return;
  f.push({ seanceId, key, version, at: new Date().toISOString() });
  try { localStorage.setItem('elus.lectures', JSON.stringify(f.slice(-500))); } catch { /* */ }
  void envoyerLectures();
}
export async function envoyerLectures() {
  if (!enLigne() || !session.token()) return;
  const f = lireFile(); if (!f.length) return;
  const reste: Lecture[] = [];
  for (const id of [...new Set(f.map((l) => l.seanceId))]) {
    const lot = f.filter((l) => l.seanceId === id);
    try { await api.post(`/elus/seances/${id}/lectures`, { items: lot.map(({ key, version, at }) => ({ key, version, at })) }); } catch { reste.push(...lot); }
  }
  try { localStorage.setItem('elus.lectures', JSON.stringify(reste)); } catch { /* */ }
}
