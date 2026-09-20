import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BellRing, Check, Copy, Download, Eye, FileText, Mail, Send, UserCheck, Users } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { AgentList } from '../AgentPicker';
import { dt } from '../format';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageTitle, Spinner, useLoad, useToast } from '../ui';

const EVENT: Record<string, { label: string; tone?: 'ok' | 'ko' | 'warn' | 'blue' }> = {
  envoi: { label: 'Envoi', tone: 'blue' }, echec: { label: 'Échec d\'envoi', tone: 'ko' }, relance: { label: 'Relance', tone: 'warn' }, ouverture: { label: 'Lien ouvert' },
  convocation_lue: { label: 'Convocation consultée', tone: 'ok' }, odj_lu: { label: 'Ordre du jour consulté', tone: 'ok' }, accuse: { label: 'Accusé de lecture', tone: 'ok' }, reponse: { label: 'Réponse de présence', tone: 'ok' },
};
const when = (d?: string | null) => (d ? dt(d, { dateStyle: 'short', timeStyle: 'short' }) : '—');

function Kpi({ icon, title, value, sub, tone }: { icon: ReactNode; title: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'ko' | 'warn' }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-mute">{icon}{title}</div>
      <div className={`mt-1 text-[26px] font-bold leading-tight ${tone === 'ko' ? 'text-ko' : tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-primary'}`}>{value}</div>
      {sub && <div className="mt-1 text-[12px] text-mute">{sub}</div>}
    </div>
  );
}
const Bar = ({ pct }: { pct: number }) => <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-action" style={{ width: `${pct}%` }} /></div>;

/** Convocation d'une séance : envoi aux élus et aux agents de la Ville, lien personnel par convoqué, suivi (qui a lu quoi), journal et statistiques. */
export default function Convocation() {
  const { id } = useParams(); const { org } = useAuth(); const o = org!.id; const sid = Number(id);
  const root = orgPath(o, `/seances/${sid}/convocation`); const { toast, node } = useToast();
  const prep = useLoad(async () => (await api.get(`${root}/preparation`)).data, [o, sid]);
  const versions = useLoad(async () => (await api.get(`${root}/versions`)).data.items as any[], [o, sid]);
  const [n, setN] = useState<number | null>(null); const [sending, setSending] = useState(false); const [tab, setTab] = useState<'suivi' | 'journal'>('suivi');
  const cur = n ?? versions.data?.[0]?.version ?? null;
  const running = versions.data?.some((v) => v.statut === 'en_cours');
  useEffect(() => { if (!running) return; const t = setInterval(() => { versions.reload(); }, 2000); return () => clearInterval(t); }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  if (prep.loading || versions.loading) return <Loading />;
  const p = prep.data;
  return (
    <div className="space-y-6">
      <PageTitle title={`Convocation — ${dt(p.seance.dateSeance, { dateStyle: 'long' })}`}
        sub={<span>{p.seance.instance}{p.seance.lieu ? ` · ${p.seance.lieu}` : ''} · <Link className="text-action hover:underline" to={`/seances/${sid}`}>Ordre du jour</Link></span>}
        actions={<button className="btn-primary" disabled={!p.odj.arrete} onClick={() => setSending(true)}><Send className="h-4 w-4" /> {versions.data?.length ? 'Envoyer un modificatif' : 'Convoquer'}</button>} />

      {!p.odj.arrete && <div role="status" className="rounded border border-warn/30 bg-warn-bg px-4 py-3 text-warn">L'ordre du jour n'est pas arrêté : arrêtez-le avant d'envoyer la convocation (les {p.odj.points} point(s) actuels sont provisoires).</div>}
      {p.odj.arrete && !p.delai.ok && <div role="status" className="rounded border border-warn/30 bg-warn-bg px-4 py-3 text-warn">Délai de convocation : il ne reste que <b>{p.delai.joursFrancs}</b> jour(s) franc(s) avant la séance ({p.delai.requis} requis). {p.delai.mode === 'bloquer' ? `Seule une convocation en urgence (motif obligatoire, ${p.delai.requisUrgence} jour franc minimum) est possible.` : "L'envoi reste possible avec avertissement."}</div>}

      {!versions.data?.length ? <Empty>Aucune convocation envoyée pour cette séance.</Empty> : (
        <>
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Versions">
            {versions.data.map((v) => <button key={v.id} role="tab" aria-selected={cur === v.version} onClick={() => setN(v.version)} className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${cur === v.version ? 'border-primary bg-primary text-white' : 'border-line bg-white'}`}>
              {v.modificatif ? 'Modificatif' : 'Convocation'} v{v.version} · {dt(v.creeLe, { dateStyle: 'short' })}</button>)}
            <span className="ml-auto flex rounded bg-soft p-0.5">{(['suivi', 'journal'] as const).map((k) => <button key={k} className={`rounded px-3 py-1 text-[12px] font-semibold ${tab === k ? 'bg-white shadow-card' : ''}`} onClick={() => setTab(k)}>{k === 'suivi' ? 'Suivi et statistiques' : 'Journal'}</button>)}</span>
          </div>
          {cur && (tab === 'suivi' ? <Suivi root={root} n={cur} version={versions.data.find((v) => v.version === cur)} newest={versions.data[0].version} reload={versions.reload} toast={toast} /> : <Journal root={root} n={cur} />)}
        </>)}
      {sending && <SendForm prep={p} root={root} onClose={() => setSending(false)} onDone={() => { toast('Convocation envoyée : les mails partent en arrière plan'); setN(null); versions.reload(); prep.reload(); }} />}
      {node}
    </div>
  );
}

function Suivi({ root, n, version, newest, reload, toast }: { root: string; n: number; version: any; newest: number; reload: () => void; toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const stats = useLoad(async () => (await api.get(`${root}/versions/${n}/statistiques`)).data, [root, n, version?.compteurs?.envoyes, version?.compteurs?.ouverts, version?.compteurs?.convocationLue, version?.compteurs?.odjLu, version?.compteurs?.accuses, version?.compteurs?.presents, version?.compteurs?.absents]);
  const dests = useLoad(async () => (await api.get(`${root}/versions/${n}/destinataires`)).data.items as any[], [root, n, stats.data?.totaux?.ouverts, stats.data?.totaux?.convocationLue, stats.data?.totaux?.odjLu, stats.data?.totaux?.envoyes]);
  const [filtre, setFiltre] = useState<'tous' | 'non_lecteurs' | 'agents' | 'elus'>('tous'); const [busy, setBusy] = useState(false); const [copied, setCopied] = useState<number | null>(null);
  useEffect(() => { const t = setInterval(() => { stats.reload(); dests.reload(); }, 15000); return () => clearInterval(t); }, [root, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => (dests.data ?? []).filter((d) => filtre === 'tous' || (filtre === 'non_lecteurs' ? d.envoi.statut === 'envoye' && d.convocationLue.fois === 0 : filtre === 'agents' ? d.kind === 'agent' : d.kind === 'elu')), [dests.data, filtre]);
  const relancer = async (cible: 'non_lecteurs' | 'sans_reponse') => {
    setBusy(true);
    try { const r = (await api.post(`${root}/versions/${n}/relance`, { cible })).data; toast(r.relances ? `${r.relances} relance(s) envoyée(s)` : 'Personne à relancer'); setTimeout(() => { stats.reload(); dests.reload(); reload(); }, 2500); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); }
  };
  const csv = async () => { const r = await api.get(`${root}/versions/${n}/export.csv`, { responseType: 'blob' }); const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = `convocation-v${n}-suivi.csv`; a.click(); };
  const copy = async (d: any) => { try { await navigator.clipboard.writeText(d.lien); setCopied(d.id); setTimeout(() => setCopied(null), 1500); } catch { toast('Copie impossible', 'ko'); } };
  if (stats.loading || !stats.data) return <Loading />;
  const s = stats.data; const t = s.totaux;

  return (
    <div className="space-y-5">
      {version.avertissement && <div className="rounded border border-warn/30 bg-warn-bg px-4 py-2 text-[13px] text-warn">{version.avertissement}</div>}
      {version.differences && (version.differences.ajoutes.length + version.differences.retires.length > 0) && (
        <div className="rounded border border-line bg-soft px-4 py-2 text-[13px]"><b>Modifications de l'ordre du jour :</b> {version.differences.ajoutes.map((x: string) => `ajouté « ${x} »`).concat(version.differences.retires.map((x: string) => `retiré « ${x} »`)).join(' ; ')}</div>)}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi icon={<Users className="h-4 w-4" />} title="Convoqués" value={t.total} sub={<>{t.envoyes} envoyé(s){t.echecs > 0 && <span className="font-semibold text-ko"> · {t.echecs} échec(s)</span>} · {s.parType.elu.total} élu(s), {s.parType.agent.total} agent(s)</>} />
        <Kpi icon={<Mail className="h-4 w-4" />} title="Lien ouvert" value={`${s.taux.ouverture} %`} sub={`${t.ouverts} / ${t.envoyes}${s.delaiMoyenPremiereOuvertureHeures !== null ? ` · 1re ouverture après ${s.delaiMoyenPremiereOuvertureHeures} h en moyenne` : ''}`} />
        <Kpi icon={<FileText className="h-4 w-4" />} title="Convocation lue" value={`${s.taux.convocationLue} %`} sub={`${t.convocationLue} / ${t.envoyes}`} tone={s.taux.convocationLue === 100 ? 'ok' : undefined} />
        <Kpi icon={<Eye className="h-4 w-4" />} title="Ordre du jour lu" value={`${s.taux.odjLu} %`} sub={`${t.odjLu} / ${t.envoyes}`} tone={s.taux.odjLu === 100 ? 'ok' : undefined} />
        <Kpi icon={<Check className="h-4 w-4" />} title="Accusés de lecture" value={t.accuses} sub={`${s.taux.accuse} % des envois`} />
        <Kpi icon={<UserCheck className="h-4 w-4" />} title="Réponses" value={`${t.presents + t.absents} / ${t.envoyes}`} sub={`${t.presents} présent(s) · ${t.absents} absent(s) · ${t.sansReponse} sans réponse`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4"><h3 className="mb-2 text-[14px]">Consultations par jour</h3>
          {!s.chronologie.length ? <p className="text-mute">Aucune consultation pour l'instant.</p> : (() => { const max = Math.max(...s.chronologie.map((c: any) => c.ouvertures + c.convocation + c.odj), 1); return (
            <div className="flex h-32 items-end gap-2" role="img" aria-label="Histogramme des consultations par jour">{s.chronologie.map((c: any) => (
              <div key={c.jour} className="flex min-w-[28px] flex-1 flex-col items-center justify-end" title={`${c.jour} : ${c.ouvertures} ouverture(s), ${c.convocation} convocation(s), ${c.odj} ordre(s) du jour`}>
                <div className="flex w-full flex-col-reverse overflow-hidden rounded-t" style={{ height: `${((c.ouvertures + c.convocation + c.odj) / max) * 100}%` }}>
                  <div className="bg-slate-300" style={{ flex: c.ouvertures }} /><div className="bg-action" style={{ flex: c.convocation }} /><div className="bg-emerald-500" style={{ flex: c.odj }} /></div>
                <div className="mt-1 text-[10px] text-mute">{c.jour.slice(5)}</div></div>))}</div>); })()}
          <div className="mt-2 flex gap-3 text-[11px] text-mute"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-slate-300" />ouvertures</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-action" />convocation</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500" />ordre du jour</span></div>
        </section>
        <section className="card p-4"><h3 className="mb-2 text-[14px]">Par public</h3>
          <table className="w-full text-[13px]"><thead><tr><th>Public</th><th>Convoqués</th><th>Convocation lue</th><th>Ordre du jour lu</th><th>Réponses</th></tr></thead><tbody>
            {([['Élus', s.parType.elu], ['Agents de la Ville', s.parType.agent]] as [string, any][]).map(([l, x]) => <tr key={l}><td className="font-semibold">{l}</td><td>{x.total}</td><td>{x.convocationLue}/{x.envoyes}</td><td>{x.odjLu}/{x.envoyes}</td><td>{x.presents + x.absents}</td></tr>)}
            {s.parGroupe.map((g: any) => <tr key={g.groupe} className="text-mute"><td>↳ {g.groupe}</td><td>{g.total}</td><td>{g.convocationLue}/{g.envoyes}</td><td>{g.odjLu}/{g.envoyes}</td><td>{g.presents + g.absents}</td></tr>)}
          </tbody></table></section>
      </div>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3"><h3 className="text-[14px]">Convoqués</h3>
          <div className="flex gap-1">{([['tous', 'Tous'], ['non_lecteurs', `Non-lecteurs (${s.nonLecteurs.length})`], ['elus', 'Élus'], ['agents', 'Agents']] as const).map(([k, l]) => <button key={k} onClick={() => setFiltre(k)} className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${filtre === k ? 'border-primary bg-primary text-white' : 'border-line bg-white'}`}>{l}</button>)}</div>
          <span className="ml-auto flex gap-2">
            {n === newest && <button className="btn-secondary !py-1" disabled={busy || !s.nonLecteurs.length} onClick={() => relancer('non_lecteurs')}>{busy && <Spinner />}<BellRing className="h-3.5 w-3.5" /> Relancer les non-lecteurs ({s.nonLecteurs.length})</button>}
            <button className="btn-secondary !py-1" onClick={csv}><Download className="h-3.5 w-3.5" /> Preuve (CSV)</button></span>
        </div>
        {dests.loading ? <Loading /> : (
          <div className="overflow-x-auto"><table className="w-full text-[13px]"><thead><tr><th>Convoqué</th><th>Envoi</th><th>Lien ouvert</th><th>Convocation</th><th>Ordre du jour</th><th>Accusé</th><th>Réponse</th><th /></tr></thead><tbody>
            {shown.map((d) => (
              <tr key={d.id}>
                <td><b>{d.nom}</b> <Badge tone={d.kind === 'agent' ? 'blue' : undefined}>{d.kind === 'agent' ? 'agent' : 'élu'}</Badge><div className="text-[11px] text-mute">{[d.qualite, d.groupe, d.email].filter(Boolean).join(' · ')}</div></td>
                <td>{d.envoi.statut === 'envoye' ? <span>{when(d.envoi.at)}{d.relances > 0 && <div className="text-[11px] text-warn">{d.relances} relance(s)</div>}</span> : d.envoi.statut === 'echec' ? <Badge tone="ko">échec</Badge> : <Badge>en attente</Badge>}{d.envoi.erreur && <div className="text-[11px] text-ko">{d.envoi.erreur}</div>}</td>
                <td>{d.ouvertures ? <span>{when(d.premiereOuvertureAt)}<div className="text-[11px] text-mute">{d.ouvertures} fois</div></span> : <span className="text-mute">jamais</span>}</td>
                <td>{d.convocationLue.fois ? <span className="text-ok">✓ {when(d.convocationLue.at)}</span> : <span className="text-mute">non</span>}</td>
                <td>{d.odjLu.fois ? <span className="text-ok">✓ {when(d.odjLu.at)}</span> : <span className="text-mute">non</span>}</td>
                <td>{d.accuseAt ? <span className="text-ok">✓ {when(d.accuseAt)}</span> : <span className="text-mute">—</span>}</td>
                <td>{d.reponse ? <Badge tone={d.reponse === 'present' ? 'ok' : 'warn'}>{d.reponse === 'present' ? 'présent(e)' : 'absent(e)'}</Badge> : <span className="text-mute">—</span>}{d.reponseCommentaire && <div className="text-[11px] text-mute">{d.reponseCommentaire}</div>}</td>
                <td className="text-right"><button className="rounded p-1 text-mute hover:bg-slate-100" title="Copier le lien personnel" aria-label={`Copier le lien de ${d.nom}`} onClick={() => copy(d)}>{copied === d.id ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}</button></td>
              </tr>))}
            {!shown.length && <tr><td colSpan={8} className="py-6 text-center text-mute">Aucun convoqué dans cette vue.</td></tr>}
          </tbody></table></div>)}
        <p className="border-t border-line px-4 py-2 text-[11px] text-mute">Chaque convoqué a un lien personnel unique : « Lien ouvert » = la page de convocation a été ouverte ; « Convocation » / « Ordre du jour » = le PDF correspondant a été consulté. Les adresses IP ne sont conservées que sous forme d'empreinte.</p>
      </section>
    </div>
  );
}

function Journal({ root, n }: { root: string; n: number }) {
  const [type, setType] = useState(''); const [limit, setLimit] = useState(100);
  const j = useLoad(async () => (await api.get(`${root}/versions/${n}/journal`, { params: { type: type || undefined, limit } })).data as { total: number; items: any[] }, [root, n, type, limit]);
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3"><h3 className="text-[14px]">Journal de preuve</h3>
        <select className="input w-auto" aria-label="Type d'évènement" value={type} onChange={(e) => setType(e.target.value)}><option value="">Tous les évènements</option>{Object.entries(EVENT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <span className="ml-auto text-[12px] text-mute">{j.data?.total ?? 0} évènement(s)</span></div>
      {j.loading ? <Loading /> : !j.data?.items.length ? <Empty>Aucun évènement.</Empty> : (
        <div className="overflow-x-auto"><table className="w-full text-[13px]"><thead><tr><th>Date</th><th>Évènement</th><th>Convoqué</th><th>Détail</th></tr></thead><tbody>{j.data.items.map((e) => (
          <tr key={e.id}><td className="whitespace-nowrap">{dt(e.at, { dateStyle: 'short', timeStyle: 'medium' })}</td><td><Badge tone={EVENT[e.type]?.tone}>{EVENT[e.type]?.label ?? e.type}</Badge></td>
            <td>{e.nom ? <span><b>{e.nom}</b> <span className="text-[11px] text-mute">{e.kind === 'agent' ? 'agent' : 'élu'}</span></span> : '—'}</td>
            <td className="text-[12px] text-mute">{e.meta?.erreur ?? (e.meta?.reponse ? (e.meta.reponse === 'present' ? 'présent(e)' : 'absent(e)') : '')}{e.empreinteIp ? `${e.meta ? ' · ' : ''}empreinte ${e.empreinteIp}` : ''}</td></tr>))}</tbody></table></div>)}
      {j.data && j.data.items.length < j.data.total && <div className="border-t border-line p-3 text-center"><button className="btn-secondary" onClick={() => setLimit(limit + 200)}>Afficher plus</button></div>}
    </section>
  );
}

function SendForm({ prep, root, onClose, onDone }: { prep: any; root: string; onClose: () => void; onDone: () => void }) {
  const [sel, setSel] = useState<number[]>(prep.elus.filter((e: any) => e.aUnEmail).map((e: any) => e.id)); const [agents, setAgents] = useState<string[]>(prep.agentsSuggeres ?? []);
  const [message, setMessage] = useState(''); const [urgence, setUrgence] = useState(false); const [motif, setMotif] = useState('');
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const late = !prep.delai.ok; const modif = prep.versions.length > 0; const total = sel.length + agents.length;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.post(root, { eluIds: sel, agents, message: message.trim() || undefined, urgence: urgence && late, urgenceMotif: urgence && late ? motif : undefined }); onDone(); onClose(); } catch (x) { setErr(errMsg(x)); setBusy(false); }
  };
  return (
    <Modal title={modif ? `Envoyer un modificatif (version ${prep.prochaineVersion})` : 'Convoquer'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4"><ErrorBox msg={err} />
        <section><div className="mb-1 flex items-center justify-between"><h4>Élus ({sel.length}/{prep.elus.length})</h4>
          <span className="flex gap-3 text-[12px]"><button type="button" className="text-action" onClick={() => setSel(prep.elus.filter((e: any) => e.aUnEmail).map((e: any) => e.id))}>Tous</button><button type="button" className="text-action" onClick={() => setSel([])}>Aucun</button></span></div>
          <ul className="max-h-48 divide-y divide-line overflow-auto rounded border border-line">{prep.elus.map((e: any) => (
            <li key={e.id}><label className="flex items-center gap-3 px-3 py-1.5 text-[13px]"><input type="checkbox" checked={sel.includes(e.id)} onChange={(ev) => setSel(ev.target.checked ? [...sel, e.id] : sel.filter((x) => x !== e.id))} />
              <span className="flex-1"><b>{e.nom}</b> <span className="text-mute">{[e.qualite, e.groupe].filter(Boolean).join(' · ')}</span></span>{!e.aUnEmail && <Badge tone="warn">sans e-mail</Badge>}</label></li>))}</ul></section>
        <section><h4 className="mb-1">Agents de la Ville convoqués</h4><p className="mb-2 text-[12px] text-mute">DGS, directeurs, rapporteurs, secrétaires… Tapez @nom : chacun reçoit son propre lien.</p>
          <AgentList value={agents} onChange={setAgents} /></section>
        <Field label="Message (facultatif)" hint="Ajouté à la convocation et au mail."><textarea className="input min-h-[70px]" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={3000} /></Field>
        {late && (
          <div className="rounded border border-warn/30 bg-warn-bg p-3 text-[13px]"><label className="flex items-center gap-2 font-semibold text-warn"><input type="checkbox" checked={urgence} onChange={(e) => setUrgence(e.target.checked)} /> Convocation en urgence (délai réduit : {prep.delai.joursFrancs} jour(s) franc(s), {prep.delai.requis} requis)</label>
            {urgence && <input className="input mt-2" required minLength={5} placeholder="Motif de l'urgence (obligatoire)" value={motif} onChange={(e) => setMotif(e.target.value)} />}</div>)}
        <p className="text-[12px] text-mute">{total} convoqué(s). Chacun reçoit un mail avec un <b>lien personnel unique</b> ; l'ouverture du lien et la consultation des documents sont enregistrées.</p>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy || !total || (late && !urgence && prep.delai.mode === 'bloquer')}>{busy && <Spinner />} Envoyer</button></div>
      </form>
    </Modal>
  );
}
