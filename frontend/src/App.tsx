import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Loading } from './ui';
import Layout from './Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Recherche from './pages/Recherche';
import Dossiers from './pages/Dossiers';
import Dossier from './pages/Dossier';
import Admin from './pages/Admin';
import Seances from './pages/Seances';
import Commissions from './pages/Commissions';
import Teletransmission from './pages/Teletransmission';
import Delegations from './pages/Delegations';
import Preferences from './pages/Preferences';
import DevEditor from './pages/DevEditor';
import Aide from './aide/Aide';
import Nouveautes from './pages/Nouveautes';
import Bibliotheque from './pages/Bibliotheque';
import MesActes from './pages/MesActes';
import { lazy, Suspense } from 'react';
const DevAnnot = import.meta.env.DEV ? lazy(() => import('./elus/dev/DevAnnot')) : null;
const DevSeances = import.meta.env.DEV ? lazy(() => import('./dev/DevSeances')) : null;
const DevDesign = import.meta.env.DEV ? lazy(() => import('./dev/DevDesign')) : null;
import ConvocationPublique from './pages/ConvocationPublique';
import Legal from './pages/Legal';

export default function App() {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  return (
    <Routes>
      <Route path="/connexion" element={<Login />} />
      <Route path="/cgu" element={<Legal doc="cgu" />} />
      <Route path="/licence" element={<Legal doc="licence" />} />
      <Route path="/c/:token" element={<ConvocationPublique />} />
      {import.meta.env.DEV && <Route path="/dev/editeur" element={<DevEditor />} />}
      {DevAnnot && <Route path="/dev/annot" element={<Suspense fallback={null}><DevAnnot /></Suspense>} />}
      {DevSeances && <Route path="/dev/seances" element={<Suspense fallback={null}><DevSeances /></Suspense>} />}
      {DevDesign && <Route path="/dev/design" element={<Suspense fallback={null}><DevDesign /></Suspense>} />}
      <Route element={me ? <Layout /> : <Navigate to="/connexion" replace />}>
        <Route index element={<Dashboard />} />
        <Route path="recherche" element={<Recherche />} />
        <Route path="dossiers" element={<Dossiers />} />
        <Route path="bibliotheque" element={<Bibliotheque />} />
        <Route path="mes-actes/:id?" element={<MesActes />} />
        <Route path="dossiers/:id" element={<Dossier />} />
        <Route path="seances/*" element={<Seances />} />
        <Route path="commissions" element={<Commissions />} />
        <Route path="controle-legalite" element={<Teletransmission />} />
        <Route path="delegations" element={<Delegations />} />
        <Route path="preferences" element={<Preferences />} />
        <Route path="aide/*" element={<Aide />} />
        <Route path="nouveautes" element={<Nouveautes />} />
        <Route path="admin/*" element={<Admin />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
