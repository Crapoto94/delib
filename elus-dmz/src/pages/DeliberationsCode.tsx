import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { Publication } from './Deliberations';

/** Copie un texte dans le presse-papiers ; le bouton confirme pendant deux secondes. */
function Copier({ texte }: { texte: string }) {
  const [ok, setOk] = useState(false);
  const copier = async () => { try { await navigator.clipboard.writeText(texte); setOk(true); setTimeout(() => setOk(false), 2000); } catch { /* presse-papiers indisponible : sélectionner le code à la main */ } };
  return <button className="btn-secondary !py-1" onClick={copier}>{ok ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {ok ? 'Copié' : 'Copier'}</button>;
}

const TEXTES: Record<Publication, { liste: [string, string]; recherche: [string, string]; menu: string }> = {
  deliberations: {
    liste: ['Code d’affichage des délibérations', 'Délibérations exécutoires des derniers mois, une rupture par séance du conseil, extrait du registre et annexes publiables (jamais l’exposé des motifs).'],
    recherche: ['Code du moteur de recherche des délibérations', 'Moteur de recherche des délibérations exécutoires, sans limite de durée : séance, rapporteur, thématique, dates et texte du titre et/ou du corps. Jamais l’exposé des motifs.'],
    menu: 'délibérations',
  },
  arretes: {
    liste: ['Code d’affichage des arrêtés', 'Arrêtés signés des derniers mois, une rupture par mois, arrêté en PDF et annexes publiables.'],
    recherche: ['Code du moteur de recherche des arrêtés', 'Moteur de recherche des arrêtés signés, sans limite de durée : texte de l’objet ou numéro, année et dates.'],
    menu: 'arrêtés',
  },
};

/**
 * Code qui affiche les délibérations ou les arrêtés sur un autre site : l'extrait à coller, le script complet tel qu'il est servi,
 * et un aperçu qui l'exécute. `mode` : liste des derniers mois, ou moteur de recherche.
 */
export default function DeliberationsCode({ mode = 'liste', type = 'deliberations' }: { mode?: 'liste' | 'recherche'; type?: Publication }) {
  const base = `${location.origin}${location.pathname.replace(/\/(deliberations|arretes)(-recherche)?-code\/?$/, '')}`.replace(/\/+$/, '');
  const recherche = mode === 'recherche'; const t = TEXTES[type]; const [titre, texte] = recherche ? t.recherche : t.liste;
  const fichier = `${type}-widget.js`;
  const extrait = `<div id="${type}"></div>\n<script src="${base}/${fichier}" data-cible="#${type}"${recherche ? ' data-mode="recherche"' : ''}></script>`;
  const [source, setSource] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const apercu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fetch(`${base}/${fichier}`, { cache: 'no-cache' }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))).then(setSource).catch(() => setErr('Script indisponible.'));
  }, [base, fichier]);
  // Aperçu : le script réel, exécuté ici comme sur le site qui l'intègre.
  useEffect(() => {
    const zone = apercu.current; if (!zone) return;
    zone.innerHTML = '<div id="vd-apercu"></div>';
    const s = document.createElement('script'); s.src = `${base}/${fichier}`; s.setAttribute('data-cible', '#vd-apercu'); if (recherche) s.setAttribute('data-mode', 'recherche'); zone.appendChild(s);
    return () => { zone.innerHTML = ''; };
  }, [base, fichier, recherche]);
  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="mb-1 text-xl font-bold text-head">{titre}</h1>
      <p className="mb-5 text-[13px] text-mute">
        {texte} À activer dans Paramétrage › Mise à disposition et affichage ({t.menu}).
        {' '}Version en iframe : <code>{base}/{type}{recherche ? '-recherche' : ''}</code>.
      </p>

      <div className="mb-1 flex items-center justify-between"><h2 className="text-[15px] font-semibold text-head">1. À coller dans la page de votre site</h2><Copier texte={extrait} /></div>
      <pre className="mb-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-surface p-4 text-[12px] shadow-card">{extrait}</pre>
      <p className="mb-6 text-[12px] text-mute">Options du script : <code>data-par-page</code> (1 à 50, 10 par défaut){recherche ? '' : <>, <code>data-mois</code> (période, dans la limite réglée)</>}, <code>data-cible</code> (élément qui reçoit le résultat), <code>data-mode</code> (<code>liste</code> ou <code>recherche</code>).</p>

      <div className="mb-1 flex items-center justify-between"><h2 className="text-[15px] font-semibold text-head">2. Le script ({fichier})</h2>{source && <Copier texte={source} />}</div>
      {err ? <p role="alert" className="text-ko">{err}</p> : <pre className="mb-6 max-h-[480px] overflow-auto rounded bg-surface p-4 text-[12px] shadow-card" data-testid="source">{source ?? 'Chargement…'}</pre>}

      <h2 className="mb-2 text-[15px] font-semibold text-head">Aperçu</h2>
      <div ref={apercu} className="rounded border border-line bg-white p-4" />
    </main>
  );
}
