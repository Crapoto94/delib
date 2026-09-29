import { enLigne } from './api';

/**
 * Lecture avec copie locale (ELU-65, hors ligne sur tablette). Les documents PDF sont déjà conservés par `docs.ts` ;
 * ici, ce sont les DONNÉES qui doivent survivre à une coupure : sans elles, l'application affichait « pas de connexion
 * serveur » même avec les 36 documents téléchargés, car la liste des séances et l'ordre du jour venaient du réseau.
 *
 * On ne sert la copie locale que si l'appareil est hors ligne ou si la requête échoue SANS réponse du serveur : une
 * vraie erreur métier (401, 403, 404…) est toujours remontée telle quelle, jamais masquée par un cache périmé.
 */
const PREFIXE = 'elus.cache.';

const lire = <T,>(cle: string): T | undefined => {
  try { const v = localStorage.getItem(PREFIXE + cle); return v ? (JSON.parse(v) as T) : undefined; } catch { return undefined; }
};
const ecrire = (cle: string, valeur: unknown) => {
  try { localStorage.setItem(PREFIXE + cle, JSON.stringify(valeur)); } catch { /* quota dépassé : la donnée reste accessible en ligne */ }
};

export async function chargerAvecCache<T>(cle: string, charger: () => Promise<T>): Promise<{ data: T; horsLigne: boolean }> {
  const memo = lire<T>(cle);
  if (!enLigne()) {
    if (memo !== undefined) return { data: memo, horsLigne: true };
    throw new Error('Pas de connexion au serveur.');
  }
  try {
    const data = await charger();
    ecrire(cle, data);
    return { data, horsLigne: false };
  } catch (e: any) {
    if (!e?.response && memo !== undefined) return { data: memo, horsLigne: true };
    throw e;
  }
}

/** À la déconnexion ou au changement d'instance : aucune donnée nominative ne subsiste sur l'appareil. */
export function viderCache() {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIXE)) localStorage.removeItem(k); } catch { /* stockage indisponible */ }
}
