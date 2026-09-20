import { Fragment, useEffect, useState } from 'react';
import { api } from './api';

/**
 * Affichage d'une personne par son « Prénom NOM » plutôt que par son identifiant de connexion.
 * Les identifiants demandés pendant le même rendu sont regroupés en UNE requête (`/directory/agents/noms`) ; le résultat est mis en
 * cache pour toute la session. Tant que le nom n'est pas connu (ou s'il n'existe pas), l'identifiant reste affiché.
 */
const known = new Map<string, string | null>(); // identifiant -> nom (null : introuvable)
const wanted = new Set<string>(); const listeners = new Set<() => void>(); let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  const batch = [...wanted].slice(0, 100); batch.forEach((u) => wanted.delete(u));
  if (!batch.length) return;
  api.get('/directory/agents/noms', { params: { u: batch.join(',') } })
    .then((r) => { for (const u of batch) known.set(u, r.data.noms?.[u] ?? null); })
    .catch(() => { for (const u of batch) known.set(u, null); })
    .finally(() => { listeners.forEach((l) => l()); if (wanted.size) flush(); });
}
function want(u: string) {
  if (known.has(u) || wanted.has(u)) return;
  wanted.add(u);
  if (!timer) timer = setTimeout(flush, 30);
}
const clean = (u: string) => String(u || '').trim().toLowerCase().replace(/^@/, '');

/** Noms de plusieurs identifiants ; se met à jour quand la réponse arrive. */
export function useAgentNames(usernames: (string | null | undefined)[]): (u: string | null | undefined) => string {
  const [, tick] = useState(0);
  useEffect(() => { const l = () => tick((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  usernames.forEach((u) => { const c = clean(u ?? ''); if (c) want(c); });
  return (u) => { const c = clean(u ?? ''); return c ? (known.get(c) ?? String(u)) : ''; };
}

/** <AgentName u="machevalier" /> → « Marc CHEVALIER » */
export function AgentName({ u }: { u: string | null | undefined }) {
  const name = useAgentNames([u]);
  return <>{name(u)}</>;
}

/** Liste de personnes : « Marc CHEVALIER, Claire MARTIN » */
export function AgentNames({ list, sep = ', ' }: { list: (string | null | undefined)[] | null | undefined; sep?: string }) {
  const items = (list ?? []).filter(Boolean) as string[];
  const name = useAgentNames(items);
  return <>{items.map((u, i) => <Fragment key={`${u}-${i}`}>{i > 0 && sep}{name(u)}</Fragment>)}</>;
}
