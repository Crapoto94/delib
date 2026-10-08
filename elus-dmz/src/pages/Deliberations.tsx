import { useEffect, useRef } from 'react';

export type Publication = 'deliberations' | 'arretes';

/**
 * Pages PUBLIQUES (sans connexion), nues, faites pour être incrustées dans une iframe :
 *  - /deliberations et /arretes : liste des derniers mois ;
 *  - /deliberations-recherche et /arretes-recherche : moteur de recherche, sans limite de durée.
 * L'affichage est assuré par un script autonome (deliberations-widget.js, arretes-widget.js) — le même que celui proposé sur les pages « -code » :
 * ce que l'on voit ici est exactement ce que l'on intègre.
 */
export default function Deliberations({ mode = 'liste', type = 'deliberations' }: { mode?: 'liste' | 'recherche'; type?: Publication }) {
  const zone = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const z = zone.current; if (!z) return;
    z.innerHTML = `<div id="${type}"></div>`;
    const s = document.createElement('script');
    s.src = new URL(`${type}-widget.js`, `${location.origin}/`).href; s.setAttribute('data-cible', `#${type}`); s.setAttribute('data-mode', mode);
    z.appendChild(s);
    return () => { z.innerHTML = ''; };
  }, [mode, type]);
  return <div ref={zone} className="px-1 py-1" />;
}
