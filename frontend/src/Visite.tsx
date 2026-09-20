import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, PartyPopper, X } from 'lucide-react';
import { api } from './api';
import { useAuth } from './auth';

/**
 * Visite guidée de première connexion (UX-20 à UX-24, D37) : ignorable à tout moment, rejouable (« Revoir la visite »),
 * pensée pour l'utilisateur de base (rédaction, circuit, assistant IA, validation), avancement enregistré côté serveur. Une nouvelle version repropose les « Nouveautés ».
 */
const TOUR_ID = 'first-login';
const VERSION = 2; // 2 : étapes « Mes actes » et « Bibliothèque » (UX-23 : les personnes ayant terminé la version 1 se voient reproposer la visite)

type Step = { id: string; badge: string; titre: string; texte: ReactNode; cible?: string; route?: string; action?: { label: string; code: 'entrainement' } };

const BADGES: Record<string, string> = { decouverte: '🧭 Explorateur', redaction: '✍️ Rédacteur', ia: '✨ Assistant IA', circuit: '🔁 Circuit', validation: '✅ Valideur' };

/** Petit encadré d'exemple, pour montrer à quoi ressemble un texte. */
const Exemple = ({ children }: { children: ReactNode }) => <div className="mt-2 rounded border-l-4 border-primary bg-soft px-3 py-2 text-[13px] italic text-slate-700">{children}</div>;
const Puce = ({ children, on }: { children: ReactNode; on?: boolean }) => <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${on ? 'bg-primary text-white' : 'bg-slate-100 text-slate-700'}`}>{children}</span>;

const STEPS: Step[] = [
  { id: 'bienvenue', badge: 'decouverte', titre: 'Bienvenue dans VibeDélib !', texte: <>VibeDélib sert à <b>rédiger une délibération</b>, la faire <b>relire et valider</b> par les bonnes personnes, puis la présenter au conseil. Cette visite dure quelques minutes et explique les notions de base, <b>sans jargon</b>. Vous pouvez la quitter à tout moment et la revoir depuis votre menu.</> },
  { id: 'tableau-de-bord', badge: 'decouverte', titre: 'Votre tableau de bord', cible: 'nav-dashboard', route: '/', texte: <>C’est votre page d’accueil : ce que <b>vous avez à faire aujourd’hui</b> (dossiers à valider, modifications demandées), vos dossiers en cours et les prochaines séances du conseil.</> },
  { id: 'dossiers', badge: 'redaction', titre: 'Un « dossier » = un acte à faire adopter', cible: 'nav-dossiers', route: '/dossiers', texte: <>Une délibération (ou tout autre acte) s’appelle ici un <b>dossier</b>. Cette page liste <b>« Mes dossiers »</b> (ceux que vous rédigez), ceux que vous <b>suivez</b> et tous ceux que vous avez le droit de voir.</> },
  { id: 'nouveau-dossier', badge: 'redaction', titre: 'Créer votre première délibération', cible: 'nouveau-dossier', route: '/dossiers', texte: <>Cliquez sur <b>« Nouveau dossier »</b>, choisissez le <b>type d’acte</b> (délibération, décision, arrêté…) et donnez un <b>titre clair</b> : c’est lui qui figurera à l’ordre du jour. Si des dossiers proches existent déjà, l’application vous les montre : profitez-en pour vous en inspirer. Votre dossier reste <b>brouillon</b> — personne d’autre ne le traite — tant que vous ne l’envoyez pas.</> },
  { id: 'fiche', badge: 'redaction', titre: 'La fiche du dossier', texte: <>Dans le dossier, la <b>fiche</b> résume l’essentiel : <b>matière</b> et <b>rubrique</b> (le classement de l’acte), <b>incidence financière</b> et montant, <b>élu rapporteur</b> (celui qui présentera le sujet), <b>séance visée</b> et date limite. Un indicateur de <b>complétude</b> vous dit ce qu’il manque avant de pouvoir envoyer.</> },
  { id: 'trois-textes', badge: 'redaction', titre: 'Les trois parties d’une délibération', texte: <>Une délibération se rédige en <b>trois parties</b> :
    <ul className="mt-2 list-disc space-y-1 pl-5">
      <li><b>L’exposé des motifs</b> : le « pourquoi ». Il explique le contexte à l’assemblée, en langage simple.</li>
      <li><b>Les visas et considérants</b> : la justification juridique. Les <b>visas</b> (« Vu… ») citent les textes sur lesquels l’acte s’appuie ; les <b>considérants</b> (« Considérant que… ») donnent les raisons de la décision.</li>
      <li><b>Le dispositif</b> : le « quoi ». Ce que le conseil décide, article par article.</li>
    </ul>
    <Exemple>Vu le code général des collectivités territoriales, article L2121-29 ;<br />Considérant que l’association organise des activités pour les jeunes ;<br /><b>Article 1</b> : une subvention de 12 000 € est accordée à l’association.</Exemple></> },
  { id: 'redaction', badge: 'redaction', titre: 'Rédiger avec le suivi des modifications', texte: <>Chaque partie s’écrit dans un <b>éditeur simple</b> (gras, listes, titres — comme dans un traitement de texte). Quand plusieurs personnes relisent, leurs changements sont <b>suivis</b> : une couleur par personne, avec l’auteur et la date. Vous <b>acceptez ou refusez</b> chaque modification, et rien ne se perd : toutes les <b>versions</b> restent consultables. Le bouton d’<b>aperçu</b> montre le document tel qu’il sera imprimé.</> },
  { id: 'annexes', badge: 'redaction', titre: 'Joindre des annexes', texte: <>Un contrat, un plan, un tableau financier ? Ajoutez-les en <b>annexes au format PDF</b>. Pour chacune, indiquez si elle peut être <b>communiquée aux élus</b>, <b>publiée</b> et <b>transmise</b> à la préfecture. Remplacer une annexe crée une <b>nouvelle version</b> ; l’ancienne reste consultable.</> },
  { id: 'ia-principe', badge: 'ia', titre: 'L’assistant IA : un relecteur, pas un auteur', texte: <>Sur un dossier, le panneau <b>Assistant IA</b> peut relire vos textes : <b>orthographe et typographie</b>, <b>style et clarté</b>, et <b>contrôle des visas et considérants</b> (un visa manque ? un visa est-il pertinent ?). Le bouton <b>« Vérifier les références »</b> contrôle, <b>sans IA</b>, que les textes cités (codes, lois, décrets, délibérations antérieures) existent et sont à jour dans la bibliothèque de visas de votre collectivité.
    <ul className="mt-2 list-disc space-y-1 pl-5">
      <li>Il <b>propose</b>, il ne décide jamais : chaque suggestion apparaît comme une <b>modification suivie</b> que vous acceptez ou refusez.</li>
      <li>Vous restez <b>seul responsable</b> du texte : relisez toujours ce qu’il propose, surtout sur le plan juridique.</li>
      <li>Ses consignes et son activation sont réglées par votre collectivité : si vous ne voyez pas un bouton, la fonction est désactivée.</li>
    </ul></> },
  { id: 'ia-usage', badge: 'ia', titre: 'Bien utiliser l’assistant IA', texte: <>Un bon réflexe : <b>rédigez d’abord</b> vos trois parties, puis lancez « Vérifier l’orthographe », ensuite « Améliorer le style », enfin « Contrôler les visas ». Le <b>contrôle complet</b> enchaîne les trois. Le traitement se fait en arrière-plan : vous pouvez continuer à travailler, une notification vous prévient. Vous copiez un ancien dossier ? L’assistant peut aussi <b>adapter le texte copié</b> au nouveau contexte.</> },
  { id: 'discussion', badge: 'redaction', titre: 'Discuter dans le dossier', texte: <>La section <b>Discussion</b> sert à échanger avec vos collègues sans quitter le dossier. Tapez <b>@</b> suivi d’un nom pour <b>mentionner</b> quelqu’un : il est prévenu. Fini les échanges de mails et de versions Word.</> },
  { id: 'circuit', badge: 'circuit', titre: 'Envoyer au circuit de validation', texte: <>Quand votre dossier est complet, cliquez sur <b>« Envoyer »</b>. Il suit alors un <b>circuit de validation</b>, étape par étape :
    <div className="mt-2 flex flex-wrap items-center gap-1 text-[12px]"><Puce on>Vous</Puce>→<Puce>Chef de service</Puce>→<Puce>Directeur</Puce>→<Puce>Juridique</Puce>→<Puce>DGA</Puce>→<Puce>DGS</Puce>→<Puce>Assemblées</Puce></div>
    <p className="mt-2">Une <b>frise</b> en haut du dossier montre où il en est et qui doit agir. Le circuit exact dépend de votre collectivité et du type d’acte.</p></> },
  { id: 'circuit-retour', badge: 'circuit', titre: 'Et si on vous demande une modification ?', texte: <>Un valideur peut <b>refuser avec un motif</b> ou demander une <b>modification</b> : le dossier <b>revient chez vous</b>, avec son commentaire et une notification. Vous corrigez, vous renvoyez, et le circuit reprend. Tant que le dossier est dans le circuit, <b>seule la personne dont c’est le tour</b> peut le modifier.</> },
  { id: 'validation', badge: 'validation', titre: 'Vous êtes valideur ? Voici votre rôle', texte: <>Un dossier qui attend votre avis apparaît dans <b>« À traiter »</b> sur votre tableau de bord. Vous voyez le texte, les <b>modifications des autres</b> et les annexes, puis vous <b>validez</b>, vous <b>refusez avec un motif</b> ou vous <b>déléguez</b>. Absent ? Créez une <b>délégation</b> (menu → « Mes délégations ») : quelqu’un valide à votre place pendant vos congés. Tout est <b>daté et tracé</b>.</> },
  { id: 'apres', badge: 'circuit', titre: 'Après la validation', texte: <>Une fois validé par tout le circuit, le dossier est <b>inscrit à l’ordre du jour</b> d’une séance par le service des assemblées. Vous suivez son statut sur la fiche : <b>adopté</b>, puis <b>transmis</b> à la préfecture. Vous n’avez rien d’autre à faire.</> },
  { id: 'mes-actes', badge: 'circuit', titre: 'Retrouver vos dossiers : « Mes actes »', cible: 'nav-mes-actes', route: '/mes-actes', texte: <>La rubrique <b>« Mes actes »</b> rassemble <b>tous les dossiers où vous avez eu un rôle</b> à un moment — rédacteur, valideur, remplaçant, ou simple commentaire —, même terminés ou non adoptés. Ouvrez le <b>trajet</b> d’un dossier pour voir son <b>circuit complet</b> (qui a validé, refusé, quand), les <b>modifications</b>, les <b>commentaires</b>, les <b>amendements</b> du conseil, le vote et la transmission.</> },
  { id: 'bibliotheque', badge: 'circuit', titre: 'Consulter les délibérations adoptées : la « Bibliothèque »', cible: 'nav-bibliotheque', route: '/bibliotheque', texte: <>La <b>Bibliothèque</b> est ouverte à tous les agents : une fois la séance close, vous y <b>recherchez</b> et <b>consultez</b> les délibérations adoptées de la collectivité — <b>texte</b>, <b>exposé des motifs</b>, <b>extrait du registre</b> — pour vous inspirer d’un précédent. C’est de la <b>consultation seule</b> : elle ne donne pas accès au parcours des dossiers, qui reste réservé à ceux qui y ont participé (« Mes actes »).</> },
  { id: 'recherche', badge: 'decouverte', titre: 'Retrouver n’importe quel acte', cible: 'recherche', texte: <>Cette barre cherche dans les <b>titres, les textes et les annexes</b>, même sans accents. Appuyez sur <kbd className="rounded border px-1">/</kbd> depuis n’importe quelle page. Essayez <code>"expression exacte"</code>, <code>-mot</code> pour exclure, ou un <b>numéro</b> de délibération.</> },
  { id: 'notifications', badge: 'decouverte', titre: 'La cloche et vos notifications', cible: 'notifications', texte: <>La cloche vous prévient de ce qui vous concerne : dossier à traiter, modification demandée, échéance qui approche. Dans <b>« Mes notifications »</b>, vous choisissez ce qui vous arrive aussi par mail et ce que vous préférez ne pas recevoir.</> },
  { id: 'menu', badge: 'decouverte', titre: 'Votre menu', cible: 'menu-utilisateur', route: '/', texte: <>Retrouvez ici vos <b>délégations</b>, vos <b>notifications</b> — et <b>« Revoir la visite »</b> quand vous voulez.</> },
  { id: 'entrainement', badge: 'redaction', titre: 'À vous de jouer : un dossier d’entraînement', action: { label: 'Ouvrir mon dossier d’entraînement', code: 'entrainement' }, texte: <>Rien de tel que d’essayer ! Nous vous préparons un <b>dossier d’exemple</b>, déjà rempli. C’est un <b>bac à sable</b> : il ne partira <b>jamais</b> dans un vrai circuit, personne n’est notifié, et il disparaît tout seul au bout de 14 jours.
    <p className="mt-2 font-semibold">Vos mini-défis :</p>
    <ol className="mt-1 list-decimal space-y-1 pl-5">
      <li>Ouvrez l’<b>exposé des motifs</b> et modifiez une phrase.</li>
      <li>Lancez « <b>Vérifier l’orthographe</b> » avec l’assistant IA, puis acceptez ou refusez une suggestion.</li>
      <li>Ajoutez un <b>commentaire</b> dans la discussion, avec une mention <b>@</b>.</li>
      <li>Regardez l’indicateur de <b>complétude</b> : que manque-t-il pour envoyer ?</li>
    </ol></> },
  { id: 'fin', badge: 'decouverte', titre: 'Bravo, vous êtes prêt·e !', texte: <>Vos badges sont ci-dessous. Pour vous lancer : <b>Actes & Dossiers → Nouveau dossier</b>. Et si vous hésitez, rejouez la visite quand vous voulez.</> },
];

const pourMoi = (_s: Step) => true; // la visite s'adresse à tout utilisateur de base : pas de parcours SCC ni administrateur

/** Boîte de la visite : projecteur sur l'élément visé, ou fenêtre centrée. */
function Boite({ etape, i, n, onPrev, onNext, onQuit, onAction, occupe }: { etape: Step; i: number; n: number; onPrev: () => void; onNext: () => void; onQuit: () => void; onAction: () => void; occupe: boolean }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const boite = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const mesurer = useCallback(() => {
    const el = etape.cible ? document.querySelector<HTMLElement>(`[data-tour="${etape.cible}"]`) : null;
    setRect(el ? el.getBoundingClientRect() : null);
  }, [etape.cible]);

  // l'élément visé peut apparaître après un changement de page : on réessaie brièvement
  useEffect(() => {
    let essais = 0; let t: number;
    const cherche = () => {
      const el = etape.cible ? document.querySelector<HTMLElement>(`[data-tour="${etape.cible}"]`) : null;
      if (el) { el.scrollIntoView({ block: 'center', behavior: 'auto' }); mesurer(); } else if (etape.cible && essais++ < 12) t = window.setTimeout(cherche, 100); else mesurer();
    };
    cherche();
    const h = () => mesurer(); window.addEventListener('resize', h); window.addEventListener('scroll', h, true);
    return () => { window.clearTimeout(t); window.removeEventListener('resize', h); window.removeEventListener('scroll', h, true); };
  }, [etape.id, mesurer]);

  useLayoutEffect(() => {
    if (!rect || !boite.current) { setPos(null); return; }
    const b = boite.current.getBoundingClientRect(); const m = 12;
    const dessous = rect.bottom + m + b.height < window.innerHeight;
    const top = dessous ? rect.bottom + m : Math.max(m, rect.top - m - b.height);
    const left = Math.min(Math.max(m, rect.left + rect.width / 2 - b.width / 2), window.innerWidth - b.width - m);
    setPos({ top, left });
  }, [rect, etape.id]);

  // clavier : Échap = quitter, flèches = naviguer
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onQuit(); else if (e.key === 'ArrowRight') onNext(); else if (e.key === 'ArrowLeft') onPrev(); };
    document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h);
  }, [onNext, onPrev, onQuit]);
  useEffect(() => { boite.current?.querySelector<HTMLElement>('[data-suivant]')?.focus(); }, [etape.id]);

  const centre = !rect;
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="visite-titre">
      {rect ? <div className="pointer-events-none fixed rounded-md ring-2 ring-white transition-all motion-reduce:transition-none" style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8, boxShadow: '0 0 0 9999px rgba(15,23,42,.6)' }} /> : <div className="fixed inset-0 bg-slate-900/60" />}
      <div ref={boite} className={`fixed max-h-[88vh] w-[min(92vw,30rem)] overflow-y-auto rounded-lg bg-surface p-5 shadow-float ${centre ? 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2' : ''}`} style={centre ? undefined : { top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-mute">Étape {i + 1} sur {n}</span>
          <button className="rounded p-1 text-mute hover:bg-soft" onClick={onQuit} aria-label="Quitter la visite"><X className="h-4 w-4" /></button>
        </div>
        <div className="mb-3 h-1.5 overflow-hidden rounded bg-soft" role="progressbar" aria-valuenow={i + 1} aria-valuemin={1} aria-valuemax={n}><div className="h-full bg-primary transition-all motion-reduce:transition-none" style={{ width: `${((i + 1) / n) * 100}%` }} /></div>
        <h2 id="visite-titre" className="mb-1 text-[17px]">{etape.titre}</h2>
        <div className="text-[14px] leading-relaxed text-slate-700">{etape.texte}</div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button className="text-[13px] text-mute hover:underline" onClick={onQuit}>Ignorer la visite</button>
          <div className="flex gap-2">
            {i > 0 && <button className="btn-secondary" onClick={onPrev}><ArrowLeft className="h-4 w-4" /> Précédent</button>}
            {etape.action && <button className="btn-secondary" disabled={occupe} onClick={onAction}>{etape.action.label}</button>}
            <button className="btn-primary" data-suivant onClick={onNext}>{i === n - 1 ? 'Terminer' : 'Suivant'} {i < n - 1 && <ArrowRight className="h-4 w-4" />}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Visite({ ouverte, onFermer }: { ouverte: boolean; onFermer: () => void }) {
  const { me, org, reload } = useAuth();
  const [occupe, setOccupe] = useState(false);
  const nav = useNavigate();
  const etapes = STEPS.filter(pourMoi);
  const [phase, setPhase] = useState<'accueil' | 'visite' | null>(null);
  const [i, setI] = useState(0);
  const [nouveautes, setNouveautes] = useState(false); const [reprise, setReprise] = useState(0);
  const [faites, setFaites] = useState<string[]>([]);
  const propose = !!me?.onboarding?.toShow?.some((t: any) => t.id === TOUR_ID);

  // proposition automatique (une fois par session) ; rejeu à la demande depuis le menu
  useEffect(() => {
    if (!propose || sessionStorage.getItem('visite-proposee')) return;
    sessionStorage.setItem('visite-proposee', '1');
    api.get('/me/onboarding').then((r) => {
      const t = (r.data.tours || []).find((x: any) => x.id === TOUR_ID);
      setNouveautes(!!t && t.version && t.version < VERSION);
      const done: string[] = t?.stepsDone || [];
      const k = t?.status === 'started' && t.version === VERSION ? etapes.findIndex((s) => !done.includes(s.id)) : 0;
      setReprise(k > 0 ? k : 0); setFaites(k > 0 ? done : []); setPhase('accueil');
    }).catch(() => undefined);
  }, [propose]);
  useEffect(() => { if (ouverte) { setNouveautes(false); setReprise(0); setFaites([]); setI(0); setPhase('accueil'); } }, [ouverte]);

  const enregistrer = useCallback(async (status: 'started' | 'completed' | 'skipped', stepsDone: string[]) => {
    try { await api.put(`/me/onboarding/${TOUR_ID}`, { version: VERSION, status, stepsDone }); if (status !== 'started') await reload(); } catch { /* la visite ne doit jamais gêner le travail */ }
  }, [reload]);

  const aller = (k: number) => { const s = etapes[k]; if (s?.route && window.location.pathname !== s.route && !(s.route === '/' && window.location.pathname === '/')) nav(s.route); setI(k); };
  const commencer = () => { setPhase('visite'); aller(reprise); enregistrer('started', faites); };
  const fermer = (statut: 'skipped' | 'completed', done: string[]) => { enregistrer(statut, done); setPhase(null); onFermer(); };
  const suivant = () => {
    const done = Array.from(new Set([...faites, etapes[i].id])); setFaites(done);
    if (i >= etapes.length - 1) return fermer('completed', etapes.map((s) => s.id));
    enregistrer('started', done); aller(i + 1);
  };
  const precedent = () => aller(Math.max(0, i - 1));
  /** Crée (ou retrouve) le dossier d'entraînement et y emmène : la visite reste « en cours » et se reprend là où on l'a laissée. */
  const agir = async () => {
    if (!org) return; setOccupe(true);
    try {
      const r = await api.post(`/organismes/${org.id}/entrainement`);
      const done = Array.from(new Set([...faites, etapes[i].id])); setFaites(done); await enregistrer('started', done);
      setPhase(null); onFermer(); nav(`/dossiers/${r.data.acteId}`);
    } catch { /* la visite ne doit jamais gêner le travail */ } finally { setOccupe(false); }
  };
  const quitter = () => fermer('skipped', faites);

  if (!phase) return null;
  if (phase === 'accueil') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true" aria-labelledby="visite-accueil">
        <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-float">
          <div className="mb-2 flex items-center gap-2 text-head"><PartyPopper className="h-6 w-6" /><span className="text-[12px] font-semibold uppercase tracking-wide">{nouveautes ? 'Nouveautés' : reprise ? 'Reprendre la visite' : 'Première connexion'}</span></div>
          <h2 id="visite-accueil" className="mb-2 text-[20px]">{nouveautes ? 'Du nouveau dans VibeDélib' : `Bienvenue${me?.displayName ? `, ${me.displayName.split(' ').slice(-1)[0]}` : ''} !`}</h2>
          <p className="text-slate-700">{nouveautes ? 'De nouvelles fonctions sont arrivées. Une visite rapide (2 minutes) vous les présente.' : 'Une visite guidée de 5 minutes vous montre l’essentiel, adaptée à vos rôles. Vous pouvez l’ignorer maintenant — elle reste disponible dans votre menu (« Revoir la visite »).'}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => fermer('skipped', faites)}>Plus tard</button>
            <button className="btn-primary" autoFocus onClick={commencer}>{reprise ? 'Reprendre' : 'C’est parti !'}</button>
          </div>
        </div>
      </div>
    );
  }
  const etape = etapes[i]; if (!etape) return null;
  if (etape.id === 'fin') {
    const gagnes = Array.from(new Set(etapes.filter((s) => s.id !== 'fin' && faites.includes(s.id)).map((s) => s.badge)));
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true" aria-labelledby="visite-titre">
        <div className="w-full max-w-md rounded-lg bg-surface p-6 text-center shadow-float">
          <PartyPopper className="mx-auto h-10 w-10 text-head" />
          <h2 id="visite-titre" className="mt-2 text-[20px]">{etape.titre}</h2>
          <p className="mt-1 text-slate-700">{etape.texte}</p>
          <ul className="mt-4 flex flex-wrap justify-center gap-2">{gagnes.map((b) => <li key={b} className="rounded-full bg-primary/10 px-3 py-1 text-[13px] font-semibold text-head">{BADGES[b]}</li>)}</ul>
          <div className="mt-5 flex justify-center gap-2"><button className="btn-secondary" onClick={precedent}>Précédent</button><button className="btn-primary" autoFocus onClick={suivant}>Terminer</button></div>
        </div>
      </div>
    );
  }
  return <Boite etape={etape} i={i} n={etapes.length} onPrev={precedent} onNext={suivant} onQuit={quitter} onAction={agir} occupe={occupe} />;
}
