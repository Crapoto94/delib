import { lazy, Suspense, useEffect, useState } from 'react';
import { HashRouter, Link, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { CalendarDays, Globe2, LogOut, RefreshCw, Search, Settings } from 'lucide-react';
import { api, instanceUrl, isNativeApp, session } from './api';
import { purger } from './docs';
import { rafraichir } from './refresh';
import Accueil from './pages/Accueil';
import Seance from './pages/Seance';
import { Connexion, Invitation } from './pages/Acces';
import Recherche from './pages/Recherche';
import Preferences from './pages/Preferences';
import Calendrier from './pages/Calendrier';
import { ThemeToggle } from './theme';
import Legal from './pages/Legal';
import EtatBackend, { PastilleBackend, sonderBackend } from './EtatBackend';
import { OrgLogo, useBranding, useFavicon } from './Brand';
import GroupePopover from './GroupePopover';
import MonParapheur from './MonParapheur';
import Instance from './Instance';
import MiseAJour from './MiseAJour';

const DevAnnot = import.meta.env.DEV ? lazy(() => import('./dev/DevAnnot')) : null;

function Cadre() {
  const nav = useNavigate();
  const elu = session.elu();
  useFavicon(useBranding());
  useEffect(() => { if (!session.token()) nav('/connexion', { replace: true }); }, [nav]);
  const sortir = async () => { try { await api.post('/elus-auth/deconnexion'); } catch { /* déjà expirée */ } await purger(); session.clear(); nav('/connexion', { replace: true }); };
  const [rafraichit, setRafraichit] = useState(false);
  const rafraichirDonnees = async () => { setRafraichit(true); rafraichir(); try { await sonderBackend(); } finally { setRafraichit(false); } };
  if (!session.token()) return <Navigate to="/connexion" replace />;
  return (
    <div className="min-h-screen bg-page">
      <header className="border-b border-primary-deep/40 bg-gradient-to-r from-nav-from to-nav-to text-white shadow-lift"><div className="accent-bar" aria-hidden="true" /><div className="flex h-14 items-center gap-3 px-4">
        <OrgLogo className="h-8 shrink-0" /><span className="hidden shrink-0 text-[13px] text-white/70 sm:inline">Espace élus</span>
        {elu?.groupe && <GroupePopover groupe={elu.groupe} moi={elu.nom} delegation={elu.delegation} />}
        <span className="ml-auto hidden shrink-0 text-[13px] text-white/80 sm:inline">{elu?.nom}</span>
        <button className="shrink-0 rounded p-2 text-white/80 hover:bg-white/10 hover:text-white" onClick={() => nav('/recherche')} aria-label="Rechercher" title="Rechercher une délibération"><Search className="h-5 w-5" /></button>
        <button className="shrink-0 rounded p-2 text-white/80 hover:bg-white/10 hover:text-white" onClick={() => nav('/calendrier')} aria-label="Mon calendrier" title="Mon calendrier"><CalendarDays className="h-5 w-5" /></button>
        <button className="shrink-0 rounded p-2 text-white/80 hover:bg-white/10 hover:text-white" onClick={rafraichirDonnees} aria-label="Rafraîchir les données" title="Rafraîchir les données"><RefreshCw className={`h-5 w-5 ${rafraichit ? 'animate-spin' : ''}`} /></button>
        <MonParapheur />
        <button className="shrink-0 rounded p-2 text-white/80 hover:bg-white/10 hover:text-white" onClick={() => nav('/preferences')} aria-label="Mes préférences" title="Mes préférences"><Settings className="h-5 w-5" /></button>
        {isNativeApp() && <button className="shrink-0 rounded p-2 text-white/80 hover:bg-white/10 hover:text-white" onClick={() => nav('/instance')} aria-label="Changer d’instance" title={`Instance : ${instanceUrl() || ''}`}><Globe2 className="h-5 w-5" /></button>}
        <button className="shrink-0 rounded p-2 text-white/80 hover:bg-white/10 hover:text-white" onClick={sortir} aria-label="Me déconnecter" title="Me déconnecter"><LogOut className="h-5 w-5" /></button>
      <ThemeToggle className="shrink-0 text-white/80 hover:bg-white/10 hover:text-white" /></div>
      </header>
      <EtatBackend />
      <Outlet />
      <footer className="mt-8 border-t border-line px-4 py-3 text-center text-[11px] text-mute">
        <Link to="/cgu" className="underline hover:text-ink">Conditions générales d'utilisation</Link>
        <span aria-hidden> · </span>
        <Link to="/licence" className="underline hover:text-ink">Licence d'usage</Link>
        <span aria-hidden> · </span>
        <PastilleBackend />
      </footer>
    </div>
  );
}

/** Espace des élus : application autonome (web et APK). Routage par « # » : fonctionne tel quel dans l'APK et derrière n'importe quel serveur statique. */
function AppRoutes() {
  const nav = useNavigate();
  const [instanceChoisie, setInstanceChoisie] = useState(() => !isNativeApp() || !!instanceUrl());
  const instanceEnregistree = () => { setInstanceChoisie(true); nav('/connexion', { replace: true }); };
  if (!instanceChoisie) return <Instance onSaved={instanceEnregistree} />;
  return (
      <>
      {/* APK installée : propose la nouvelle version dès qu'elle est publiée sur l'instance */}
      <MiseAJour />
      <Routes>
        <Route path="/connexion" element={<Connexion />} />
        <Route path="/invitation/:token" element={<Invitation />} />
        <Route path="/instance" element={isNativeApp() ? <Instance onSaved={instanceEnregistree} /> : <Navigate to="/connexion" replace />} />
        <Route path="/cgu" element={<Legal doc="cgu" />} />
        <Route path="/licence" element={<Legal doc="licence" />} />
        {DevAnnot && <Route path="/dev/annot" element={<Suspense fallback={null}><DevAnnot /></Suspense>} />}
        <Route element={<Cadre />}>
          <Route index element={<Accueil />} />
          <Route path="seances/:id" element={<Seance />} />
          <Route path="recherche" element={<Recherche />} />
          <Route path="calendrier" element={<Calendrier />} />
          <Route path="preferences" element={<Preferences />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </>
  );
}

export default function App() { return <HashRouter><AppRoutes /></HashRouter>; }
