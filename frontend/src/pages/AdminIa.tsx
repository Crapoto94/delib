import { useState } from 'react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, Field, Loading, Spinner, useLoad, useToast } from '../ui';

const LIMITS: [string, string, string][] = [
  ['max_concurrent', 'Requêtes simultanées', "Nombre maximal d'appels à l'IA en même temps, tous utilisateurs confondus (l'IA est partagée : restez prudent)."],
  ['max_par_utilisateur', 'Par utilisateur', "Nombre de demandes d'un même utilisateur traitées en même temps ; les autres attendent (file « à tour de rôle »)."],
  ['file_max', 'Taille de la file', "Au-delà, les nouvelles demandes sont refusées (« file pleine »)."],
  ['file_max_par_utilisateur', 'Demandes par utilisateur', "En attente + en cours, par utilisateur."],
  ['intervalle_ms', 'Intervalle entre deux appels (ms)', "Délai minimal entre deux appels à l'IA, pour lisser la charge."],
  ['timeout_s', "Délai d'un appel (s)", "Au-delà, l'appel est abandonné (et retenté)."],
  ['tentatives', 'Essais par demande', "Nombre d'essais (avec temporisation croissante) avant de déclarer l'échec."],
];

/** Paramétrage et supervision de la file d'attente de l'IA (D52). */
export default function AdminIa() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const ov = useLoad(async () => (await api.get(orgPath(o, '/ia/file'))).data, [o]);
  const jobs = useLoad(async () => (await api.get(orgPath(o, '/ia/taches'), { params: { scope: 'all' } })).data.items as any[], [o]);
  const [vals, setVals] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  if (ov.loading && !ov.data) return <Loading />;
  const cur = (k: string) => vals[k] ?? String(ov.data?.limits[k] ?? '');
  const save = async () => {
    setBusy(true);
    try {
      for (const [k] of LIMITS) if (vals[k] !== undefined && vals[k] !== String(ov.data.limits[k])) await api.put(orgPath(o, `/settings/ai.${k}`), { value: Number(vals[k]), scope: 'organisme' });
      toast('Paramètres enregistrés'); setVals({}); ov.reload();
    } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); }
  };
  const cancel = async (id: number) => { try { await api.delete(orgPath(o, `/ia/taches/${id}`)); jobs.reload(); ov.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  const TONE: Record<string, any> = { queued: 'gray', running: 'blue', done: 'ok', error: 'ko', cancelled: 'warn' };
  const LABEL: Record<string, string> = { queued: 'en attente', running: 'en cours', done: 'terminée', error: 'échec', cancelled: 'annulée' };
  return (
    <div className="space-y-6">
      <p className="text-mute">Toute interrogation de l'IA se fait <b>en arrière plan</b>, dans une file d'attente : les agents continuent à travailler et voient un indicateur d'avancement. Ces limites évitent de surcharger l'IA.</p>
      <div className="grid gap-4 md:grid-cols-4">{[['En attente', ov.data.queued], ['En cours', ov.data.running], ['Terminées (24 h)', ov.data.done], ['En échec (24 h)', ov.data.errors]].map(([l, v]) => (
        <div key={l as string} className="card p-4"><div className="text-[12px] text-mute">{l}</div><div className="text-[28px] font-bold text-primary">{v}</div></div>))}</div>
      <section className="card p-5"><h3 className="mb-3">Limites</h3>
        <div className="grid gap-4 md:grid-cols-2">{LIMITS.map(([k, l, h]) => (
          <Field key={k} label={l} hint={`${h} Défaut : ${ov.data.defaults[k]}.`}><input className="input" type="number" min={k === 'intervalle_ms' ? 0 : 1} value={cur(k)} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} /></Field>))}</div>
        <div className="mt-4 flex justify-end"><button className="btn-primary" disabled={busy || !Object.keys(vals).length} onClick={save}>{busy && <Spinner />} Enregistrer</button></div>
      </section>
      <section className="card"><div className="border-b border-line px-5 py-3"><h3>Demandes récentes</h3></div>
        {jobs.loading ? <Loading /> : !jobs.data?.length ? <p className="p-6 text-center text-mute">Aucune demande.</p> : (
          <table className="w-full"><thead><tr><th>#</th><th>Demandeur</th><th>Dossier</th><th>Statut</th><th>Avancement</th><th>Déposée</th><th /></tr></thead><tbody>{jobs.data.map((j) => (
            <tr key={j.id}><td>{j.id}</td><td>{j.requestedBy}</td><td>{j.acteId ? `#${j.acteId}` : '—'}</td><td><Badge tone={TONE[j.status]}>{LABEL[j.status]}</Badge>{j.status === 'queued' && <span className="ml-1 text-[11px] text-mute">n° {j.position}</span>}</td>
              <td className="text-[12px]">{j.status === 'error' ? <span className="text-ko">{j.error}</span> : `${j.progress}/${j.total || '?'} ${j.stepLabel ?? ''}`}</td><td className="text-[12px] text-mute">{dt(j.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</td>
              <td className="text-right">{(j.status === 'queued' || j.status === 'running') && <button className="btn-secondary !py-1" onClick={() => cancel(j.id)}>Annuler</button>}</td></tr>))}</tbody></table>)}
      </section>{node}
    </div>
  );
}
