import { useSyncExternalStore } from 'react';

/**
 * Petit bus de rafraîchissement : le bouton de l'en-tête force le rechargement des données affichées (séance en
 * cours, accueil, calendrier, identité de la collectivité). Utile après une coupure réseau : les vues se remettent à
 * jour sans recharger toute la page. En ligne, `chargerAvecCache` interroge le serveur ; hors ligne, il ressert la
 * dernière copie connue.
 */
let version = 0;
const abonnes = new Set<() => void>();

export function rafraichir() { version += 1; for (const f of abonnes) f(); }

export function useRafraichissement(): number {
  return useSyncExternalStore((f) => { abonnes.add(f); return () => { abonnes.delete(f); }; }, () => version, () => version);
}
