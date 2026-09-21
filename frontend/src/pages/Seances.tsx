import { FormEvent, useEffect, useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import Odj from './Odj';
import Convocation from './Convocation';
import SuiviSeance from './SuiviSeance';
import { DeleteSeanceModal, EditSeanceModal } from './SeanceActions';
import { TeamsLink } from '../Reunions';
import { CalendarDays, CalendarPlus, Check, FileText, LayoutList, Plus, Rows3, Search, ShieldCheck, Timer } from 'lucide-react';
import { CarteSeance, LienCalendrier, RelanceServices } from './SeancesParts';
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
  const [type, setType] = useState('ordinaire');
  const [err, setErr] = useState<string | null>(null);
  const prop = useLoad(async () => (date ? (await api.get(orgPath(o, '/seances/dates-proposees'), { params: { dateSeance: new Date(date).toISOString() } })).data : null), [date]);
  const [jalons, setJalons] = useState<any[]>([]);
  useEffect(() => { setJalons((prop.data?.jalons ?? []).map((j: any) => ({ ...j }))); }, [prop.data]);
  const choisi = (inst.data ?? []).find((i) => String(i.id) === String(instanceId)) ?? inst.data?.[0];
  const estConseil = choisi?.kind === 'conseil';
  const toLocal = (iso: string) => { const x = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`; };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const byCode = (codes: string[]) => jalons.find((j) => codes.includes(j.code))?.date || undefined;
    const map: [string, string[]][] = [['dateLimiteRedaction', ['soumissions', 'redaction', 'depot']], ['dateLimiteDgs', ['dgs', 'verification_dgs']], ['dateLimiteMadCommissions', ['commissions', 'mad', 'mad_commissions']], ['dateEnvoiConvocation', ['convocation']]];
    const body: any = { instanceId: Number(instanceId || inst.data?.[0]?.id), dateSeance: new Date(date).toISOString(), lieu: lieu || undefined, type: estConseil ? type : undefined };
    for (const [k, codes] of map) { const v = byCode(codes); if (v) body[k] = v; }
    const mapped = new Set([...map.flatMap(([, c]) => c), 'seance']);
    body.jalonsExtra = jalons.filter((j) => !mapped.has(j.code) && j.date).map((j) => ({ code: j.code, label: j.label, date: j.date }));
    try { await api.post(orgPath(o, '/seances'), body); onDone(); onClose(); } catch (x) { setErr(errMsg(x)); }
  };
  return (
    <Modal title="Nouvelle séance" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4"><ErrorBox msg={err} />
        <Field label="Instance"><Select className="input" value={instanceId} onChange={(e) => setI(e.target.value)}>{inst.data?.map((i) => <option key={i.id} value={i.id}>{i.nom}</option>)}</Select></Field>
        {estConseil && <Field label="Type de conseil" hint="Par défaut : conseil ordinaire."><Select className="input" value={type} onChange={(e) => setType(e.target.value)}><option value="ordinaire">Conseil ordinaire</option><option value="extraordinaire">Conseil extraordinaire</option></Select></Field>}
        <Field label="Date et heure"><input className="input" type="datetime-local" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Lieu"><input className="input" value={lieu} onChange={(e) => setLieu(e.target.value)} placeholder="Salle du conseil, Hôtel de ville" /></Field>
        {jalons.length > 0 && <div className="rounded bg-soft p-3 text-[12px]"><b>Rétroplanning proposé</b> <span className="text-mute">— modifiable ; les dates sont calculées d'après le rétroplanning des paramètres.</span>
          <ul className="mt-2 space-y-1">{jalons.map((j, i) => (
            <li key={j.code} className="flex flex-wrap items-center gap-2"><span className="w-52 shrink-0">{j.label}</span>
              <input className="input !w-auto !py-0.5" type="datetime-local" value={j.date ? toLocal(j.date) : ''} onChange={(e) => setJalons((x) => x.map((y, k) => (k === i ? { ...y, date: e.target.value ? new Date(e.target.value).toISOString() : null } : y)))} />
              {j.jours ? <span className="text-mute">J-{j.jours}</span> : null}</li>))}
          </ul></div>}
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

/** Liste des séances (SEA-15, D108, maquette Stitch « seances ») : bandeau de synthèse, onglets à compteur, année, puces d'instance, filtre, vue détaillée ou compacte, une carte par séance. */
function SeancesList() {
  const { org, isScc } = useAuth(); const o = org!.id;
  const [editing, setEditing] = useState<any>(null); const [deleting, setDeleting] = useState<any>(null); const [relance, setRelance] = useState<any>(null); const [calendrier, setCalendrier] = useState(false);
  const [tab, setTab] = useState<'avenir' | 'passees' | 'hors'>('avenir'); const [creating, setCreating] = useState(false);
  const [instanceId, setInstanceId] = useState<number | ''>(''); const [annee, setAnnee] = useState<number | ''>(''); const [q, setQ] = useState('');
  const [etat, setEtat] = useState<'' | 'ouvertes' | 'closes'>('');
  const [vue, setVue] = useState<'detaillee' | 'compacte'>(() => { try { return localStorage.getItem('vd.seances.vue') === 'compacte' ? 'compacte' : 'detaillee'; } catch { return 'detaillee'; } });
  const changerVue = (v: 'detaillee' | 'compacte') => { setVue(v); try { localStorage.setItem('vd.seances.vue', v); } catch { /* préférence non conservée */ } };
  const instances = useLoad(async () => (await api.get(orgPath(o, '/instances'))).data.items as any[], [o]);
  const compteurs = useLoad(async () => {
    const now = new Date().toISOString();
    const [av, pa, ho] = await Promise.all([api.get(orgPath(o, '/seances'), { params: { from: now, limit: 1 } }), api.get(orgPath(o, '/seances'), { params: { to: now, limit: 1 } }),
      isScc ? api.get(orgPath(o, '/seances/hors-delai')).catch(() => ({ data: { items: [] } })) : Promise.resolve({ data: { items: [] } })]);
    return { avenir: av.data.total as number, passees: pa.data.total as number, hors: (ho.data.items as any[]).length };
  }, [o, isScc]);
  const list = useLoad(async () => {
    const now = new Date().toISOString();
    const p: any = { ...(tab === 'passees' ? { to: now } : { from: now }), limit: 200, instanceId: instanceId || undefined };
    const items = (await api.get(orgPath(o, '/seances'), { params: p })).data.items as any[];
    return tab === 'passees' ? items : [...items].sort((x, y) => +new Date(x.dateSeance) - +new Date(y.dateSeance)); // les prochaines d'abord ; les passées, la plus récente d'abord
  }, [o, tab, instanceId]);
  const filtrees = (list.data ?? []).filter((x) => (!annee || new Date(x.dateSeance).getFullYear() === annee)
    && (!etat || (etat === 'closes' ? x.statut === 'close' : x.statut !== 'close'))
    && (!q.trim() || `${x.instance} ${x.lieu ?? ''} ${dt(x.dateSeance, { dateStyle: 'full' })}`.toLowerCase().includes(q.trim().toLowerCase())));
  const ids = tab === 'avenir' && isScc ? filtrees.filter((x) => x.kind !== 'commission').map((x) => x.id).slice(0, 40) : [];
  const synth = useLoad(async () => (ids.length ? (await api.get(orgPath(o, '/seances-synthese'), { params: { ids: ids.join(',') } })).data : null), [o, ids.join(',')]);
  const parId = new Map<number, any>((synth.data?.items ?? []).map((x: any) => [x.seanceId, x]));
  const b = synth.data?.bandeau;
  const annees = Array.from(new Set((list.data ?? []).map((x) => new Date(x.dateSeance).getFullYear()))).sort();
  const reload = () => { list.reload(); compteurs.reload(); synth.reload(); };
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px] text-mute"><span className="rounded bg-soft px-2 py-0.5 font-bold uppercase tracking-wider text-head">{org!.nom}</span><span>· Mandat municipal</span></div>
      <PageTitle title="Séances & Ordre du jour" sub="Calendrier des assemblées délibérantes, rétroplanning réglementaire CGCT et état d’instruction temps réel des projets de délibérations."
        actions={<><button className="btn-secondary" onClick={() => setCalendrier(true)}><CalendarPlus className="h-4 w-4" /> Lien calendrier Outlook</button>{isScc && <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Programmer une nouvelle séance</button>}</>} />

      {isScc && (
        <div className="card mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 text-[13px]" aria-label="Synthèse">
          <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-action" /><b>{compteurs.data?.avenir ?? '…'}</b> séance(s) à venir</span>
          <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-action" /><b>{b?.actesEnInstruction ?? '…'}</b> acte(s) en instruction</span>
          {b?.prochaineCloture && <span className={`flex items-center gap-2 font-semibold ${b.prochaineCloture.jours <= 3 ? 'text-ko' : b.prochaineCloture.jours <= 7 ? 'text-warn' : 'text-ink'}`}><Timer className="h-4 w-4" /> Clôture des dépôts dans J-{b.prochaineCloture.jours} <span className="font-normal text-mute">({b.prochaineCloture.instance})</span></span>}
          {b && <Link to="/controle-legalite" className={`ml-auto flex items-center gap-2 font-semibold ${b.transmissionsSansAr || b.transmissionsAEnvoyer ? 'text-warn' : 'text-ok'}`}><ShieldCheck className="h-4 w-4" />
            {b.transmissionsAEnvoyer ? `${b.transmissionsAEnvoyer} transmission(s) à envoyer` : b.transmissionsSansAr ? `${b.transmissionsSansAr} transmission(s) sans AR` : 'Contrôle de légalité à jour'}</Link>}
        </div>)}

      <div className="card mb-4 space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex w-fit max-w-full overflow-x-auto rounded-lg bg-soft p-1" role="tablist">{([['avenir', 'Séances à venir', compteurs.data?.avenir], ['passees', 'Séances passées', compteurs.data?.passees], ...(isScc ? [['hors', 'Hors délai & dérogations', compteurs.data?.hors]] : [])] as [string, string, number | undefined][]).map(([k, l, n]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k as any)} className={`flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-[13px] font-semibold ${tab === k ? 'bg-primary text-white shadow-lift' : 'text-slate-700 hover:bg-surface'}`}>{l}{n !== undefined && <span className={`rounded-full px-1.5 text-[11px] ${tab === k ? 'bg-white/25' : k === 'hors' && n > 0 ? 'bg-ko-bg text-ko' : 'bg-line'}`}>{n}</span>}</button>))}</div>
          {tab !== 'hors' && <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg bg-soft p-1" role="group" aria-label="État de clôture">
              {([['', 'Toutes'], ['ouvertes', 'Non clôturées'], ['closes', 'Clôturées']] as ['' | 'ouvertes' | 'closes', string][]).map(([k, l]) => (
                <button key={k} type="button" aria-pressed={etat === k} onClick={() => setEtat(k)} className={`rounded-md px-2.5 py-1 text-[12px] font-semibold ${etat === k ? 'bg-primary text-white' : ''}`}>{l}</button>))}
            </div>
            <div className="flex rounded-lg bg-soft p-1" role="group" aria-label="Année">
              <button type="button" aria-pressed={annee === ''} onClick={() => setAnnee('')} className={`rounded-md px-2.5 py-1 text-[12px] font-semibold ${annee === '' ? 'bg-primary text-white' : ''}`}>Toutes</button>
              {annees.map((a) => <button key={a} type="button" aria-pressed={annee === a} onClick={() => setAnnee(a)} className={`rounded-md px-2.5 py-1 text-[12px] font-semibold ${annee === a ? 'bg-primary text-white' : ''}`}>{a}</button>)}</div>
            <div className="flex rounded-lg bg-soft p-1" role="group" aria-label="Affichage">
              <button type="button" aria-pressed={vue === 'detaillee'} title="Vue détaillée" aria-label="Vue détaillée" onClick={() => changerVue('detaillee')} className={`rounded-md p-1.5 ${vue === 'detaillee' ? 'bg-primary text-white' : 'text-mute'}`}><LayoutList className="h-4 w-4" /></button>
              <button type="button" aria-pressed={vue === 'compacte'} title="Vue compacte" aria-label="Vue compacte" onClick={() => changerVue('compacte')} className={`rounded-md p-1.5 ${vue === 'compacte' ? 'bg-primary text-white' : 'text-mute'}`}><Rows3 className="h-4 w-4" /></button></div>
          </div>}
        </div>
        {tab !== 'hors' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Instance">
              <button type="button" aria-pressed={instanceId === ''} onClick={() => setInstanceId('')} className={`flex items-center gap-1 rounded-full border px-3 py-1 text-[12px] font-semibold ${instanceId === '' ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-slate-700 hover:bg-soft'}`}>{instanceId === '' && <Check className="h-3 w-3" />} Toutes les instances</button>
              {(instances.data ?? []).map((i) => <button key={i.id} type="button" aria-pressed={instanceId === i.id} onClick={() => setInstanceId(i.id)} className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${instanceId === i.id ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-slate-700 hover:bg-soft'}`}>{i.nom}</button>)}</div>
            <div className="ml-auto flex min-w-[220px] items-center rounded-lg bg-soft px-3"><Search className="h-4 w-4 text-mute" /><input className="w-full bg-transparent px-2 py-2 text-[13px] outline-none" aria-label="Filtrer les séances" placeholder="Filtrer par instance, lieu, date…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </div>)}
      </div>

      {tab === 'hors' ? <HorsDelai /> : list.loading && !list.data ? <Loading /> : !filtrees.length ? <div className="card"><Empty>{q || annee || instanceId || etat ? 'Aucune séance ne correspond au filtre.' : tab === 'passees' ? 'Aucune séance passée.' : 'Aucune séance à venir.'}</Empty></div> : (
        <div className="space-y-4">{filtrees.map((x) => (
          <CarteSeance key={x.id} s={x} synth={parId.get(x.id)} isScc={isScc} compacte={vue === 'compacte' || tab === 'passees'} onEdit={() => setEditing(x)} onDelete={() => setDeleting(x)} onRelancer={() => setRelance(x)} />))}</div>)}

      <p className="mt-6 border-t border-line pt-3 text-[12px] text-mute"><b>Rappel L2121-12 CGCT</b> : délai de convocation obligatoire de 5 jours francs avec note de synthèse explicative.</p>
      {creating && <NewSeance onClose={() => setCreating(false)} onDone={reload} />}
      {editing && <EditSeanceModal seance={editing} onClose={() => setEditing(null)} onDone={reload} />}
      {deleting && <DeleteSeanceModal seance={deleting} onClose={() => setDeleting(null)} onDone={reload} />}
      {relance && <RelanceServices seance={relance} onClose={() => setRelance(null)} onDone={reload} />}
      {calendrier && <LienCalendrier onClose={() => setCalendrier(false)} />}
    </div>
  );
}

export default function Seances() {
  return <Routes><Route index element={<SeancesList />} /><Route path=":id" element={<Odj />} /><Route path=":id/convocation" element={<Convocation />} /><Route path=":id/suivi" element={<SuiviSeance />} /></Routes>;
}
