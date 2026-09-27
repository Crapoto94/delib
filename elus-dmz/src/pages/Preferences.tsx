import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { api, errMsg } from '../api';

type Prefs = { telephone: string | null; notifMail: { parapheurRetour?: boolean } };

/** Préférences personnelles de l'élu : téléphone (SMS) et notifications par mail. Rien ici n'est visible des agents. */
export default function Preferences() {
  const [p, setP] = useState<Prefs | null>(null);
  const [telephone, setTelephone] = useState('');
  const [parapheurRetour, setParapheurRetour] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/elus/preferences').then((r) => {
      const d: Prefs = r.data;
      setP(d); setTelephone(d.telephone || ''); setParapheurRetour(d.notifMail?.parapheurRetour !== false);
    }).catch((e) => setErr(errMsg(e)));
  }, []);

  const enregistrer = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await api.put('/elus/preferences', { telephone: telephone.trim() || null, notifMail: { parapheurRetour } });
      setP(r.data); setMsg('Préférences enregistrées.');
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <Link to="/" className="mb-4 inline-flex items-center gap-1 text-[13px] text-action hover:underline"><ArrowLeft className="h-4 w-4" /> Retour</Link>
      <h1 className="mb-4 text-[22px]">Mes préférences</h1>
      {err && <p role="alert" className="mb-3 rounded border border-ko/30 bg-ko-bg px-3 py-2 text-[14px] text-ko">{err}</p>}
      {msg && <p role="status" className="mb-3 rounded bg-ok-bg px-3 py-2 text-[14px] text-ok-text">{msg}</p>}
      {!p ? <p className="text-mute">Chargement…</p> : (
        <form onSubmit={enregistrer} className="space-y-5">
          <section className="rounded-xl border border-line bg-surface p-4">
            <h2 className="mb-1 text-[15px] font-semibold">Téléphone portable</h2>
            <p className="mb-2 text-[13px] text-mute">Utilisé pour recevoir un code par SMS en cas de mot de passe oublié.</p>
            <input className="input" type="tel" placeholder="06 12 34 56 78" value={telephone} onChange={(e) => setTelephone(e.target.value)} />
          </section>
          <section className="rounded-xl border border-line bg-surface p-4">
            <h2 className="mb-1 text-[15px] font-semibold">Notifications par mail</h2>
            <p className="mb-2 text-[13px] text-mute">Quand souhaitez-vous recevoir un e-mail ?</p>
            <label className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={parapheurRetour} onChange={(e) => setParapheurRetour(e.target.checked)} />
              Un acte que j'ai signé (ou refusé) au parapheur revient traité
            </label>
          </section>
          <button className="btn-primary w-full !py-3 !text-[16px]" disabled={busy}>{busy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : 'Enregistrer'}</button>
        </form>
      )}
    </div>
  );
}
