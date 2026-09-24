import { useEffect, useState } from 'react';
import { api, org as orgPath } from './api';
import { useAuth } from './auth';

export type LimitePJ = { tailleMaxMo: number; defautMo: number; maximumMo: number };
const DEF: LimitePJ = { tailleMaxMo: 30, defautMo: 30, maximumMo: 30 };
const cache = new Map<number, LimitePJ>();

/**
 * Taille maximale d'une pièce jointe (Mo), réglée par la collectivité dans « Paramétrages › Pièces jointes ».
 * Défaut 30 Mo, borné par le plafond technique du serveur. Mise en cache pour toute la session.
 */
export function useLimitePJ(): LimitePJ & { loaded: boolean } {
  const { org } = useAuth(); const o = org?.id ?? 0;
  const [v, setV] = useState<LimitePJ | null>(cache.get(o) ?? null);
  useEffect(() => {
    if (!o) return;
    let stop = false;
    api.get(orgPath(o, '/fichiers/limite')).then((r) => { cache.set(o, r.data); if (!stop) setV(r.data); }).catch(() => { if (!stop) setV(cache.get(o) ?? DEF); });
    return () => { stop = true; };
  }, [o]);
  return { ...(v ?? DEF), loaded: v !== null };
}

/** Après un changement du réglage : force la relecture au prochain affichage. */
export const oublierPJ = () => cache.clear();
