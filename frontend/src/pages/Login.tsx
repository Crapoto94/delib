import { FormEvent, useState } from 'react';
import { ThemeToggle } from '../theme';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { errMsg } from '../api';
import { ErrorBox, Spinner } from '../ui';
import { OrgLogo, useBranding, useFavicon } from '../Brand';

export default function Login() {
  const { me, login } = useAuth();
  const nav = useNavigate();
  // « Se souvenir de moi » : l'identifiant est conservé dans ce navigateur (jamais le mot de passe) et la session dure jusqu'à 6 mois, ou jusqu'à la déconnexion
  const memo = (() => { try { return localStorage.getItem('vd.login') || ''; } catch { return ''; } })();
  const [souvenir, setSouvenir] = useState(!!memo);
  const [u, setU] = useState(memo); const [p, setP] = useState(''); const [local, setLocal] = useState(false);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const brand = useBranding(); useFavicon(brand);
  if (me) return <Navigate to="/" replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await login(u, p, local, souvenir); try { if (souvenir) localStorage.setItem('vd.login', u.trim()); else localStorage.removeItem('vd.login'); } catch { /* stockage indisponible */ } nav('/'); } catch (x: any) { setErr(x?.response?.status === 401 ? 'Identifiant ou mot de passe incorrect.' : errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-gradient-to-br from-nav-from to-nav-to p-4">
      <div className="absolute right-3 top-3"><ThemeToggle className="text-white/80 hover:bg-white/10 hover:text-white" /></div>
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 border-t-4 border-t-action-solid p-8 shadow-float">
        <div className="text-center">
          <div className="mb-3 flex justify-center"><OrgLogo orgId={brand?.organismeId ?? null} nom={brand?.nom ?? 'Vd'} hasLogo={!!brand?.hasLogo} version={brand?.logoVersion ?? null} className="h-16" /></div>
          <h2>VibeDélib</h2><p className="text-mute">{brand?.nom ?? ''} · gestion des délibérations</p>
        </div>
        <ErrorBox msg={err} />
        <label className="block"><span className="label">{local ? 'Compte de secours' : 'Identifiant (compte Windows)'}</span>
          <input className="input" autoFocus={!memo} autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} required /></label>
        <label className="block"><span className="label">Mot de passe</span>
          <input className="input" type="password" autoFocus={!!memo} autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} required /></label>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={souvenir} onChange={(e) => setSouvenir(e.target.checked)} /> Se souvenir de moi <span className="text-mute">(reste connecté jusqu’à 6 mois, ou jusqu’à la déconnexion ; jamais le mot de passe)</span></label>
        <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />} Se connecter</button>
        <button type="button" className="w-full text-center text-[12px] text-mute underline" onClick={() => setLocal(!local)}>{local ? 'Retour à la connexion par annuaire' : 'Compte de secours local'}</button>
        <p className="border-t border-line pt-3 text-center text-[11px] leading-relaxed text-mute">
          <Link to="/cgu" className="underline hover:text-ink">Conditions générales d'utilisation</Link>
          <span aria-hidden> · </span>
          <Link to="/licence" className="underline hover:text-ink">Licence d'usage</Link>
        </p>
      </form>
    </div>
  );
}
