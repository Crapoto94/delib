import { FormEvent, ReactNode, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, deviceId, errMsg, session } from '../api';
import { ThemeToggle } from '../theme';
import EtatBackend from '../EtatBackend';
import TabletFrame from '../TabletFrame';
import { OrgLogo, useBranding, useFavicon } from '../Brand';
import { isNativeApp } from '../api';

const Cadre = ({ titre, children }: { titre: string; children: ReactNode }) => {
  useFavicon(useBranding());
  return (
    <div className="relative flex min-h-full items-center justify-center bg-gradient-to-br from-nav-from to-nav-to px-4 py-6">
      <div className="absolute right-3 top-3"><ThemeToggle className="text-white/80 hover:bg-white/10 hover:text-white" /></div>
      <div className="w-full max-w-md rounded-xl border border-line border-t-4 border-t-action-solid bg-surface p-6 shadow-float">
        <div className="mb-5 text-center"><OrgLogo className="mx-auto mb-2 h-12" /><div className="text-[13px] font-semibold uppercase tracking-widest text-mute">Espace élus</div><h1 className="mt-1 text-[24px]">{titre}</h1></div>
        <EtatBackend />
        {children}
        {/* utile pour vérifier que la DMZ et le LAN servent bien la même version (deux chemins de déploiement distincts) */}
        <p className="mt-4 text-center text-[11px] text-mute">v{__APP_VERSION__} · build {__BUILD_TIME__.slice(0, 16).replace('T', ' ')}</p>
      </div>
    </div>
  );
};
const Err = ({ msg }: { msg: string | null }) => (msg ? <div role="alert" className="mb-3 rounded border border-ko/30 bg-ko-bg px-3 py-2 text-[14px] text-ko">{msg}</div> : null);
const champ = 'input !py-3 !text-[16px]';

/** Connexion directe avec l'identifiant et le mot de passe Ville. */
export function Connexion() {
  const nav = useNavigate();
  const memo = (() => { try { return localStorage.getItem('elus.email') || ''; } catch { return ''; } })();
  const [souvenir, setSouvenir] = useState(!!memo);
  const [email, setEmail] = useState(memo); const [mdp, setMdp] = useState('');
  const [oubli, setOubli] = useState(false); const [challenge, setChallenge] = useState<string | null>(null); const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const fin = (r: any) => { try { if (souvenir) localStorage.setItem('elus.email', email.trim()); else localStorage.removeItem('elus.email'); } catch { /* stockage indisponible */ } session.set({ token: r.token, expiresAt: r.expiresAt, elu: r.elu }); nav('/', { replace: true }); };
  const etape1 = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null); setMsg(null);
    try {
      const r = (await api.post('/elus-auth/connexion', { identifiant: email, motDePasse: mdp, appareil: deviceId() })).data;
      fin(r.session || r);
    }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  const demanderCode = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null); setMsg(null);
    try {
      const r = (await api.post('/elus-auth/oubli-sms', { email })).data;
      setChallenge(r.challenge); setCode('');
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  const validerCode = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { fin((await api.post('/elus-auth/oubli-sms/code', { challenge, code: code.trim(), appareil: deviceId() })).data); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <TabletFrame>
      <Cadre titre="Connexion">
        <Err msg={err} />{msg && <div className="mb-3 rounded bg-ok-bg px-3 py-2 text-[14px] text-ok-text">{msg}</div>}
          {oubli ? (challenge ? (
            <form onSubmit={validerCode} className="space-y-3">
              <p className="text-[14px] text-mute">Si un compte correspond à cette adresse et qu’un numéro est enregistré, un code vient d’être envoyé par SMS. Il est valable 5 minutes.</p>
              <label className="block"><span className="label">Code reçu par SMS</span><input className={`${champ} text-center tracking-[0.5em]`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></label>
              <button className="btn-primary w-full !py-3 !text-[16px]" disabled={busy || code.length !== 6}>Me connecter</button>
              <button type="button" className="w-full text-center text-[13px] text-mute" onClick={() => { setChallenge(null); setCode(''); }}>← Retour</button>
            </form>
          ) : (
            <form onSubmit={demanderCode} className="space-y-3">
              <p className="text-[14px] text-mute">Un code sera envoyé par SMS au numéro enregistré pour votre compte. Ce code permet de vous connecter sans changer votre mot de passe Ville.</p>
              <label className="block"><span className="label">Adresse e-mail</span><input className={champ} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
              <button className="btn-primary w-full !py-3 !text-[16px]" disabled={busy}>Recevoir un code par SMS</button>
              <button type="button" className="w-full text-center text-[13px] text-mute" onClick={() => { setOubli(false); setErr(null); }}>← Retour à la connexion</button>
            </form>
          )) : <form onSubmit={etape1} className="space-y-3">
            <p className="text-[13px] text-mute">Utilisez votre mot de passe Ville. Cette connexion vérifie vos identifiants auprès de l’Active Directory.</p>
            <label className="block"><span className="label">Identifiant Ville ou adresse e-mail</span><input className={champ} type="text" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="block"><span className="label">Mot de passe Ville</span><input className={champ} type="password" autoComplete="current-password" required value={mdp} onChange={(e) => setMdp(e.target.value)} /></label>
            <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={souvenir} onChange={(e) => setSouvenir(e.target.checked)} /> Se souvenir de moi sur ce navigateur <span className="text-[12px] text-mute">(identifiant seulement)</span></label>
            <button className="btn-primary w-full !py-3 !text-[16px]" disabled={busy}>Se connecter</button>
            <button type="button" className="w-full text-center text-[13px] text-action" onClick={() => { setOubli(true); setErr(null); setMsg(null); }}>Mot de passe Ville oublié ? Recevoir un code par SMS</button>
            {isNativeApp() && <button type="button" className="w-full text-center text-[13px] text-mute" onClick={() => nav('/instance')}>Changer d’instance</button>}
          </form>}
      </Cadre>
    </TabletFrame>
  );
}

/** Le lien reçu par e-mail active l'accès ; l'élu se connecte ensuite avec son mot de passe Ville. */
export function Invitation() {
  const { token } = useParams(); const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null); const [ok, setOk] = useState(false); const [busy, setBusy] = useState(false);
  const valider = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await api.post(`/elus-auth/invitation/${token}`); setOk(true); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <Cadre titre={ok ? 'Accès activé' : 'Activez votre accès'}>
      {ok ? (<><p className="mb-4 text-[14px]">Votre accès est activé. Connectez-vous avec votre adresse e-mail et votre mot de passe Ville.</p><button className="btn-primary w-full !py-3" onClick={() => nav('/connexion')}>Me connecter</button></>) : (
        <form onSubmit={valider} className="space-y-3"><Err msg={err} />
          <p className="text-[14px] text-mute">Ce lien active votre accès personnel à l’espace des élus. Aucun nouveau mot de passe n’est à créer : vous utiliserez votre mot de passe Ville habituel.</p>
          <button className="btn-primary w-full !py-3 !text-[16px]" disabled={busy}>Activer mon accès</button>
        </form>)}
    </Cadre>
  );
}
