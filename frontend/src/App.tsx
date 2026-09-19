import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Loading } from './ui';
import Layout from './Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Dossiers from './pages/Dossiers';
import Dossier from './pages/Dossier';
import Admin from './pages/Admin';
import Seances from './pages/Seances';
import Commissions from './pages/Commissions';
import Delegations from './pages/Delegations';
import Preferences from './pages/Preferences';

export default function App() {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  return (
    <Routes>
      <Route path="/connexion" element={<Login />} />
      <Route element={me ? <Layout /> : <Navigate to="/connexion" replace />}>
        <Route index element={<Dashboard />} />
        <Route path="dossiers" element={<Dossiers />} />
        <Route path="dossiers/:id" element={<Dossier />} />
        <Route path="seances/*" element={<Seances />} />
        <Route path="commissions" element={<Commissions />} />
        <Route path="delegations" element={<Delegations />} />
        <Route path="preferences" element={<Preferences />} />
        <Route path="admin/*" element={<Admin />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
