import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { api, apiBase, enLigne } from './api';

/**
 * Sonde de joignabilité du backend VibeDélib. Une seule requête toutes les 20 s vers
 * `/elus-auth/etat` (route publique, aucune donnée sensible), le résultat est partagé par tous les
 * appelants (bandeau + pastille) : un seul flux réseau, jamais de sonde supplémentaire.
 *
 * Deux précautions contre les fausses alertes, qui faisaient afficher « backend KO » alors que tout allait bien :
 *  - une réponse 429/503 (quota `limit_req` de nginx) est un état à part « limité », pas une panne — elle se
 *    résorbe seule, et ce n'est jamais « maintenance » ;
 *  - un échec isolé (réseau mobile qui hoquette, latence ponctuelle) déclenche UNE seconde tentative avant de
 *    conclure ; l'appareil hors ligne est distingué d'un vrai backend injoignable.
 */
export type Etat = 'verif' | 'ok' | 'ko' | 'limite' | 'hors_ligne';

type Mesure = { etat: Etat; detail: string; ms: number; quand: number };

const PERIODE = 20000;   // même cadence que l'ancien bandeau
const TIMEOUT = 10000;   // marge suffisante pour un réseau lent : 5 s provoquaient des KO en trompe-l'œil
const REPRISE_MS = 1500; // délai avant la seconde tentative
const DELAI_CLIC = 5000; // nginx limite /api/v1/elus-auth/ à 10 requêtes/min : on bride les clics manuels

const adresse = () => { try { return new URL(apiBase, location.origin).toString().replace(/\/+$/, ''); } catch { return apiBase; } };

const DEPART: Mesure = { etat: 'verif', detail: 'Vérification du backend…', ms: 0, quand: 0 };
let mesure: Mesure = DEPART;
const abonnes = new Set<() => void>();
const snapshot = () => mesure;
const publier = (m: Mesure) => { mesure = m; for (const f of abonnes) f(); };

const panne = (detail: string, ms: number): Mesure => ({ etat: 'ko', detail, ms, quand: Date.now() });

function diagnostiquer(e: any, ms: number): Mesure {
  const r = e?.response;
  if (r?.status === 429 || r?.status === 503) return { etat: 'limite', detail: `${r.status} — quota de requêtes atteint (rate limit nginx). Nouvel essai automatique.`, ms, quand: Date.now() };
  if (r?.status === 404) return panne('404 — /elus-auth/etat n’est pas relayé : vérifier la liste blanche nginx de la DMZ.', ms);
  if (r?.status === 502 || r?.status === 504) return panne(`${r.status} — la DMZ n’atteint pas le backend (BACKEND_HOST / BACKEND_PORT / pare-feu).`, ms);
  if (r) return panne(`HTTP ${r.status}${r.data?.error ? ` — ${r.data.error}` : ' — réponse inattendue du backend'}.`, ms);
  if (!enLigne()) return { etat: 'hors_ligne', detail: 'Cet appareil est hors ligne. Les documents déjà téléchargés restent lisibles.', ms, quand: Date.now() };
  if (e?.code === 'ECONNABORTED') return panne(`Délai dépassé (${TIMEOUT / 1000} s) sans réponse.`, ms);
  return panne('Aucune réponse du backend (DNS, pare-feu, TLS ou CSP).', ms);
}

const reussite = (r: any, ms: number): Mesure => r.data?.ok === true
  ? { etat: 'ok', detail: 'Backend joignable.', ms, quand: Date.now() }
  : { etat: 'ko', detail: `Réponse inattendue du backend : ${JSON.stringify(r.data)}`, ms, quand: Date.now() };

let enCours: Promise<void> | null = null;
/** Un clic manuel et la sonde périodique ne peuvent pas se chevaucher. */
export function sonderBackend(): Promise<void> {
  if (enCours) return enCours;
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const tenter = () => api.get('/elus-auth/etat', { timeout: TIMEOUT, params: { _t: Date.now() } });
  enCours = tenter()
    .then((r) => publier(reussite(r, ms())), async (e) => {
      if (!enLigne()) { publier(diagnostiquer(e, ms())); return; }   // hors ligne : inutile d'insister
      await new Promise((res) => setTimeout(res, REPRISE_MS));       // un aléa isolé ne doit pas faire clignoter l'état
      try { publier(reussite(await tenter(), ms())); } catch (e2) { publier(diagnostiquer(e2, ms())); }
    })
    .then(() => { enCours = null; });
  return enCours;
}

/** Une seule horloge pour toute l'application, démarrée au premier abonné. */
function abonner(f: () => void): () => void {
  abonnes.add(f);
  if (abonnes.size === 1) {
    void sonderBackend();
    setInterval(() => { if (document.visibilityState === 'visible') void sonderBackend(); }, PERIODE);
    window.addEventListener('online', () => void sonderBackend());
    window.addEventListener('offline', () => publier({ etat: 'hors_ligne', detail: 'Cet appareil est hors ligne. Les documents déjà téléchargés restent lisibles.', ms: 0, quand: Date.now() }));
  }
  return () => { abonnes.delete(f); };
}

export function useEtatBackend(): Mesure {
  return useSyncExternalStore(abonner, snapshot, snapshot);
}

/**
 * Bandeau discret, jamais bloquant — et jamais affiché pour un simple quota ou un appareil hors ligne : l'espace
 * élus permet de lire hors ligne les documents déjà téléchargés (docs.ts), donc l'indisponibilité du backend ne
 * doit jamais empêcher l'accès. Il faut DEUX échecs consécutifs avant d'afficher « maintenance ».
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
      : etat === 'limite'
        ? 'border-warn/40 bg-warn-bg text-warn'
        : 'border-line bg-soft text-mute';
  const etiquette = etat === 'ok' ? 'Backend joignable' : etat === 'ko' ? 'Backend injoignable' : etat === 'limite' ? 'Backend limité' : etat === 'hors_ligne' ? 'Appareil hors ligne' : 'Vérification du backend';
  const libelle = etat === 'ok' ? 'OK' : etat === 'ko' ? 'KO' : etat === 'limite' ? 'limité' : etat === 'hors_ligne' ? 'hors ligne' : '…';

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
      <span>Backend {libelle}</span>
    </button>
  );
}
