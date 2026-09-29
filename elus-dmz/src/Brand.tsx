import { useEffect, useState } from 'react';
import { api } from './api';

export type Branding = { organismeId: number | null; nom: string; hasLogo: boolean; logoVersion: string | null };
let cache: Branding | null = null;

/**
 * La réponse est exploitée telle quelle par le rendu : on ne l'accepte que si sa forme est celle attendue.
 * Un serveur mal configuré peut répondre 200 avec autre chose (page HTML de repli SPA, JSON partiel) : sans ce
 * garde-fou, `nom` manquant ferait planter l'affichage et laisserait une page blanche.
 */
export function estBranding(x: any): x is Branding {
  return !!x && typeof x === 'object' && !Array.isArray(x) && typeof x.nom === 'string' && x.nom.trim() !== '';
}

/** Identité publique (nom + logo de la collectivité), lisible avant la connexion. */
export function useBranding() {
  const [b, setB] = useState<Branding | null>(cache);
  useEffect(() => {
    let live = true;
    api.get('/public/branding').then((r) => { if (!estBranding(r.data)) return; cache = r.data; if (live) setB(r.data); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return b;
}

const logoUrl = (orgId: number, version: string | null) => `${api.defaults.baseURL}/public/organismes/${orgId}/logo?v=${version ?? ''}`;

/** Icône de l'onglet et titre = logo et nom de la collectivité, application « Espace élus ». */
export function useFavicon(b: Branding | null) {
  useEffect(() => {
    if (!b) return;
    document.title = `${b.nom} — Espace élus`;
    if (b.hasLogo && b.organismeId) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.href = logoUrl(b.organismeId, b.logoVersion);
    }
  }, [b]);
}

/** Logo de la collectivité, ou pastille aux initiales s'il n'y en a pas. */
export function OrgLogo({ className = 'h-10' }: { className?: string }) {
  const b = useBranding();
  if (!b) return null;
  if (b.hasLogo && b.organismeId) return <img src={logoUrl(b.organismeId, b.logoVersion)} alt={`Logo ${b.nom}`} className={`${className} w-auto max-w-[200px] object-contain`} />;
  return <span aria-hidden className={`flex aspect-square items-center justify-center rounded bg-primary font-bold text-white ${className}`}>{(b.nom || '').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase() || 'Vd'}</span>;
}
