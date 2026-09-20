import { FormEvent, useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import Odj from './Odj';
import Convocation from './Convocation';
import SuiviSeance from './SuiviSeance';
import { DeleteSeanceModal, EditSeanceModal } from './SeanceActions';
import { TeamsLink } from '../Reunions';
import { CalendarDays, Plus, Pencil, Trash2 } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { d, daysUntil, dt } from '../format';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageTitle, useLoad, useToast } from '../ui';
import { AgentName } from '../AgentName';
import { Select } from '../Select';

function NewSeance({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { org } = useAuth(); const o = org!.id;
  const inst = useLoad(async () => (await api.get(orgPath(o, '/instances'))).data.items as any[], [o]);
  const [instanceId, setI] = useState(''); const [date, setDate] = useState(''); const [lieu, setLieu] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const prop = useLoad(async () => (date ? (await api.get(orgPath(o, '/seances/dates-proposees'), { params: { dateSeance: new Date(date).toISOString() } })).data : null), [date]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { await api.post(orgPath(o, '/seances'), { instanceId: Number(instanceId || inst.data?.[0]?.id), dateSeance: new Date(date).toISOString(), lieu: lieu || undefined }); onDone(); onClose(); } catch (x) { setErr(errMsg(x)); }
  };
  return (
    <Modal title="Nouvelle séance" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4"><ErrorBox msg={err} />
        <Field label="Instance"><Select className="input" value={instanceId} onChange={(e) => setI(e.target.value)}>{inst.data?.map((i) => <option key={i.id} value={i.id}>{i.nom}</option>)}</Select></Field>
        <Field label="Date et heure"><input className="input" type="datetime-local" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Lieu"><input className="input" value={lieu} onChange={(e) => setLieu(e.target.value)} placeholder="Salle du conseil, Hôtel de ville" /></Field>
        {prop.data && <div className="rounded bg-soft p-3 text-[12px]"><b>Dates clés proposées</b><ul className="mt-1"><li>Date limite de rédaction : {d(prop.data.dateLimiteRedaction)}</li><li>Validation DGS : {d(prop.data.dateLimiteDgs)}</li><li>Mise à disposition des commissions : {d(prop.data.dateLimiteMadCommissions)}</li><li>Envoi de la convocation : {d(prop.data.dateEnvoiConvocation)}</li></ul></div>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary">Créer</button></div>
      </form>
    </Modal>
  );
}

function HorsDelai() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const list = useLoad(async () => (await api.get(orgPath(o, '/seances/hors-delai'))).data.items as any[], [o]);
  const der = useLoad(async () => (await api.get(orgPath(o, '/derogations'), { params: { statut: 'demandee' } })).data.items as any[], [o]);
  const decide = async (x: any, decision: 'accordee' | 'refusee') => {
    const motif = decision === 'refusee' ? prompt('Motif du refus :') : undefined; if (decision === 'refusee' && !motif) return;
    try { await api.post(orgPath(o, `/derogations/${x.id}/decision`), { decision, motif }); toast('Décision enregistrée'); der.reload(); list.reload(); } catch (e) { toast(errMsg(e), 'ko'); }
  };
  const report = async (acteId: number) => { const motif = prompt('Motif du report :', 'Date limite dépassée'); if (!motif) return; try { await api.post(orgPath(o, `/actes/${acteId}/report`), { motif }); toast('Reporté'); list.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  return (
    <div className="space-y-6">
      <section className="card"><div className="border-b border-line px-5 py-3"><h3>Demandes de dérogation en attente</h3></div>
        {der.loading ? <Loading /> : !der.data?.length ? <Empty>Aucune demande en attente.</Empty> : (
          <table className="w-full"><thead><tr><th>Acte</th><th>Demandeur</th><th>Motif</th><th /></tr></thead><tbody>{der.data.map((x) => (
            <tr key={x.id}><td><Link className="font-semibold text-head hover:underline" to={`/dossiers/${x.acteId}`}>#{x.acte.numeroSuivi} {x.acte.titre}</Link></td><td>{x.demandeur}</td><td>{x.motif}</td>
              <td className="whitespace-nowrap text-right"><button className="btn-ok mr-2" onClick={() => decide(x, 'accordee')}>Accorder</button><button className="btn-ko" onClick={() => decide(x, 'refusee')}>Refuser</button></td></tr>))}</tbody></table>)}
      </section>
      <section className="card"><div className="border-b border-line px-5 py-3"><h3>Actes hors délai (bloqués)</h3></div>
        {list.loading ? <Loading /> : !list.data?.length ? <Empty>Aucun acte hors délai.</Empty> : (
          <table className="w-full"><thead><tr><th>Acte</th><th>Rédacteur</th><th>Date limite</th><th>Séance</th><th /></tr></thead><tbody>{list.data.map((x) => (
            <tr key={x.acteId}><td><Link className="font-semibold text-head hover:underline" to={`/dossiers/${x.acteId}`}>#{x.numeroSuivi} {x.titre}</Link></td><td><AgentName u={x.redacteur} /></td>
              <td><Badge tone="ko">{d(x.dateLimiteRedaction)}</Badge></td><td>{d(x.dateSeance)}</td>
              <td className="text-right">{x.derogation ? <Badge tone="ok">Dérogation en vigueur</Badge> : <button className="btn-secondary" onClick={() => report(x.acteId)}>Reporter</button>}</td></tr>))}</tbody></table>)}
      </section>{node}
    </div>
  );
}

function SeancesList() {
  const { org, isScc } = useAuth(); const o = org!.id;
  const [editing, setEditing] = useState<any>(null); const [deleting, setDeleting] = useState<any>(null);
  const [tab, setTab] = useState<'avenir' | 'passees' | 'hors'>('avenir'); const [creating, setCreating] = useState(false); const [kind, setKind] = useState<'' | 'conseil' | 'commission'>('');
  const list = useLoad(async () => {
    const now = new Date().toISOString();
    const items = (await api.get(orgPath(o, '/seances'), { params: { ...(tab === 'passees' ? { to: now } : { from: now }), limit: 200, kind: kind || undefined } })).data.items as any[];
    return tab === 'passees' ? items : [...items].sort((a, b) => +new Date(a.dateSeance) - +new Date(b.dateSeance)); // les prochaines d'abord ; les passées, la plus récente d'abord
  }, [o, tab, kind]);
  return (
    <div>
      <PageTitle title="Séances & Ordre du jour" sub="Calendrier des instances, dates clés et actes en attente." actions={isScc && <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nouvelle séance</button>} />
      <div className="mb-4 flex w-fit rounded bg-surface p-1 shadow-card" role="tablist">{([['avenir', 'À venir'], ['passees', 'Séances passées'], ...(isScc ? [['hors', 'Hors délai & dérogations']] : [])] as [string, string][]).map(([k, l]) => (
        <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k as any)} className={`rounded px-3 py-2 text-[13px] font-semibold ${tab === k ? 'bg-primary text-white' : ''}`}>{l}</button>))}</div>
      {tab !== 'hors' && <div className="mb-4 flex gap-2" role="group" aria-label="Nature de l'instance">{([['', 'Toutes'], ['conseil', 'Conseil municipal'], ['commission', 'Commissions']] as const).map(([k, l]) => <button key={k} onClick={() => setKind(k)} className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${kind === k ? 'border-primary bg-primary text-white' : 'border-line bg-surface'}`}>{l}</button>)}</div>}
      {tab === 'hors' ? <HorsDelai /> : list.loading ? <Loading /> : !list.data?.length ? <div className="card"><Empty>{tab === 'passees' ? 'Aucune séance passée.' : 'Aucune séance à venir.'}</Empty></div> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{list.data.map((s) => {
          const j = daysUntil(s.dateSeance); const lim = daysUntil(s.dateLimiteRedaction);
          return (
            <Link key={s.id} to={`/seances/${s.id}`} className="card block p-5 hover:shadow-lift" aria-label={`Ordre du jour du ${d(s.dateSeance)}`}>
              <div className="flex items-start justify-between"><div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-action" /><h3>{s.instance}</h3></div>
                <div className="flex items-center gap-1"><Badge tone={s.statut === 'planifiee' ? 'blue' : 'gray'}>{s.statut}</Badge>
                  {isScc && <><button type="button" className="rounded p-1 text-mute hover:bg-soft hover:text-action" title="Modifier la séance" aria-label="Modifier la séance" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(s); }}><Pencil className="h-4 w-4" /></button>
                    <button type="button" className="rounded p-1 text-mute hover:bg-ko-bg hover:text-ko" title="Supprimer la séance" aria-label="Supprimer la séance" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleting(s); }}><Trash2 className="h-4 w-4" /></button></>}</div></div>
              <div className="mt-2 text-[18px] font-bold">{dt(s.dateSeance, { dateStyle: 'full', timeStyle: 'short' })}</div>
              <div className="text-mute">{s.lieu || 'Lieu à définir'}{j !== null && j >= 0 ? ` · dans ${j} jour(s)` : ''}</div>
              {s.teams && <div className="mt-2" onClick={(e) => e.stopPropagation()}><TeamsLink teams={s.teams} /></div>}
              {s.kind === 'commission' ? <p className="mt-3 text-[12px] text-mute">Réunion de commission — <b>{s.actesEnAttente ?? 0}</b> projet(s) visé(s) · ordre du jour : projets présentés</p> : (
              <dl className="mt-3 space-y-1 text-[12px]">
                <div className="flex justify-between"><dt>Date limite de rédaction</dt><dd><Badge tone={lim !== null && lim < 0 ? 'ko' : lim !== null && lim < 7 ? 'warn' : 'ok'}>{d(s.dateLimiteRedaction)}</Badge></dd></div>
                <div className="flex justify-between"><dt>Actes en attente d'affectation</dt><dd className="font-bold">{s.actesEnAttente ?? 0}</dd></div>
                <div className="flex justify-between"><dt>Ordre du jour</dt><dd>{s.odjStatut.replace('_', ' ')}</dd></div>
              </dl>)}
            </Link>);
        })}</div>)}
      {creating && <NewSeance onClose={() => setCreating(false)} onDone={list.reload} />}
      {editing && <EditSeanceModal seance={editing} onClose={() => setEditing(null)} onDone={list.reload} />}
      {deleting && <DeleteSeanceModal seance={deleting} onClose={() => setDeleting(null)} onDone={list.reload} />}
    </div>
  );
}

export default function Seances() {
  return <Routes><Route index element={<SeancesList />} /><Route path=":id" element={<Odj />} /><Route path=":id/convocation" element={<Convocation />} /><Route path=":id/suivi" element={<SuiviSeance />} /></Routes>;
}
