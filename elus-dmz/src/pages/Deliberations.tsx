import { useEffect, useRef } from 'react';

/**
 * Pages PUBLIQUES (sans connexion), nues, faites pour être incrustées dans une iframe :
 *  - /deliberations : délibérations exécutoires des derniers mois ;
 *  - /deliberations-recherche : moteur de recherche (séance, rapporteur, thématique, dates, texte du titre et/ou du corps), sans limite de durée.
 * L'affichage est assuré par deliberations-widget.js — le même script que celui proposé sur les pages « -code » : ce que l'on voit ici est exactement ce que l'on intègre.
 */
export default function Deliberations({ mode = 'liste' }: { mode?: 'liste' | 'recherche' }) {
  const zone = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const z = zone.current; if (!z) return;
    z.innerHTML = '<div id="deliberations"></div>';
    const s = document.createElement('script');
    s.src = new URL('deliberations-widget.js', `${location.origin}/`).href; s.setAttribute('data-cible', '#deliberations'); s.setAttribute('data-mode', mode);
    z.appendChild(s);
    return () => { z.innerHTML = ''; };
  }, [mode]);
  return <div ref={zone} className="px-1 py-1" />;
}
