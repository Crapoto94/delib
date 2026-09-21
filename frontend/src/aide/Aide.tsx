import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, ChevronDown, GraduationCap, HelpCircle, Sparkles } from 'lucide-react';
import { useAuth } from '../auth';
import { PageTitle } from '../ui';
import { ACCES_LABEL, ARTICLES, peutVoir } from './articles';
import { Article } from './ui';
import Documents from './Documents';
import AideIa from './AideIa';

export function useAideDisponible() {
  const { isAdmin, isScc } = useAuth();
  return ARTICLES.filter((a) => peutVoir(a, isScc, isAdmin));
}

export function AideMenu() {
  const { isAdmin, isScc } = useAuth();
  const dispo = ARTICLES.filter((a) => peutVoir(a, isScc, isAdmin));
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const surDossier = /^\/dossiers\/[^/]+/.test(pathname);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  return (
    <div className="relative" ref={ref}>
      <button className="flex items-center gap-1 rounded p-2 hover:bg-slate-100" aria-haspopup="menu" aria-expanded={open} aria-label="Aide" onClick={() => setOpen(!open)}>
        <HelpCircle className="h-5 w-5" />
        <span className="hidden text-[13px] font-semibold md:inline">Aide</span>
        <ChevronDown className="hidden h-4 w-4 md:block" />
      </button>
      {open && (
        <div role="menu" className="card absolute right-0 z-40 mt-2 w-80 p-1 shadow-float">
          <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-mute">Aides disponibles pour votre profil</div>
          <NavLink role="menuitem" to="/aide/ia" onClick={() => setOpen(false)} className="flex items-start gap-3 rounded px-3 py-2 hover:bg-soft">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-head" />
            <span><span className="block text-[13px] font-semibold text-ink">Evelyne Del-IA</span><span className="block text-[12px] text-mute">Posez une question : réponse fondée sur le manifeste.</span></span>
          </NavLink>
          {dispo.map((a) => (
            <NavLink key={a.code} role="menuitem" to={`/aide/${a.code}`} onClick={() => setOpen(false)} className="flex items-start gap-3 rounded px-3 py-2 hover:bg-soft">
              <a.Icone className="mt-0.5 h-4 w-4 shrink-0 text-head" />
              <span><span className="block text-[13px] font-semibold text-ink">{a.titre}</span><span className="block text-[12px] text-mute">{a.resume}</span></span>
            </NavLink>
          ))}
          <div className="mt-1 border-t border-line pt-1">
            {surDossier && (
              <button role="menuitem" onClick={() => { setOpen(false); window.dispatchEvent(new Event('vibedelib:guide-dossier')); }} className="flex w-full items-start gap-3 rounded px-3 py-2 text-left hover:bg-soft">
                <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-head" />
                <span><span className="block text-[13px] font-semibold text-ink">Réafficher le guide du dossier</span><span className="block text-[12px] text-mute">Evelyne Del-IA, l'assistant pas à pas de ce dossier.</span></span>
              </button>)}
            <Link role="menuitem" to="/aide" onClick={() => setOpen(false)} className="block rounded px-3 py-2 text-[13px] font-semibold text-action hover:bg-soft">Ouvrir le centre d'aide</Link>
          </div>
        </div>
      )}
    </div>
  );
}

function CarteArticle({ a }: { a: Article }) {
  return (
    <Link to={`/aide/${a.code}`} className="card group flex flex-col p-5 transition-shadow hover:shadow-lift">
      <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-head"><a.Icone className="h-5 w-5" /></span>
      <h3 className="mb-1">{a.titre}</h3>
      <p className="flex-1 text-[13px] leading-relaxed text-mute">{a.resume}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-action">Ouvrir l'aide <ArrowRight className="h-4 w-4" /></span>
    </Link>
  );
}

function Hub() {
  const dispo = useAideDisponible();
  const { isAdmin, isScc } = useAuth();
  return (
    <div>
      <PageTitle title="Centre d'aide" sub="Comment utiliser VibeDélib, expliqué simplement. Les aides affichées dépendent de votre profil." />
      <Link to="/aide/ia" className="card group mb-4 flex items-start gap-4 p-5 transition-shadow hover:shadow-lift">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-action/10 text-action"><Sparkles className="h-5 w-5" /></span>
        <span className="flex-1"><span className="block font-semibold text-ink">Evelyne Del-IA — poser une question</span><span className="mt-1 block text-[13px] leading-relaxed text-mute">Posez une question en langage courant : la réponse s'appuie sur le manifeste de l'application, et vous pouvez la noter.</span></span>
        <ArrowRight className="h-4 w-4 shrink-0 text-action" />
      </Link>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {dispo.map((a) => <CarteArticle key={a.code} a={a} />)}
      </div>
      {(isScc || isAdmin) && (
        <section className="card mt-6 p-5">
          <h2 className="mb-2">Deux familles de paramétrages</h2>
          <p className="mb-3 leading-relaxed text-slate-700">Pour éviter les confusions, l'application sépare nettement :</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-line p-4">
              <h3 className="mb-1">Paramétrages fonctionnels</h3>
              <p className="text-[13px] leading-relaxed text-mute">La vie du conseil : circuits de validation, titulaires, séances, commissions, élus, notifications, télétransmission. Ils sont confiés au <b>SCC</b> et décrits dans l'aide « Séances, commissions et documents ».</p>
            </div>
            <div className="rounded-lg border border-line p-4">
              <h3 className="mb-1">Paramétrages techniques</h3>
              <p className="text-[13px] leading-relaxed text-mute">L'infrastructure de l'outil : identité et logo, comptes et rôles, gabarits, champs personnalisés, référentiels, connexions externes, collectivités. Ils sont réservés aux <b>administrateurs</b> et décrits dans l'aide « Paramétrages techniques ».</p>
            </div>
          </div>
        </section>
      )}
      <p className="mt-6 flex items-center gap-2 text-[13px] text-mute"><BookOpen className="h-4 w-4" /> Une visite guidée est aussi disponible depuis votre menu : « Revoir la visite ».</p>
    </div>
  );
}

function Sommaire({ article, dispo }: { article: Article; dispo: Article[] }) {
  const i = dispo.findIndex((a) => a.code === article.code);
  const prec = dispo[i - 1];
  const suiv = dispo[i + 1];
  return (
    <div className="space-y-6">
      <nav className="card p-3" aria-label="Aides">
        <div className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wider text-mute">Les aides</div>
        {dispo.map((a) => (
          <NavLink key={a.code} to={`/aide/${a.code}`} className={({ isActive }) => `flex items-center gap-2 rounded px-2 py-1.5 text-[13px] font-semibold ${isActive ? 'bg-primary/10 text-head' : 'text-slate-700 hover:bg-soft'}`}>
            <a.Icone className="h-4 w-4" />{a.titre}
          </NavLink>
        ))}
      </nav>
      {article.sections.length > 0 && <nav className="card p-3" aria-label="Sommaire">
        <div className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wider text-mute">Sommaire</div>
        <ol className="space-y-0.5">
          {article.sections.map((s, k) => (
            <li key={s.id}>
              <button className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-[13px] text-slate-700 hover:bg-soft" onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                <span className="text-mute">{k + 1}.</span><span>{s.titre}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>}
      <nav className="flex items-center justify-between gap-2 text-[13px]">
        {prec ? <Link className="inline-flex items-center gap-1 font-semibold text-action" to={`/aide/${prec.code}`}><ArrowLeft className="h-4 w-4" /> {prec.titre}</Link> : <span />}
        {suiv && <Link className="inline-flex items-center gap-1 text-right font-semibold text-action" to={`/aide/${suiv.code}`}>{suiv.titre} <ArrowRight className="h-4 w-4" /></Link>}
      </nav>
    </div>
  );
}

function ArticlePage({ article, dispo }: { article: Article; dispo: Article[] }) {
  return (
    <div>
      <Link to="/aide" className="mb-4 inline-flex items-center gap-1 text-[13px] font-semibold text-action"><ArrowLeft className="h-4 w-4" /> Centre d'aide</Link>
      <div className="grid gap-8 lg:grid-cols-[18rem_1fr]">
        <aside className="order-2 lg:order-1"><div className="lg:sticky lg:top-28">{<Sommaire article={article} dispo={dispo} />}</div></aside>
        <article className="order-1 max-w-3xl lg:order-2">
          <div className="mb-6 flex items-start gap-3 border-b border-line pb-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-head"><article.Icone className="h-6 w-6" /></span>
            <div><h1 className="text-[26px] leading-tight">{article.titre}</h1><p className="mt-1 text-mute">{ACCES_LABEL[article.acces]}</p></div>
          </div>
          {article.intro}
          {article.document
            ? <Documents />
            : article.sections.map((s) => (
              <section key={s.id} className="scroll-mt-28 border-t border-line pt-5 first:border-t-0">
                <h2 id={s.id} className="scroll-mt-28 text-[20px]">{s.titre}</h2>
                <div className="mt-3">{s.bloc}</div>
              </section>
            ))}
        </article>
      </div>
    </div>
  );
}

export default function Aide() {
  const dispo = useAideDisponible();
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [pathname]);
  return (
    <Routes>
      <Route index element={<Hub />} />
      <Route path="ia" element={<AideIa />} />
      {dispo.map((a) => <Route key={a.code} path={a.code} element={<ArticlePage article={a} dispo={dispo} />} />)}
      <Route path="*" element={<Navigate to="/aide" replace />} />
    </Routes>
  );
}
