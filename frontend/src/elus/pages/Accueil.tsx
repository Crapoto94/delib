import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, CloudDownload, WifiOff } from 'lucide-react';
import { api, errMsg } from '../api';
import { armerReprise, prefetchSeance, usePrefetch } from '../docs';
import { dt } from '../../format';

/** Pastille d'état du téléchargement en arrière-plan (« 34 / 40 documents prêts hors ligne »). */
export function EtatTelechargement() {
  const p = usePrefetch();
  if (!p.total) return null;
  const complet = p.prets >= p.total;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold ${complet ? 'bg-ok-bg text-ok-text' : p.horsLigne ? 'bg-slate-200 text-slate-700' : 'bg-action/10 text-action'}`} role="status" aria-live="polite"
      title={p.espaceFaible ? 'Espace de stockage faible sur cet appareil' : undefined}>
      {p.horsLigne ? <WifiOff className="h-3.5 w-3.5" /> : <CloudDownload className={`h-3.5 w-3.5 ${p.enCours ? 'animate-pulse' : ''}`} />}
      {complet ? `${p.total} document${p.total > 1 ? 's' : ''} prêt${p.total > 1 ? 's' : ''} hors ligne` : `${p.prets} / ${p.total} documents prêts hors ligne${p.enCours ? '…' : ''}`}{p.echecs > 0 && ` · ${p.echecs} en échec`}
    </span>
  );
}

let seanceSuivie: number | null = null;
export const definirSeanceSuivie = (id: number | null) => { seanceSuivie = id; };

export default function Accueil() {
  const [a, setA] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.get('/elus/accueil').then((r) => { setA(r.data); const id = r.data.prochaine?.id ?? null; definirSeanceSuivie(id); armerReprise(() => seanceSuivie); if (id) void prefetchSeance(id); }).catch((e) => setErr(errMsg(e)));
  }, []);
  if (err) return <p className="p-6 text-ko">{err}</p>;
  if (!a) return <p className="p-6 text-mute">Chargement…</p>;
  const pr = a.prochaine;
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
      <h1 className="text-[26px]">Bonjour {String(a.elu.nom).split(' ')[0]}</h1>
      {pr ? (
        <section className="rounded-xl bg-primary p-5 text-white shadow-lift">
          <div className="text-[12px] font-semibold uppercase tracking-widest text-white/70">Prochaine séance</div>
          <h2 className="mt-1 text-[24px] text-white">{pr.instance}</h2>
          <p className="text-white/90">{dt(pr.dateSeance, { dateStyle: 'full', timeStyle: 'short' })}{pr.lieu ? ` · ${pr.lieu}` : ''}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="rounded bg-white/15 px-3 py-1 text-[14px] font-bold">{pr.joursRestants > 0 ? `J-${pr.joursRestants}` : pr.joursRestants === 0 ? 'Aujourd’hui' : 'En cours'}</span>
            {pr.nonLus > 0 && <span className="rounded bg-warn px-3 py-1 text-[13px] font-semibold">{pr.nonLus} document(s) à consulter</span>}
            <span className="bg-white/95 rounded-full"><EtatTelechargement /></span>
          </div>
          <Link to={`/seances/${pr.id}`} className="mt-4 inline-block rounded-lg bg-white px-5 py-3 text-[16px] font-bold text-primary">Ouvrir les documents de la séance</Link>
        </section>
      ) : <section className="rounded-xl border border-line bg-white p-6 text-mute">Aucune séance n’est à votre disposition pour le moment. Vous serez prévenu(e) par e-mail à l’envoi de la convocation.</section>}
      <section>
        <h2 className="mb-2 text-[18px]">Mes séances</h2>
        <ul className="divide-y divide-line rounded-xl border border-line bg-white">
          {a.seances.map((s: any) => (
            <li key={s.id}><Link to={`/seances/${s.id}`} className="flex items-center gap-3 px-4 py-4 hover:bg-soft"><CalendarDays className="h-5 w-5 text-action" />
              <div className="min-w-0 flex-1"><div className="font-semibold">{s.instance}</div><div className="text-[13px] text-mute">{dt(s.dateSeance, { dateStyle: 'full', timeStyle: 'short' })}</div></div>
              {s.passee && <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">passée</span>}</Link></li>))}
          {!a.seances.length && <li className="px-4 py-6 text-center text-mute">Aucune séance.</li>}
        </ul>
      </section>
    </div>
  );
}
