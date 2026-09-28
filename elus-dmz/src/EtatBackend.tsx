import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { api, apiBase } from './api';

/**
 * Sonde de joignabilité du backend VibeDélib. Une seule requête toutes les 20 s vers
 * `/elus-auth/etat` (route publique, aucune donnée sensible), le résultat est partagé par tous les
 * appelants (bandeau + pastille) : un seul flux réseau, jamais de sonde supplémentaire.
 *
 * Le détail du dernier échec est conservé parce qu'il est ce qui distingue les causes réelles d'une
 * simple lenteur : 404 = route absente de la liste blanche nginx de la DMZ, 502/504 = la DMZ
 * n'atteint pas le backend, 429 = quota nginx, aucune réponse = DNS / pare-feu / TLS / CSP.
 */
export type Etat = 'verif' | 'ok' | 'ko';

type Mesure = { etat: Etat; detail: string; ms: number; quand: number };

const PERIODE = 20000;   // même cadence que l'ancien bandeau
const TIMEOUT = 5000;
const DELAI_CLIC = 5000; // nginx limite /api/v1/elus-auth/ à 10 requêtes/min : on bride les clics manuels

const adresse = () => { try { return new URL(apiBase, location.origin).toString().replace(/\/+$/, ''); } catch { return apiBase; } };

const DEPART: Mesure = { etat: 'verif', detail: 'Vérification du backend…', ms: 0, quand: 0 };
let mesure: Mesure = DEPART;
const abonnes = new Set<() => void>();
const snapshot = () => mesure;
const publier = (m: Mesure) => { mesure = m; for (const f of abonnes) f(); };

function diagnostiquer(e: any, ms: number): Mesure {
  const r = e?.response;
  const ko = (detail: string): Mesure => ({ etat: 'ko', detail, ms, quand: Date.now() });
  if (r?.status === 404) return ko('404 — /elus-auth/etat n’est pas relayé : vérifier la liste blanche nginx de la DMZ.');
  if (r?.status === 502 || r?.status === 504) return ko(`${r.status} — la DMZ n’atteint pas le backend (BACKEND_HOST / BACKEND_PORT / pare-feu).`);
  if (r?.status === 503) return ko('503 — nginx ne relaie pas la requête : quota limit_req dépassé (10 req/min sur /api/v1/elus-auth/) ou conteneur arrêté.');
  if (r?.status === 429) return ko('429 — quota de requêtes dépassé (rate limit nginx ou du backend).');
  if (r) return ko(`HTTP ${r.status}${r.data?.error ? ` — ${r.data.error}` : ' — réponse inattendue du backend'}.`);
  if (e?.code === 'ECONNABORTED') return ko(`Délai dépassé (${TIMEOUT / 1000} s) sans réponse.`);
  return ko('Aucune réponse du backend (DNS, pare-feu, TLS ou CSP).');
}

let enCours: Promise<void> | null = null;
/** Un clic manuel et la sonde périodique ne peuvent pas se chevaucher. */
export function sonderBackend(): Promise<void> {
  if (enCours) return enCours;
  const t0 = performance.now();
  enCours = api
    .get('/elus-auth/etat', { timeout: TIMEOUT, params: { _t: Date.now() } })
    .then((r) => publier({ etat: r.data?.ok === true ? 'ok' : 'ko', detail: r.data?.ok === true ? 'Backend joignable.' : `Réponse inattendue du backend : ${JSON.stringify(r.data)}`, ms: Math.round(performance.now() - t0), quand: Date.now() }))
    .catch((e) => publier(diagnostiquer(e, Math.round(performance.now() - t0))))
    .then(() => { enCours = null; });
  return enCours;
}

/** Une seule horloge pour toute l'application, démarrée au premier abonné. */
function abonner(f: () => void): () => void {
  abonnes.add(f);
  if (abonnes.size === 1) {
    void sonderBackend();
    setInterval(() => { if (document.visibilityState === 'visible') void sonderBackend(); }, PERIODE);
  }
  return () => { abonnes.delete(f); };
}

export function useEtatBackend(): Mesure {
  return useSyncExternalStore(abonner, snapshot, snapshot);
}

/**
 * Bandeau discret, jamais bloquant : l'espace élus permet de lire hors ligne les
 * documents déjà téléchargés (docs.ts), donc l'indisponibilité du backend ne doit
 * jamais empêcher l'accès à l'application, seulement le signaler.
 * Il faut DEUX échecs consécutifs avant d'afficher le bandeau : un simple aléa
 * réseau (timeout ponctuel, seconde de latence) ne doit pas déclencher une
 * fausse alerte « maintenance » alors que le reste de l'application fonctionne.
 */
export default function EtatBackend() {
  const { etat, detail } = useEtatBackend();
  const [echecsConsecutifs, setEchecs] = useState(0);

  useEffect(() => { setEchecs((n) => (etat === 'ok' ? 0 : n + 1)); }, [etat]);
  if (etat !== 'ko' || echecsConsecutifs < 2) return null;
  return (
    <div role="status" className="mb-3 flex items-start gap-2 rounded border border-warn/30 bg-warn-bg px-3 py-2 text-[13px] text-warn">
      <WifiOff className="mt-px h-4 w-4 shrink-0" />
      <span>Le système est actuellement en maintenance — la connexion n'est pas possible pour le moment. Les documents déjà téléchargés restent consultables.
        <span className="mt-1 block font-mono text-[11px] opacity-80">{detail}</span>
      </span>
    </div>
  );
}

/**
 * Pastille d'état du backend : verte si la dernière sonde a réussi, rouge sinon.
 * Sert au diagnostic de déploiement (la page s'affiche mais l'API ne répond pas) : le survol
 * donne l'adresse interrogée et la cause, le clic relance la sonde immédiatement.
 */
export function PastilleBackend() {
  const { etat, detail, ms, quand } = useEtatBackend();
  const [enAttente, setEnAttente] = useState(false);
  const dernierClic = useRef(0);

  const cliquer = () => {
    if (Date.now() - dernierClic.current < DELAI_CLIC) return;
    dernierClic.current = Date.now();
    setEnAttente(true);
    void sonderBackend().then(() => setEnAttente(false));
  };

  const classes = etat === 'ok'
    ? 'border-ok/40 bg-ok-bg text-ok-text'
    : etat === 'ko'
      ? 'border-ko/40 bg-ko-bg text-ko'
      : 'border-line bg-soft text-mute';
  const etiquette = etat === 'ok' ? 'Backend joignable' : etat === 'ko' ? 'Backend injoignable' : 'Vérification du backend';

  return (
    <button
      type="button"
      onClick={cliquer}
      title={`${adresse()}/elus-auth/etat — ${detail}${ms ? ` (${ms} ms)` : ''}${quand ? ` — mesuré à ${new Date(quand).toLocaleTimeString('fr-FR')}` : ''} — cliquer pour revérifier`}
      aria-label={`${etiquette}. Cliquer pour revérifier.`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${classes}`}
    >
      {enAttente || etat === 'verif'
        ? <RefreshCw className={`h-3 w-3 ${enAttente ? 'animate-spin' : 'opacity-60'}`} />
        : etat === 'ok' ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
      <span>Backend {etat === 'ok' ? 'OK' : etat === 'ko' ? 'KO' : '…'}</span>
    </button>
  );
}
