import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, PartyPopper, X } from 'lucide-react';
import { api } from './api';
import { useAuth } from './auth';

/**
 * Visite guidée de première connexion (UX-20 à UX-24, D37) : ignorable à tout moment, rejouable (« Revoir la visite »),
 * adaptée aux rôles réels de la personne, avancement enregistré côté serveur. Une nouvelle version repropose les « Nouveautés ».
 */
const TOUR_ID = 'first-login';
const VERSION = 1;

type Step = { id: string; badge: string; titre: string; texte: ReactNode; cible?: string; route?: string; pour?: 'scc' | 'admin' };

const BADGES: Record<string, string> = { decouverte: '🧭 Explorateur', redaction: '✍️ Rédacteur', validation: '✅ Valideur', seances: '🗓️ Maître des séances', parametrage: '⚙️ Paramétreur' };

const STEPS: Step[] = [
  { id: 'bienvenue', badge: 'decouverte', titre: 'Bienvenue dans VibeDélib !', texte: <>En quelques minutes, vous saurez tout faire : <b>rédiger</b> une délibération, la <b>faire valider</b>, la retrouver. Vous pouvez <b>quitter la visite</b> à tout moment et la <b>revoir</b> depuis votre menu.</> },
  { id: 'tableau-de-bord', badge: 'decouverte', titre: 'Votre tableau de bord', cible: 'nav-dashboard', route: '/', texte: <>C’est votre point de départ : ce que <b>vous devez traiter aujourd’hui</b>, vos dossiers en cours et les prochaines séances.</> },
  { id: 'dossiers', badge: 'redaction', titre: 'Actes & Dossiers', cible: 'nav-dossiers', route: '/dossiers', texte: <>Tous vos actes sont ici : <b>« Mes dossiers »</b>, ceux que vous suivez, et tous ceux que vous avez le droit de voir.</> },
  { id: 'nouveau-dossier', badge: 'redaction', titre: 'Créer votre première délibération', cible: 'nouveau-dossier', route: '/dossiers', texte: <>Un clic sur <b>« Nouveau dossier »</b>, un type d’acte, un titre clair : c’est parti. Si des actes proches existent déjà, VibeDélib vous les montre pour vous en inspirer.</> },
  { id: 'redaction', badge: 'redaction', titre: 'Rédiger, annexer, envoyer', texte: <>Dans un dossier, vous rédigez l’<b>exposé</b>, les <b>visas</b> et le <b>dispositif</b> avec un éditeur simple. Les modifications de chacun sont <b>suivies</b> (qui, quand), vous ajoutez vos <b>annexes PDF</b>, puis vous <b>envoyez au circuit</b> de validation.</> },
  { id: 'validation', badge: 'validation', titre: 'Valider, refuser, déléguer', texte: <>Un dossier vous attend ? Il apparaît dans <b>« À traiter »</b>. Vous pouvez <b>valider</b>, <b>refuser avec un motif</b>, ou <b>déléguer</b> pendant vos congés (menu → « Mes délégations »). Tout est <b>daté et tracé</b>.</> },
  { id: 'recherche', badge: 'decouverte', titre: 'Retrouver n’importe quel acte', cible: 'recherche', texte: <>Cette barre cherche dans les <b>titres, textes et annexes</b>, même sans accents. Appuyez sur <kbd className="rounded border px-1">/</kbd> depuis n’importe quelle page. Essayez <code>"expression exacte"</code>, <code>-mot</code> ou un <b>numéro</b> de délibération.</> },
  { id: 'notifications', badge: 'decouverte', titre: 'Cloche et notifications', cible: 'notifications', texte: <>La cloche vous prévient de ce qui vous concerne. Vous choisissez, dans <b>« Mes notifications »</b>, ce qui vous arrive aussi par mail et ce que vous préférez ne pas recevoir.</> },
  { id: 'seances', badge: 'seances', titre: 'Séances & ordre du jour', cible: 'nav-seances', route: '/seances', pour: 'scc', texte: <>Vous préparez ici les séances : <b>ordre du jour</b> numéroté, convocation, <b>cahier de séance</b>, puis le <b>suivi en direct</b> (présences, pouvoirs, votes) et le procès-verbal.</> },
  { id: 'commissions', badge: 'seances', titre: 'Commissions', cible: 'nav-commissions', route: '/commissions', pour: 'scc', texte: <>Mise à disposition des dossiers aux commissions, <b>avis</b> des élus et calendrier des réunions.</> },
  { id: 'controle-legalite', badge: 'seances', titre: 'Contrôle de légalité', cible: 'nav-cdl', route: '/controle-legalite', pour: 'scc', texte: <>Après la séance, les délibérations adoptées sont <b>télétransmises</b> à la préfecture ; vous suivez ici les accusés de réception et les retours.</> },
  { id: 'parametrages', badge: 'parametrage', titre: 'Paramétrages', cible: 'nav-admin', route: '/admin', pour: 'admin', texte: <>Utilisateurs et rôles, circuits, gabarits PDF, notifications, assistant IA, espace élus, télétransmission, GED, recherche : tout se règle ici.</> },
  { id: 'menu', badge: 'decouverte', titre: 'Votre menu', cible: 'menu-utilisateur', route: '/', texte: <>Retrouvez ici vos <b>délégations</b>, vos <b>notifications</b> — et <b>« Revoir la visite »</b> quand vous voulez.</> },
  { id: 'fin', badge: 'decouverte', titre: 'Bravo, vous êtes prêt·e !', texte: <>Vos badges sont ci-dessous. Bonne rédaction — et n’hésitez pas à rejouer la visite.</> },
];

const pourMoi = (s: Step, isScc: boolean, isAdmin: boolean) => !s.pour || (s.pour === 'scc' && isScc) || (s.pour === 'admin' && isAdmin);

/** Boîte de la visite : projecteur sur l'élément visé, ou fenêtre centrée. */
function Boite({ etape, i, n, onPrev, onNext, onQuit }: { etape: Step; i: number; n: number; onPrev: () => void; onNext: () => void; onQuit: () => void }) {
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
      <div ref={boite} className={`fixed w-[min(92vw,26rem)] rounded-lg bg-white p-5 shadow-float ${centre ? 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2' : ''}`} style={centre ? undefined : { top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}>
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
            <button className="btn-primary" data-suivant onClick={onNext}>{i === n - 1 ? 'Terminer' : 'Suivant'} {i < n - 1 && <ArrowRight className="h-4 w-4" />}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Visite({ ouverte, onFermer }: { ouverte: boolean; onFermer: () => void }) {
  const { me, isScc, isAdmin, reload } = useAuth();
  const nav = useNavigate();
  const etapes = STEPS.filter((s) => pourMoi(s, isScc, isAdmin));
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
  const quitter = () => fermer('skipped', faites);

  if (!phase) return null;
  if (phase === 'accueil') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true" aria-labelledby="visite-accueil">
        <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-float">
          <div className="mb-2 flex items-center gap-2 text-primary"><PartyPopper className="h-6 w-6" /><span className="text-[12px] font-semibold uppercase tracking-wide">{nouveautes ? 'Nouveautés' : reprise ? 'Reprendre la visite' : 'Première connexion'}</span></div>
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
        <div className="w-full max-w-md rounded-lg bg-white p-6 text-center shadow-float">
          <PartyPopper className="mx-auto h-10 w-10 text-primary" />
          <h2 id="visite-titre" className="mt-2 text-[20px]">{etape.titre}</h2>
          <p className="mt-1 text-slate-700">{etape.texte}</p>
          <ul className="mt-4 flex flex-wrap justify-center gap-2">{gagnes.map((b) => <li key={b} className="rounded-full bg-primary/10 px-3 py-1 text-[13px] font-semibold text-primary">{BADGES[b]}</li>)}</ul>
          <div className="mt-5 flex justify-center gap-2"><button className="btn-secondary" onClick={precedent}>Précédent</button><button className="btn-primary" autoFocus onClick={suivant}>Terminer</button></div>
        </div>
      </div>
    );
  }
  return <Boite etape={etape} i={i} n={etapes.length} onPrev={precedent} onNext={suivant} onQuit={quitter} />;
}
