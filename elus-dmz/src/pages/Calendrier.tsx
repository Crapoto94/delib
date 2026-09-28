import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CalendarDays, CalendarPlus, Copy, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { api, errMsg } from '../api';
import { dt } from '../format';

type Lien = { actif: boolean; url?: string; webcal?: string; creeLe?: string; dernierAcces?: string | null; nbAcces?: number };
type Seance = { id: number; instance: string; dateSeance: string; passee: boolean };

/**
 * Mon calendrier : mes séances (conseil + les commissions dont je suis membre, déjà filtrées par le serveur) et un lien
 * d'abonnement (Outlook, Google, Apple…) — un abonnement, pas un export : l'agenda reste à jour tout seul.
 */
export default function Calendrier() {
  const [seances, setSeances] = useState<Seance[] | null>(null);
  const [lien, setLien] = useState<Lien | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chargerLien = () => api.get('/elus/calendrier/lien').then((r) => setLien(r.data)).catch((e) => setErr(errMsg(e)));

  useEffect(() => {
    api.get('/elus/accueil').then((r) => setSeances(r.data.seances)).catch((e) => setErr(errMsg(e)));
    chargerLien();
  }, []);

  const agir = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); setMsg(ok); await chargerLien(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <Link to="/" className="mb-4 inline-flex items-center gap-1 text-[13px] text-action hover:underline"><ArrowLeft className="h-4 w-4" /> Retour</Link>
      <h1 className="mb-1 text-[22px]">Mon calendrier</h1>
      <p className="mb-4 text-[13px] text-mute">Le conseil municipal et les seules commissions dont vous êtes membre.</p>
      {err && <p role="alert" className="mb-3 rounded border border-ko/30 bg-ko-bg px-3 py-2 text-[14px] text-ko">{err}</p>}
      {msg && <p role="status" className="mb-3 rounded bg-ok-bg px-3 py-2 text-[14px] text-ok-text">{msg}</p>}

      <section className="mb-5 rounded-xl border border-line bg-surface p-4">
        <h2 className="mb-1 text-[15px] font-semibold">Intégration automatique (Outlook, Google, Apple…)</h2>
        {!lien ? <p className="text-mute">Chargement…</p> : !lien.actif ? (
          <>
            <p className="mb-3 text-[13px] text-mute">Un <b>abonnement</b> (pas un export) : ajoutez ce lien <b>une seule fois</b> à votre agenda, et il reste à jour tout seul — séances déplacées, lieu modifié, annulations. Le lien est <b>personnel et secret</b> : ne le partagez pas.</p>
            <button className="btn-primary" disabled={busy} onClick={() => agir(() => api.post('/elus/calendrier/lien'), 'Lien créé')}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />} Créer mon lien de calendrier</button>
          </>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2"><input className="input font-mono text-[12px]" readOnly aria-label="Lien de calendrier" value={lien.url} onFocus={(e) => e.currentTarget.select()} />
              <button className="btn-secondary shrink-0" onClick={async () => { await navigator.clipboard?.writeText(lien.url!); setMsg('Lien copié'); }}><Copy className="h-4 w-4" /></button></div>
            <a className="btn-primary mb-3 w-full justify-center !py-3 !text-[16px]" href={lien.webcal}><CalendarPlus className="h-4 w-4" /> Ouvrir dans Outlook (webcal)</a>
            <ol className="mb-3 list-decimal space-y-1 pl-5 text-[13px] text-mute">
              <li><b>Outlook (web ou nouvelle version)</b> : Calendrier › <i>Ajouter un calendrier</i> › <i>S'abonner à partir du web</i> › collez le lien.</li>
              <li><b>Outlook classique</b> : Fichier › Paramètres du compte › <i>Calendriers Internet</i> › Nouveau › collez le lien.</li>
              <li>Google Agenda, Apple Calendrier… : « Ajouter un calendrier par URL ». L'actualisation se fait environ toutes les heures.</li>
            </ol>
            <p className="mb-3 text-[12px] text-mute">Créé le {lien.creeLe ? dt(lien.creeLe, { dateStyle: 'medium' }) : ''}{lien.dernierAcces ? ` · dernière lecture par un agenda : ${dt(lien.dernierAcces, { dateStyle: 'short', timeStyle: 'short' })}` : ' · pas encore lu par un agenda'}.</p>
            <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-3">
              <button className="btn-secondary" disabled={busy} onClick={() => window.confirm('Générer un nouveau lien ? L’ancien cessera de fonctionner : il faudra le remplacer dans votre agenda.') && agir(() => api.post('/elus/calendrier/lien'), 'Nouveau lien généré')}><RefreshCw className="h-4 w-4" /> Régénérer</button>
              <button className="btn-ko" disabled={busy} onClick={() => window.confirm('Révoquer le lien ? Votre agenda cessera de se mettre à jour.') && agir(() => api.delete('/elus/calendrier/lien'), 'Lien révoqué')}><Trash2 className="h-4 w-4" /> Révoquer</button>
            </div>
          </>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[15px] font-semibold">Mes séances</h2>
        {!seances ? <p className="text-mute">Chargement…</p> : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {seances.map((s) => (
              <li key={s.id}><Link to={`/seances/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-soft"><CalendarDays className="h-5 w-5 text-action" />
                <div className="min-w-0 flex-1"><div className="font-semibold">{s.instance}</div><div className="text-[13px] text-mute">{dt(s.dateSeance, { dateStyle: 'full', timeStyle: 'short' })}</div></div>
                {s.passee && <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">passée</span>}</Link></li>))}
            {!seances.length && <li className="px-4 py-6 text-center text-mute">Aucune séance.</li>}
          </ul>
        )}
      </section>
    </div>
  );
}
