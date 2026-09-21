import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, Circle, CircleDot, GripVertical, GraduationCap, Info, ListChecks, MessageCircleQuestion, Minus, PartyPopper, Sparkles, Star, X } from 'lucide-react';
import { api, errMsg, org as orgPath } from './api';
import { useAuth } from './auth';
import { Badge, Spinner } from './ui';
import { useIa } from './useIa';
import { chargerExtraits } from './aideIa';

/** Nom de l'avatar d'aide. Modifiable ici : il apparaît partout (bulle, panneau). */
export const AVATAR_NOM = 'Evelyne Del-IA';
const AVATAR_ROLE = "assistant de rédaction";

/** Codes de complétude qui relèvent de la fiche (CRE-02) : si aucun ne manque, la fiche est complète. */
const CODES_FICHE = new Set(['titre', 'matiere', 'rubrique', 'nature', 'rapporteur', 'incidence_financiere', 'deliberation']);

/** Étapes qui correspondent à un texte : « Montrer » ouvre l'éditeur sur la bonne partie. */
const TEXTES = new Set(['expose', 'visas', 'dispositif']);

/** Fait clignoter un encadré pour montrer où agir. */
function flash(el: HTMLElement) {
  el.classList.add('ring-2', 'ring-action', 'rounded');
  window.setTimeout(() => el.classList.remove('ring-2', 'ring-action', 'rounded'), 1600);
}

/** Place le curseur dans le premier champ vide (sinon le premier champ) d'un encadré, pour saisir tout de suite. */
function focusChamp(box: HTMLElement | null) {
  if (!box) return;
  const champs = box.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
  const liste = [...champs];
  const vide = liste.find((f) => !String(f.value ?? '').trim());
  (vide ?? liste[0])?.focus();
}

type Etape = {
  id: string; titre: string; court: string; astuce: string;
  requise: boolean; faite: boolean; cible: string; conseillee?: boolean; action?: 'apercu';
};

/** Résumé de l'état du dossier : sert à calculer l'étape courante et à parler juste. */
type Etat = {
  etapes: Etape[]; courante: Etape | null; terminee: boolean; envoye: boolean; nbFaites: number; renvoi: boolean;
};

function construire(acte: any, passees: string[]): Etat {
  const missing = new Set<string>((acte.completude?.missing ?? []).map((m: any) => m.code));
  const manque = (p: (c: string) => boolean) => [...missing].some(p);
  const ficheFaite = !manque((c) => CODES_FICHE.has(c) || c.startsWith('champ_'));
  const exposeFaite = !missing.has('expose');
  const visasFaite = !manque((c) => c.startsWith('visas:'));
  const dispositifFaite = !manque((c) => c.startsWith('dispositif:'));
  const renvoi = acte.statut === 'modification_demandee';
  const envoye = !['brouillon', 'modification_demandee'].includes(acte.statut);
  const passe = (id: string) => passees.includes(id);

  const etapes: Etape[] = [
    {
      id: 'fiche', titre: 'Remplir la fiche du dossier', court: 'Fiche', requise: true, faite: ficheDoneSafe(ficheFaite, envoye), cible: '#fiche',
      astuce: "Commencez par la fiche : titre, domaine, rubrique, nature, élu rapporteur et incidence financière. C'est le portrait du dossier — tout le reste en découle. La séance visée (le conseil concerné) n'est qu'une proposition de votre part : c'est le SCC qui la validera et inscrira le dossier à l'ordre du jour. L'encadré « État de complétude », à droite, vous dit à tout moment ce qu'il reste à renseigner.",
    },
    {
      id: 'expose', titre: "Rédiger l'exposé des motifs", court: 'Exposé', requise: true, faite: exposeFaite || envoye, cible: '#textes',
      astuce: "Écrivez le « pourquoi » en langage simple : le contexte, le problème, ce que la collectivité veut faire. Visez 3 à 6 phrases claires plutôt qu'une page dense. En panne d'inspiration ou de formulation ? L'assistant IA (panneau « Assistant », dans l'éditeur) peut vous relire : orthographe, style plus clair, et il sait aussi adapter le texte d'un dossier existant — il propose, vous validez chaque changement.",
    },
    {
      id: 'visas', titre: 'Rédiger les visas et considérants', court: 'Visas', requise: true, faite: visasFaite || envoye, cible: '#textes',
      astuce: "Les « Vu… » citent les textes qui fondent la décision (code, loi, délibération précédente) ; les « Considérant que… » donnent les raisons. Un visa par base juridique, dans l'ordre du plus général au plus précis.",
    },
    {
      id: 'dispositif', titre: 'Écrire le dispositif (le délibéré)', court: 'Dispositif', requise: true, faite: dispositifFaite || envoye, cible: '#textes',
      astuce: "C'est ce que le conseil décide vraiment, article par article : « Article 1 : … ». Écrivez des phrases courtes et actionnables (qui, quoi, combien, quand).",
    },
    {
      id: 'annexes', titre: 'Joindre les annexes utiles', court: 'Annexes', requise: false, conseillee: true, faite: passe('annexes') || envoye, cible: '#annexes',
      astuce: "Un contrat, un devis, un plan ? Glissez-les en PDF. Pensez à dire pour chacune si elle est communicable aux élus et publiable — c'est important pour la suite.",
    },
    {
      id: 'relecture', titre: 'Relire et vérifier', court: 'Relecture', requise: false, conseillee: true, faite: passe('relecture') || envoye, cible: '#textes', action: 'apercu',
      astuce: "Relisez le dossier dans sa mise en page finale : « Ouvrir le dossier complet » affiche l'aperçu PDF. Vous pouvez aussi lancer l'assistant IA depuis l'éditeur (orthographe, style, visas) : il propose, vous décidez. Envie d'en discuter ? La section « Discussion », en bas de la fiche, ouvre un fil sur le dossier — mentionnez un collègue avec @.",
    },
    {
      id: 'envoi', titre: renvoi ? 'Corriger puis renvoyer' : 'Envoyer au circuit', court: 'Envoi', requise: true, faite: envoye, cible: '#actions',
      astuce: renvoi
        ? "Votre dossier revient avec une demande de modification : lisez le motif dans la discussion, corrigez, puis renvoyez-le au circuit."
        : "Quand l'état de complétude est vert, cliquez sur « Envoyer pour validation ». Votre dossier part alors vers les relecteurs, étape par étape.",
    },
  ];
  const courante = etapes.find((e) => !e.faite) ?? null;
  return { etapes, courante, terminee: !!envoye || !courante, envoye, nbFaites: etapes.filter((e) => e.faite).length, renvoi };
}

/** À l'envoi, on ne « coche » plus les étapes de rédaction : le dossier a quitté la rédaction. */
function ficheDoneSafe(ficheFaite: boolean, envoye: boolean) { return ficheFaite || envoye; }

/** L'avatar d'aide : une petite page souriante, sobre, dans la charte (aucun fichier externe). */
export function Mascotte({ className = 'h-8 w-8', humeur = 'neutre' }: { className?: string; humeur?: 'neutre' | 'content' }) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label={`${AVATAR_NOM}, ${AVATAR_ROLE}`} fill="none">
      <path d="M14 5h16l8 8v28a3 3 0 0 1-3 3H14a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z" className="fill-head" />
      <path d="M30 5v8h8" className="stroke-white/40" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="19.5" cy="25" r="3.1" fill="#fff" />
      <circle cx="30" cy="25" r="3.1" fill="#fff" />
      <circle cx="20.2" cy="25.7" r="1.3" className="fill-head" />
      <circle cx="30.7" cy="25.7" r="1.3" className="fill-head" />
      {humeur === 'content'
        ? <path d="M18.5 32.5q6 5.5 12 0" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        : <path d="M19.5 33.5h10" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />}
    </svg>
  );
}

/**
 * Mode « dossier assisté » : un avatar d'aide suit la rédaction et dit quoi faire à l'étape où l'on est,
 * avec des conseils. L'étape courante est déduite automatiquement de la complétude et du statut du dossier.
 * L'état (activé, étapes conseillées passées) est mémorisé côté serveur dans `custom.assiste`.
 */
export default function DossierAssiste({ acte, editable, onReload, onApercu, toast }: {
  acte: any; editable: boolean; onReload: () => void; onApercu?: () => void; toast: (m: string, k?: 'ok' | 'ko') => void;
}) {
  const { org } = useAuth(); const o = org!.id;
  const ia = useIa();
  const etatServeur = acte.custom?.assiste && typeof acte.custom.assiste === 'object' ? acte.custom.assiste : {};
  const passees: string[] = etatServeur.passees ?? [];
  const { etapes, courante, terminee, envoye, nbFaites } = construire(acte, passees);

  const [ouvert, setOuvert] = useState(true);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  // Question libre posée à Del-IA (réponse IA) et notation de la réponse.
  const [qOuvert, setQOuvert] = useState(false);
  const [question, setQuestion] = useState('');
  const [qBusy, setQBusy] = useState(false);
  const [qErr, setQErr] = useState<string | null>(null);
  const [reponse, setReponse] = useState<{ id: number | null; texte: string } | null>(null);
  const demander = async () => {
    const q = question.trim(); if (q.length < 3 || qBusy) return;
    setQBusy(true); setQErr(null); setReponse(null);
    try {
      const extraits = await chargerExtraits(q);
      const r = (await api.post(orgPath(o, '/ia/delia'), { question: q, extraits })).data;
      setReponse({ id: r.id ?? null, texte: r.reponse }); setQuestion('');
    } catch (x) { setQErr(errMsg(x)); } finally { setQBusy(false); }
  };
  const soumettre = (e: FormEvent) => { e.preventDefault(); void demander(); };
  // Position libre sur la fenêtre (déplaçable) : mémorisée localement, sinon ancrée en bas à droite.
  const CLE_POS = `vibedelib.assiste.pos.${acte.id}`;
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try { const s = localStorage.getItem(CLE_POS); if (!s) return null; const p = JSON.parse(s); return Number.isFinite(p?.x) && Number.isFinite(p?.y) ? p : null; } catch { return null; }
  });
  const glisse = useRef<{ dx: number; dy: number } | null>(null);
  const aBouge = useRef(false);
  useEffect(() => { try { if (pos) localStorage.setItem(CLE_POS, JSON.stringify(pos)); } catch { /* stockage indisponible : sans gravité */ } }, [pos, CLE_POS]);
  useEffect(() => { // garder le panneau dans la fenêtre quand on redimensionne
    const h = () => setPos((p) => (p ? { x: Math.min(p.x, window.innerWidth - 72), y: Math.min(p.y, window.innerHeight - 52) } : p));
    window.addEventListener('resize', h); return () => window.removeEventListener('resize', h);
  }, []);
  const demarrer = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return; // les boutons du bandeau restent cliquables
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    glisse.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }; aBouge.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const bouger = (e: React.PointerEvent) => {
    const g = glisse.current; if (!g) return;
    aBouge.current = true;
    setPos({ x: Math.min(Math.max(4, e.clientX - g.dx), window.innerWidth - 72), y: Math.min(Math.max(4, e.clientY - g.dy), window.innerHeight - 52) });
  };
  const relacher = () => { glisse.current = null; };
  const stylePos = pos ? { left: pos.x, top: pos.y } : undefined;

  // La pastille repliée est fermable ; on peut la rouvrir depuis la rubrique Aide (événement global).
  const CLE_MASQUE = `vibedelib.assiste.masque.${acte.id}`;
  const [masque, setMasque] = useState<boolean>(() => { try { return localStorage.getItem(CLE_MASQUE) === '1'; } catch { return false; } });
  useEffect(() => { try { if (masque) localStorage.setItem(CLE_MASQUE, '1'); else localStorage.removeItem(CLE_MASQUE); } catch { /* stockage indisponible : sans gravité */ } }, [masque, CLE_MASQUE]);
  useEffect(() => {
    const rouvrir = () => { setMasque(false); setOuvert(true); };
    window.addEventListener('vibedelib:guide-dossier', rouvrir);
    return () => window.removeEventListener('vibedelib:guide-dossier', rouvrir);
  }, []);

  // Féliciter à chaque étape franchie (engagement) et passer la zone de Del-IA au vert : « c'est bon, on avance ».
  const cleFaites = etapes.filter((e) => e.faite).map((e) => e.id).join(',');
  const faitesPrec = useRef<string | null>(null);
  const [felicite, setFelicite] = useState<string | null>(null);
  useEffect(() => {
    const prec = faitesPrec.current; faitesPrec.current = cleFaites;
    if (prec === null) return; // premier rendu : on ne félicite pas l'état déjà présent
    const avant = prec ? prec.split(',') : [];
    const nouvelles = etapes.filter((e) => e.faite && !avant.includes(e.id));
    if (!nouvelles.length) return;
    const derniere = nouvelles[nouvelles.length - 1];
    const i = etapes.findIndex((e) => e.id === derniere.id);
    const suivante = etapes.slice(i + 1).find((e) => !e.faite);
    setFelicite(suivante ? `Bravo, « ${derniere.court} » est faite ! On passe à « ${suivante.court} ».` : `Bravo, « ${derniere.court} » est faite ! Votre dossier est complet.`);
    const t = window.setTimeout(() => setFelicite(null), 7000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleFaites]);

  const envoyer = useCallback(async (patch: { actif?: boolean; passees?: string[]; bienvenue?: boolean }, msg?: string) => {
    setBusy(true);
    try {
      await api.put(orgPath(o, `/actes/${acte.id}/assiste`), patch);
      if (msg) toast(msg);
      onReload();
    } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); }
  }, [o, acte.id, onReload, toast]);

  // L'accueil se signale une seule fois : la première fois que l'on ouvre le panneau.
  useEffect(() => {
    if (ouvert && editable && !etatServeur.bienvenue) envoyer({ bienvenue: true }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert]);

  const montrer = (e: Etape) => {
    if (e.action === 'apercu') { onApercu?.(); setDetail(null); return; }
    const el = document.querySelector(e.cible) as HTMLElement | null;
    const box = (el?.closest('section, .card') as HTMLElement | null) ?? el;
    box?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (box) flash(box);
    if (TEXTES.has(e.id)) window.dispatchEvent(new CustomEvent('vibedelib:ouvrir-texte', { detail: { kind: e.id } }));
    else if (e.id === 'fiche') window.setTimeout(() => focusChamp(box), 400);
    setDetail(null);
  };
  const passer = (id: string) => envoyer({ passees: [...new Set([...passees, id])] }, 'Étape passée — le guide avance.');
  const reprendre = (id: string) => envoyer({ passees: passees.filter((p) => p !== id) });
  const arreter = () => envoyer({ actif: false }, "Le guide est coupé. Vous pouvez le réactiver depuis la fiche du dossier.");

  const progression = Math.round((nbFaites / etapes.length) * 100);
  const ok = !!felicite || terminee;
  const message = felicite ?? (terminee
    ? "Votre dossier est complet et parti au circuit. Bravo ! Vous pouvez couper le guide quand vous voulez."
    : courante!.astuce);

  if (masque) return null; // fermé : réouvrable depuis la rubrique Aide

  return (
    <>
      {!ouvert && (
        <div role="button" tabIndex={0} style={stylePos} onPointerDown={demarrer} onPointerMove={bouger} onPointerUp={relacher} onPointerCancel={relacher}
          onClick={() => { if (aBouge.current) return; setOuvert(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOuvert(true); } }}
          className={`fixed z-40 flex cursor-move touch-none items-center gap-2 rounded-full py-2 pl-2 pr-2 text-white shadow-float ${ok ? 'bg-ok-solid' : 'bg-head hover:bg-primary-hover'} ${pos ? '' : 'bottom-16 right-4 md:right-6'}`}
          title="Cliquez pour ouvrir, glissez pour déplacer" aria-label={`Ouvrir l'aide de ${AVATAR_NOM} (déplaçable)`}>
          <span className="relative">
            <Mascotte className="h-8 w-8" humeur="content" />
            {!ok && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-warn-solid" />}
          </span>
          <span className="pr-1 text-[13px] font-semibold">Besoin d'aide ?</span>
          <GripVertical className="h-4 w-4 shrink-0 text-white/70" aria-hidden="true" />
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setMasque(true); }}
            className="rounded p-1 hover:bg-white/15" aria-label="Fermer l'aide" title="Fermer l'aide (à rouvrir depuis Aide)">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {ouvert && (
        <div style={stylePos} className={`fixed z-40 flex w-[min(94vw,22rem)] max-h-[72vh] flex-col overflow-hidden rounded-lg bg-surface shadow-float ${pos ? '' : 'bottom-16 right-4 md:right-6'}`} role="region" aria-label="Dossier assisté">
          <div onPointerDown={demarrer} onPointerMove={bouger} onPointerUp={relacher} onPointerCancel={relacher} className={`flex cursor-move touch-none select-none items-center gap-2 border-b border-line px-3 py-2 text-white ${ok ? 'bg-ok-solid' : 'bg-gradient-to-r from-nav-from to-nav-to'}`}>
            <GripVertical className="h-4 w-4 shrink-0 text-white/70" aria-hidden="true" />
            <Mascotte className="h-8 w-8 shrink-0" humeur={ok ? 'content' : 'neutre'} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-[13px] font-bold">{AVATAR_NOM}</div>
              <div className="text-[11px] text-white/80">votre {AVATAR_ROLE}</div>
            </div>
            <button className="rounded p-1 hover:bg-white/15" onClick={() => setOuvert(false)} aria-label="Réduire l'aide"><Minus className="h-4 w-4" /></button>
            {editable && <button className="rounded p-1 hover:bg-white/15" onClick={arreter} disabled={busy} aria-label="Ne plus m'aider"><X className="h-4 w-4" /></button>}
          </div>

          <div className={`border-b border-line px-3 py-2 ${felicite ? 'bg-ok-bg' : 'bg-soft'}`}>
            <p className="flex items-start gap-2 text-[13px] leading-relaxed text-slate-700">
              {felicite && <PartyPopper className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />}
              <span>{message}</span>
            </p>
            {courante && !terminee && <p className="mt-1 text-[12px] font-semibold text-head">Étape {nbFaites + 1} sur {etapes.length} : {courante.titre}</p>}
          </div>

          <div className="flex items-start gap-2 border-b border-line bg-action/5 px-3 py-2 text-[11px] leading-snug text-slate-700">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-action" aria-hidden="true" />
            <span><b>Astuce :</b> l'<b>état de complétude</b> du dossier est affiché dans l'encadré « État de complétude », à droite de la fiche — il liste ce qu'il reste à renseigner.</span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-mute"><ListChecks className="h-3.5 w-3.5" /> Progression {progression}%</div>
            <div className="mb-3 h-1.5 overflow-hidden rounded bg-soft" role="progressbar" aria-valuenow={progression} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-action-solid transition-all motion-reduce:transition-none" style={{ width: `${progression}%` }} /></div>
            <ol className="space-y-1">
              {etapes.map((e, i) => {
                const activeEtape = courante?.id === e.id;
                return (
                  <li key={e.id}>
                    <div className={`rounded border ${activeEtape ? 'border-action bg-action/5' : 'border-line'} ${e.faite ? '' : activeEtape ? '' : 'opacity-80'}`}>
                      <button type="button" className="flex w-full items-start gap-2 p-2 text-left" onClick={() => setDetail(detail === e.id ? null : e.id)} aria-expanded={detail === e.id}>
                        {e.faite ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : activeEtape ? <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-action" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-mute" />}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className={`text-[13px] font-semibold ${e.faite ? 'text-mute line-through decoration-mute/40' : 'text-ink'}`}>{e.court}</span>
                            {e.conseillee && <Badge tone="gray">conseillé</Badge>}
                            {activeEtape && <Badge tone="blue">à faire</Badge>}
                          </span>
                          {i === 0 && <span className="block text-[11px] text-mute">{e.titre}</span>}
                        </span>
                        <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-mute transition-transform motion-reduce:transition-none ${detail === e.id ? 'rotate-180' : ''}`} />
                      </button>
                      {(detail === e.id || activeEtape) && (
                        <div className="border-t border-line px-2 py-2 text-[12px] text-slate-700">
                          <p className="leading-relaxed">{e.astuce}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <button type="button" className="btn-secondary !py-1 !text-[12px]" onClick={() => montrer(e)}>{e.action === 'apercu' ? 'Ouvrir le dossier complet' : 'Montrer'} <ArrowRight className="h-3.5 w-3.5" /></button>
                            {!e.requise && editable && !envoye && (
                              e.faite ? <button type="button" className="text-[12px] font-semibold text-action hover:underline" onClick={() => reprendre(e.id)} disabled={busy}>Reprendre</button>
                              : <button type="button" className="text-[12px] font-semibold text-action hover:underline" onClick={() => passer(e.id)} disabled={busy}>Passer cette étape</button>)}
                          </div>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          {ia.loaded && ia.aide && (
            <div className="border-t border-line px-3 py-2">
              <button type="button" onClick={() => setQOuvert(!qOuvert)} className="flex w-full items-center gap-2 text-left" aria-expanded={qOuvert}>
                <MessageCircleQuestion className="h-4 w-4 shrink-0 text-action" />
                <span className="min-w-0 flex-1 text-[13px] font-semibold">Poser une question</span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-mute transition-transform motion-reduce:transition-none ${qOuvert ? 'rotate-180' : ''}`} />
              </button>
              {qOuvert && (
                <div className="mt-2 space-y-2">
                  <form onSubmit={soumettre} className="flex items-end gap-2">
                    <textarea className="input !text-[13px]" rows={2} placeholder="Votre question…" value={question} onChange={(e) => setQuestion(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void demander(); } }} aria-label="Votre question" />
                    <button className="btn-primary !py-2" disabled={qBusy || question.trim().length < 3}>{qBusy && <Spinner />} Demander</button>
                  </form>
                  {qBusy && <p className="flex items-center gap-2 text-[12px] text-mute"><Spinner /> {AVATAR_NOM} réfléchit…</p>}
                  {qErr && <p role="alert" className="rounded border border-ko/30 bg-ko-bg px-2 py-1 text-[12px] text-ko">{qErr}</p>}
                  {reponse && (
                    <div className="rounded border border-line bg-soft p-2 text-[13px] leading-relaxed text-slate-700">
                      <p className="whitespace-pre-wrap">{reponse.texte}</p>
                      {reponse.id !== null && <NotationDelIa journalId={reponse.id} toast={toast} />}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-[11px] text-mute">
            <span className="flex items-center gap-1"><GraduationCap className="h-3.5 w-3.5" /> L'étape avance toute seule.</span>
            {editable && <button type="button" className="font-semibold text-action hover:underline" onClick={arreter} disabled={busy}>{busy && <Spinner />} Ne plus m'aider</button>}
          </div>
        </div>
      )}
    </>
  );
}

/** Notation d'une réponse de Del-IA : « Ma réponse vous a-t-elle convenu ? » (1 à 4 étoiles + commentaire). */
function NotationDelIa({ journalId, toast }: { journalId: number; toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const { org } = useAuth(); const o = org!.id;
  const [note, setNote] = useState(0); const [commentaire, setCommentaire] = useState('');
  const [busy, setBusy] = useState(false); const [fait, setFait] = useState(false);
  if (fait) return <p className="mt-2 text-[12px] font-semibold text-ok-text">Merci, votre avis a été enregistré.</p>;
  const LIBELLE: Record<number, string> = { 1: 'Pas du tout', 2: 'Peu', 3: 'Bien', 4: 'Très bien' };
  const envoyer = async () => {
    if (!note) return; setBusy(true);
    try { await api.post(orgPath(o, `/ia/delia/${journalId}/note`), { note, commentaire: commentaire.trim() || null }); setFait(true); toast('Merci pour votre retour'); }
    catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); }
  };
  return (
    <div className="mt-2 border-t border-line pt-2">
      <p className="text-[12px] font-semibold">Ma réponse vous a-t-elle convenu ?</p>
      <div className="mt-1 flex items-center gap-1" role="radiogroup" aria-label="Note de la réponse">
        {[1, 2, 3, 4].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={note === n} aria-label={`${n} étoile${n > 1 ? 's' : ''}`} onClick={() => setNote(n)}>
            <Star className={`h-5 w-5 ${n <= note ? 'fill-warn text-warn' : 'text-mute'}`} />
          </button>
        ))}
        <span className="ml-1 text-[11px] text-mute">{note ? LIBELLE[note] : '1 à 4 étoiles'}</span>
      </div>
      {note > 0 && (
        <div className="mt-2 space-y-2">
          <textarea className="input !text-[12px]" rows={2} placeholder="Commentaire (facultatif)…" value={commentaire} onChange={(e) => setCommentaire(e.target.value)} />
          <button type="button" className="btn-primary !py-1 !text-[12px]" disabled={busy} onClick={envoyer}>{busy && <Spinner />} Envoyer mon avis</button>
        </div>
      )}
    </div>
  );
}

/** Petit état de l'aide montré dans la fiche (aside) : invite à activer si le mode n'est pas actif, sinon rien. */
export function ActiverAssiste({ acte, editable, onReload, toast }: {
  acte: any; editable: boolean; onReload: () => void; toast: (m: string, k?: 'ok' | 'ko') => void;
}) {
  const { org } = useAuth(); const o = org!.id;
  const [busy, setBusy] = useState(false);
  const deja = acte.custom?.assiste?.actif;
  const enRedaction = ['brouillon', 'modification_demandee'].includes(acte.statut);
  if (!editable || deja || !enRedaction) return null;
  const activer = async () => {
    setBusy(true);
    try { await api.put(orgPath(o, `/actes/${acte.id}/assiste`), { actif: true }); toast(`Guide activé : ${AVATAR_NOM} vous suit pas à pas.`); onReload(); }
    catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); }
  };
  return (
    <div className="card flex items-start gap-3 p-4">
      <Mascotte className="h-9 w-9 shrink-0" humeur="content" />
      <div className="min-w-0 flex-1">
        <h3 className="text-[14px]">Dossier assisté</h3>
        <p className="mt-0.5 text-[12px] text-mute">Laissez {AVATAR_NOM} vous guider étape par étape dans la rédaction.</p>
        <button type="button" className="btn-secondary mt-2 !py-1 !text-[12px]" onClick={activer} disabled={busy}>{busy && <Spinner />} <Sparkles className="h-3.5 w-3.5" /> Activer l'aide</button>
      </div>
    </div>
  );
}
