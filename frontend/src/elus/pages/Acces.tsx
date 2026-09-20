import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, deviceId, errMsg, session } from '../api';

const Cadre = ({ titre, children }: { titre: string; children: ReactNode }) => (
  <div className="flex min-h-screen items-center justify-center bg-page px-4">
    <div className="w-full max-w-md rounded-xl border border-line bg-white p-6 shadow-lift">
      <div className="mb-5 text-center"><div className="text-[13px] font-semibold uppercase tracking-widest text-mute">VibeDélib</div><h1 className="mt-1 text-[24px]">{titre}</h1></div>
      {children}
    </div>
  </div>
);
const Err = ({ msg }: { msg: string | null }) => (msg ? <div role="alert" className="mb-3 rounded border border-ko/30 bg-ko-bg px-3 py-2 text-[14px] text-ko">{msg}</div> : null);
const champ = 'input !py-3 !text-[16px]';

/** Mot de passe oublié (ELU-83) : un code à 6 chiffres part par SMS sur le mobile ; le bon code, saisi dans les 5 minutes, connecte pour 12 heures. */
function OubliSms({ emailInitial, onRetour, onSession }: { emailInitial: string; onRetour: () => void; onSession: (r: any) => void }) {
  const [email, setEmail] = useState(emailInitial); const [defi, setDefi] = useState<string | null>(null); const [code, setCode] = useState('');
  const [reste, setReste] = useState(0); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  // compte à rebours : le code n'est valable que 5 minutes
  useEffect(() => { if (!defi) return; const t = setInterval(() => setReste((r) => Math.max(0, r - 1)), 1000); return () => clearInterval(t); }, [defi]);
  const demander = async (e?: FormEvent) => {
    e?.preventDefault(); setBusy(true); setErr(null);
    try { const r = (await api.post('/elus-auth/oubli-sms', { email })).data; setDefi(r.challenge); setReste(r.expireDans); setCode(''); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  const valider = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { onSession((await api.post('/elus-auth/oubli-sms/code', { challenge: defi, code: code.trim(), appareil: deviceId() })).data); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  const mmss = `${Math.floor(reste / 60)}:${String(reste % 60).padStart(2, '0')}`;
  return (
    <Cadre titre="Mot de passe oublié">
      <Err msg={err} />
      {!defi ? (
        <form onSubmit={demander} className="space-y-3">
          <p className="text-[14px] text-mute">Saisissez votre adresse e-mail : nous envoyons un <b>code à 6 chiffres par SMS</b> sur le mobile enregistré au secrétariat.</p>
          <label className="block"><span className="label">Adresse e-mail</span><input className={champ} type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <button className="btn-primary w-full !py-3 !text-[16px]" disabled={busy || !email}>Recevoir un code par SMS</button>
          <button type="button" className="w-full text-center text-[13px] text-mute" onClick={onRetour}>← Retour à la connexion</button>
        </form>
      ) : (
        <form onSubmit={valider} className="space-y-3">
          <p className="text-[14px] text-mute">Si un mobile est enregistré pour cette adresse, un code vient d’y être envoyé. {reste > 0 ? <>Il est valable encore <b className="tabular-nums">{mmss}</b>.</> : <b className="text-ko">Le code a expiré.</b>}</p>
          <input className={`${champ} text-center tracking-[0.5em]`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label="Code reçu par SMS" />
          <button className="btn-primary w-full !py-3 !text-[16px]" disabled={busy || code.length !== 6 || reste === 0}>Me connecter</button>
          <p className="text-[12px] text-mute">Vous serez connecté(e) pour 12 heures. Pensez ensuite à demander au secrétariat un nouveau lien si vous souhaitez changer votre mot de passe.</p>
          <div className="flex justify-between text-[13px]"><button type="button" className="text-action disabled:opacity-50" disabled={busy} onClick={() => demander()}>Renvoyer un code</button><button type="button" className="text-mute" onClick={onRetour}>← Retour</button></div>
        </form>)}
    </Cadre>
  );
}

/** Connexion en deux étapes : mot de passe, puis code à usage unique reçu par mail (ELU-61). */
export function Connexion() {
  const nav = useNavigate();
  // « Se souvenir de moi » : seule l'adresse e-mail est conservée dans ce navigateur, jamais le mot de passe
  const memo = (() => { try { return localStorage.getItem('elus.email') || ''; } catch { return ''; } })();
  const [souvenir, setSouvenir] = useState(!!memo);
  const [email, setEmail] = useState(memo); const [mdp, setMdp] = useState(''); const [defi, setDefi] = useState<string | null>(null); const [code, setCode] = useState('');
  const [oubliSms, setOubliSms] = useState(false);
  const [confiance, setConfiance] = useState(true); const [err, setErr] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const fin = (r: any) => { try { if (souvenir) localStorage.setItem('elus.email', email.trim()); else localStorage.removeItem('elus.email'); } catch { /* stockage indisponible */ } session.set({ token: r.token, expiresAt: r.expiresAt, elu: r.elu }); nav('/', { replace: true }); };
  const etape1 = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = (await api.post('/elus-auth/connexion', { email, motDePasse: mdp, appareil: deviceId() })).data; if (r.session) fin(r.session); else setDefi(r.challenge); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  const etape2 = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { fin((await api.post('/elus-auth/code', { challenge: defi, code: code.trim(), faireConfiance: confiance, appareil: deviceId() })).data); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  const oubliMail = async () => { if (!email) { setErr('Saisissez d’abord votre adresse e-mail.'); return; } try { await api.post('/elus-auth/oubli', { email }); setMsg('Si un compte existe, un lien de réinitialisation vient de vous être envoyé.'); setErr(null); } catch (x) { setErr(errMsg(x)); } };
  if (oubliSms) return <OubliSms emailInitial={email} onRetour={() => setOubliSms(false)} onSession={fin} />;
  return (
    <Cadre titre="Espace des élus">
      <Err msg={err} />{msg && <div className="mb-3 rounded bg-ok-bg px-3 py-2 text-[14px] text-ok-text">{msg}</div>}
      {!defi ? (
        <form onSubmit={etape1} className="space-y-3">
          <label className="block"><span className="label">Adresse e-mail</span><input className={champ} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="block"><span className="label">Mot de passe</span><input className={champ} type="password" autoComplete="current-password" required value={mdp} onChange={(e) => setMdp(e.target.value)} /></label>
          <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={souvenir} onChange={(e) => setSouvenir(e.target.checked)} /> Se souvenir de moi sur ce navigateur <span className="text-[12px] text-mute">(adresse e-mail seulement)</span></label>
          <button className="btn-primary w-full !py-3 !text-[16px]" disabled={busy}>Continuer</button>
          <button type="button" className="w-full text-center text-[14px] font-semibold text-action" onClick={() => setOubliSms(true)}>Mot de passe oublié ?</button>
          <button type="button" className="w-full text-center text-[12px] text-mute" onClick={oubliMail}>Recevoir plutôt un lien par e-mail pour le changer</button>
        </form>
      ) : (
        <form onSubmit={etape2} className="space-y-3">
          <p className="text-[14px] text-mute">Un code à 6 chiffres vient de vous être envoyé par e-mail. Il est valable 10 minutes.</p>
          <input className={`${champ} text-center tracking-[0.5em]`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label="Code de connexion" />
          <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={confiance} onChange={(e) => setConfiance(e.target.checked)} /> Faire confiance à cet appareil pendant 30 jours</label>
          <button className="btn-primary w-full !py-3 !text-[16px]" disabled={busy || code.length !== 6}>Se connecter</button>
          <button type="button" className="w-full text-center text-[13px] text-mute" onClick={() => { setDefi(null); setCode(''); }}>Recommencer</button>
        </form>)}
    </Cadre>
  );
}

/** Lien d'invitation reçu par mail : l'élu choisit son mot de passe (le secrétariat ne le connaît jamais). */
export function Invitation() {
  const { token } = useParams(); const nav = useNavigate();
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [err, setErr] = useState<string | null>(null); const [ok, setOk] = useState(false); const [busy, setBusy] = useState(false);
  const valider = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (a !== b) { setErr('Les deux mots de passe ne sont pas identiques.'); return; }
    setBusy(true);
    try { await api.post(`/elus-auth/invitation/${token}`, { motDePasse: a }); setOk(true); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <Cadre titre={ok ? 'Accès activé' : 'Choisissez votre mot de passe'}>
      {ok ? (<><p className="mb-4 text-[14px]">Votre accès est activé. Vous pouvez maintenant vous connecter.</p><button className="btn-primary w-full !py-3" onClick={() => nav('/connexion')}>Me connecter</button></>) : (
        <form onSubmit={valider} className="space-y-3"><Err msg={err} />
          <p className="text-[13px] text-mute">12 caractères au moins, avec des lettres et des chiffres ou des symboles.</p>
          <label className="block"><span className="label">Mot de passe</span><input className={champ} type="password" autoComplete="new-password" minLength={12} required value={a} onChange={(e) => setA(e.target.value)} /></label>
          <label className="block"><span className="label">Confirmation</span><input className={champ} type="password" autoComplete="new-password" minLength={12} required value={b} onChange={(e) => setB(e.target.value)} /></label>
          <button className="btn-primary w-full !py-3 !text-[16px]" disabled={busy}>Activer mon accès</button>
        </form>)}
    </Cadre>
  );
}
