import { useEffect } from 'react';
import { HashRouter, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { PdfViewerHost } from '../PdfViewer';
import { api, session } from './api';
import { purger } from './docs';
import Accueil from './pages/Accueil';
import Seance from './pages/Seance';
import { Connexion, Invitation } from './pages/Acces';

function Cadre() {
  const nav = useNavigate();
  const elu = session.elu();
  useEffect(() => { if (!session.token()) nav('/connexion', { replace: true }); }, [nav]);
  const sortir = async () => { try { await api.post('/elus-auth/deconnexion'); } catch { /* déjà expirée */ } await purger(); session.clear(); nav('/connexion', { replace: true }); };
  if (!session.token()) return <Navigate to="/connexion" replace />;
  return (
    <div className="min-h-screen bg-page">
      <header className="flex h-14 items-center gap-3 border-b border-line bg-white px-4">
        <span className="font-bold text-primary">VibeDélib</span><span className="text-[13px] text-mute">Espace des élus</span>
        <span className="ml-auto hidden text-[13px] text-mute sm:inline">{elu?.nom}</span>
        <button className="rounded p-2 text-mute hover:bg-slate-100" onClick={sortir} aria-label="Me déconnecter" title="Me déconnecter"><LogOut className="h-5 w-5" /></button>
      </header>
      <Outlet />
      <PdfViewerHost />
    </div>
  );
}

/** Espace des élus : application autonome (web et APK). Routage par « # » : fonctionne tel quel dans l'APK et derrière n'importe quel serveur statique. */
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/connexion" element={<Connexion />} />
        <Route path="/invitation/:token" element={<Invitation />} />
        <Route element={<Cadre />}>
          <Route index element={<Accueil />} />
          <Route path="seances/:id" element={<Seance />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
