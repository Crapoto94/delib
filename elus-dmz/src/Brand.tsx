import { useEffect, useState } from 'react';
import { api } from './api';

export type Branding = { organismeId: number | null; nom: string; hasLogo: boolean; logoVersion: string | null };
let cache: Branding | null = null;
let logoMemoire: string | null = null; // logo conservé pour le hors ligne (data URL)

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

const cleLogo = (b: Branding) => `elus.logo.${b.organismeId}.${b.logoVersion ?? ''}`;
const lireLogo = (b: Branding) => { try { return localStorage.getItem(cleLogo(b)); } catch { return null; } };
const urlLogo = (b: Branding) => `${api.defaults.baseURL}/public/organismes/${b.organismeId}/logo?v=${b.logoVersion ?? ''}`;

/** Télécharge le logo une fois et le conserve sur l'appareil : il reste affiché hors ligne (l'image n'est pas
 *  mise en cache par nginx, contrairement aux données de séance, et apparaissait cassée sans réseau). */
async function conserverLogo(b: Branding): Promise<string | null> {
  if (!b.hasLogo || !b.organismeId) return null;
  const deja = lireLogo(b); if (deja) return deja;
  try {
    const r = await api.get(urlLogo(b).replace(/^\/api\/v1/, ''), { responseType: 'blob' });
    const dataUrl = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(r.data); });
    try { localStorage.setItem(cleLogo(b), dataUrl); } catch { /* quota : le logo restera en ligne seulement */ }
    return dataUrl;
  } catch { return null; }
}

/** Logo conservé sur l'appareil s'il a déjà été récupéré (affiché immédiatement, même hors ligne). */
export function useLogo(b: Branding | null): string | null {
  const [logo, setLogo] = useState<string | null>(logoMemoire);
  useEffect(() => {
    if (!b?.hasLogo || !b.organismeId) return;
    const memo = lireLogo(b); if (memo) { logoMemoire = memo; setLogo(memo); return; }
    let live = true;
    void conserverLogo(b).then((d) => { if (live && d) { logoMemoire = d; setLogo(d); } });
    return () => { live = false; };
  }, [b?.organismeId, b?.logoVersion, b?.hasLogo]);
  return logo;
}

/** Icône de l'onglet et titre = logo et nom de la collectivité, application « Espace élus ». */
export function useFavicon(b: Branding | null) {
  const logo = useLogo(b);
  useEffect(() => {
    if (!b) return;
    document.title = `${b.nom} — Espace élus`;
    if (b.hasLogo && b.organismeId) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.href = logo || urlLogo(b);
    }
  }, [b, logo]);
}

/** Logo de la collectivité, ou pastille aux initiales s'il n'y en a pas (ou s'il ne peut pas être affiché). */
export function OrgLogo({ className = 'h-10' }: { className?: string }) {
  const b = useBranding();
  const logo = useLogo(b);
  const [echec, setEchec] = useState(false);
  if (!b) return null;
  if (b.hasLogo && b.organismeId && !echec) return <img src={logo || urlLogo(b)} alt={`Logo ${b.nom}`} onError={() => setEchec(true)} className={`${className} w-auto max-w-[200px] object-contain`} />;
  return <span aria-hidden className={`flex aspect-square items-center justify-center rounded bg-primary font-bold text-white ${className}`}>{(b.nom || '').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase() || 'Vd'}</span>;
}
