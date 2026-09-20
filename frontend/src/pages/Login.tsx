import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { errMsg } from '../api';
import { ErrorBox, Spinner } from '../ui';
import { OrgLogo, useBranding, useFavicon } from '../Brand';

export default function Login() {
  const { me, login } = useAuth();
  const nav = useNavigate();
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [local, setLocal] = useState(false);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const brand = useBranding(); useFavicon(brand);
  if (me) return <Navigate to="/" replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await login(u, p, local); nav('/'); } catch (x: any) { setErr(x?.response?.status === 401 ? 'Identifiant ou mot de passe incorrect.' : errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-soft p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-8">
        <div className="text-center">
          <div className="mb-3 flex justify-center"><OrgLogo orgId={brand?.organismeId ?? null} nom={brand?.nom ?? 'Vd'} hasLogo={!!brand?.hasLogo} version={brand?.logoVersion ?? null} className="h-16" /></div>
          <h2>VibeDélib</h2><p className="text-mute">{brand?.nom ?? ''} · gestion des délibérations</p>
        </div>
        <ErrorBox msg={err} />
        <label className="block"><span className="label">{local ? 'Compte de secours' : 'Identifiant (compte Windows)'}</span>
          <input className="input" autoFocus autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} required /></label>
        <label className="block"><span className="label">Mot de passe</span>
          <input className="input" type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} required /></label>
        <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />} Se connecter</button>
        <button type="button" className="w-full text-center text-[12px] text-mute underline" onClick={() => setLocal(!local)}>{local ? 'Retour à la connexion par annuaire' : 'Compte de secours local'}</button>
      </form>
    </div>
  );
}
