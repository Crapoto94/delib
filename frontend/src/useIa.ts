import { useEffect, useState } from 'react';
import { api, org as orgPath } from './api';
import { useAuth } from './auth';

export type IaUsages = { orthographe: boolean; style: boolean; visas: boolean; complet: boolean; copie: boolean; aide: boolean };
const TOUT_OFF: IaUsages = { orthographe: false, style: false, visas: false, complet: false, copie: false, aide: false };
const cache = new Map<number, IaUsages>();

/**
 * Usages de l'IA activés pour l'organisme (D83). Un usage désactivé n'a AUCUN bouton dans l'interface (et le serveur refuse l'appel) :
 * tant que la réponse n'est pas arrivée, rien n'est affiché, pour ne jamais montrer un bouton qui sera retiré.
 */
export function useIa(): IaUsages & { loaded: boolean; any: boolean } {
  const { org } = useAuth(); const o = org?.id ?? 0;
  const [v, setV] = useState<IaUsages | null>(cache.get(o) ?? null);
  useEffect(() => {
    if (!o) return;
    let stop = false;
    api.get(orgPath(o, '/ia/statut')).then((r) => { cache.set(o, r.data); if (!stop) setV(r.data); }).catch(() => { if (!stop) setV(cache.get(o) ?? TOUT_OFF); });
    return () => { stop = true; };
  }, [o]);
  const u = v ?? TOUT_OFF;
  return { ...u, loaded: v !== null, any: u.orthographe || u.style || u.visas || u.complet || u.copie || u.aide };
}
/** Après un changement dans les paramétrages : force la relecture au prochain affichage. */
export const oublierIa = () => cache.clear();
