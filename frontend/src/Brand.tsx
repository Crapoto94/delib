import { useEffect, useState } from 'react';
import axios from 'axios';

export type Branding = { organismeId: number | null; nom: string; hasLogo: boolean; logoVersion: string | null };
let cache: Branding | null = null;

/** Identité publique (nom + logo de l'organisme par défaut), lisible avant la connexion. */
export function useBranding() {
  const [b, setB] = useState<Branding | null>(cache);
  useEffect(() => {
    let live = true;
    axios.get('/api/v1/public/branding').then((r) => { cache = r.data; if (live) setB(r.data); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return b;
}
export const resetBranding = () => { cache = null; };

/** Icône de l'application et titre de l'onglet = logo et nom de l'organisme. */
export function useFavicon(b: Branding | null) {
  useEffect(() => {
    if (!b) return;
    document.title = `${b.nom} — IvryDélib`;
    if (b.hasLogo && b.organismeId) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.href = `/api/v1/public/organismes/${b.organismeId}/logo?v=${b.logoVersion}`;
    }
  }, [b]);
}

export const logoUrl = (orgId: number, version: string | null) => `/api/v1/public/organismes/${orgId}/logo?v=${version ?? ''}`;

/** Logo de l'organisme, ou pastille aux initiales s'il n'y en a pas. */
export function OrgLogo({ orgId, nom, hasLogo, version, className = 'h-9' }: { orgId: number | null; nom: string; hasLogo: boolean; version: string | null; className?: string }) {
  if (hasLogo && orgId) return <img src={logoUrl(orgId, version)} alt={`Logo ${nom}`} className={`${className} w-auto max-w-[180px] object-contain`} />;
  return <span aria-hidden className={`flex aspect-square items-center justify-center rounded bg-primary font-bold text-white ${className}`}>{nom.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase() || 'Iv'}</span>;
}
