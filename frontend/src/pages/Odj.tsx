import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Download, GripVertical, Lock, Plus, Trash2, Undo2 } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { TeamsForm, TeamsLink } from '../Reunions';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageTitle, Spinner, useLoad, useToast } from '../ui';

/** Ordre du jour d'une séance : classement par glisser-déposer (ou clavier), numérotation, affectation, arrêt (section 16.2). */
/** Fond d'une ligne selon l'état de validation du dossier (D57). */
const ETAT: Record<string, { bg: string; label: string; tone?: 'ok' | 'warn' | 'blue' }> = {
  pret: { bg: 'bg-emerald-50', label: 'Prêt (circuit terminé)', tone: 'ok' },
  en_circuit: { bg: 'bg-sky-50', label: 'En cours de validation', tone: 'blue' },
  a_corriger: { bg: 'bg-amber-50', label: 'À corriger', tone: 'warn' },
  brouillon: { bg: 'bg-slate-100', label: 'En rédaction' },
};
const Legende = () => (
  <span className="flex flex-wrap gap-3 text-[11px] text-mute">{Object.entries(ETAT).map(([k, v]) => <span key={k} className="inline-flex items-center gap-1"><span className={`inline-block h-3 w-3 rounded border border-line ${v.bg}`} />{v.label}</span>)}</span>
);

export default function Odj() {
  const { id } = useParams();
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const odj = useLoad(async () => (await api.get(orgPath(o, `/seances/${id}/odj`))).data, [o, id]);
  const visant = useLoad(async () => (await api.get(orgPath(o, `/seances/${id}/odj/visant`))).data.items as any[], [o, id]);
  const pendingLoad = useLoad(async () => (await api.get(orgPath(o, `/seances/${id}/odj/en-attente`))).data.items as any[], [o, id]);
  const [order, setOrder] = useState<any[]>([]); const [dragFrom, setDragFrom] = useState<number | null>(null); const [over, setOver] = useState<number | null>(null);
  const [history, setHistory] = useState<any[][]>([]); const [sel, setSel] = useState<number[]>([]);
  const [arret, setArret] = useState<any>(null); const [busy, setBusy] = useState(false);
  const [point, setPoint] = useState<{ kind: 'libre' | 'chapitre'; titre: string; numerote: boolean } | null>(null);
  const [pattern, setPattern] = useState<{ value: string; exemples: string[] } | null>(null);
  const lockTimer = useRef<any>(null);
  const meta = useLoad(async () => (await api.get(orgPath(o, `/seances/${id}`))).data, [o, id]);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const d = odj.data;
  useEffect(() => { if (d) setOrder(d.items); }, [d]);
  useEffect(() => () => clearInterval(lockTimer.current), []);
  const arrete = d && d.statut !== 'en_preparation';

  /** Après l'arrêt, chaque modification demande un motif (ODJ-06). */
  const motifIfNeeded = (): string | undefined | null => { if (!arrete) return undefined; const m = prompt("L'ordre du jour est arrêté : indiquez le motif de cette modification (obligatoire)"); return m && m.trim().length >= 3 ? m.trim() : null; };
  const run = async (fn: (motif?: string) => Promise<any>, ok?: string) => {
    const motif = motifIfNeeded(); if (motif === null) return;
    setBusy(true);
    try { await fn(motif); if (ok) toast(ok); odj.reload(); pendingLoad.reload(); visant.reload(); }
    catch (e: any) { toast(errMsg(e), 'ko'); odj.reload(); } finally { setBusy(false); }
  };
  const lock = async () => { try { await api.post(orgPath(o, `/seances/${id}/odj/verrou`), {}); clearInterval(lockTimer.current); lockTimer.current = setInterval(() => api.post(orgPath(o, `/seances/${id}/odj/verrou`), {}).catch(() => {}), 240000); } catch (e: any) { toast(errMsg(e), 'ko'); throw e; } };

  const active = order.filter((i) => i.statut === 'a_traiter');
  const save = async (next: any[], keep = true) => {
    const motif = motifIfNeeded(); if (motif === null) { setOrder(d.items); return; }
    try {
      await lock();
      if (keep) setHistory((h) => [...h.slice(-20), order]);
      setOrder([...next, ...order.filter((i) => i.statut === 'retire')]);
      const r = await api.put(orgPath(o, `/seances/${id}/odj/ordre`), { ids: next.map((i) => i.id), motif });
      odj.setData(r.data);
    } catch (e: any) { toast(errMsg(e), 'ko'); odj.reload(); }
  };
  const move = (from: number, to: number) => { if (to < 0 || to >= active.length || from === to) return; const a = [...active]; const [x] = a.splice(from, 1); a.splice(to, 0, x); save(a); };
  const undo = async () => { const h = history[history.length - 1]; if (!h) return; setHistory(history.slice(0, -1)); await save(h.filter((i) => i.statut === 'a_traiter'), false); };

  const affecter = () => run((motif) => api.post(orgPath(o, `/seances/${id}/odj/affectations`), { acteIds: sel, motif }).then(() => setSel([])), 'Actes ajoutés à l\'ordre du jour');
  const retirer = (acteId: number) => { if (!confirm('Retirer ce dossier de l\'ordre du jour ?')) return; run((motif) => api.delete(orgPath(o, `/seances/${id}/odj/actes/${acteId}`), { params: { motif } }), 'Dossier retiré'); };
  const propose = async (critere: string) => {
    try { const r = (await api.get(orgPath(o, `/seances/${id}/odj/tri`), { params: { critere } })).data; const by = new Map(active.map((i) => [i.id, i])); if (confirm(`Appliquer le tri « ${critere} » ? Vous pourrez l'annuler.`)) save(r.ids.map((i: number) => by.get(i)).filter(Boolean)); } catch (e) { toast(errMsg(e), 'ko'); }
  };
  const doArret = async (forcer = false) => {
    setBusy(true);
    try { await api.post(orgPath(o, `/seances/${id}/odj/arret`), { forcer }); setArret(null); toast('Ordre du jour arrêté : numéros figés'); odj.reload(); }
    catch (e: any) { if (e.response?.status === 422) setArret(e.response.data.details); else toast(errMsg(e), 'ko'); } finally { setBusy(false); }
  };
  const exportCsv = async () => { const r = await api.get(orgPath(o, `/seances/${id}/odj/export.csv`), { responseType: 'blob' }); const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = `odj-${id}.csv`; a.click(); };
  const previewPattern = async (value: string) => { try { setPattern({ value, exemples: (await api.post(orgPath(o, '/numerotation/apercu'), { pattern: value, seanceId: Number(id) })).data.exemples }); } catch (e: any) { setPattern({ value, exemples: [`⚠ ${errMsg(e)}`] }); } };

  if (odj.loading && !d) return <Loading />;
  if (odj.error || !d) return <ErrorBox msg={odj.error || 'Séance introuvable'} />;
  const canEdit = d.canEdit;
  let ordre = 0;

  return (
    <div>
      <div className="mb-1 text-[12px] text-mute"><Link to="/seances" className="hover:underline">Séances & Ordre du jour</Link> › {d.seance.instance}</div>
      <PageTitle title={`${meta.data?.kind === 'commission' ? 'Projets présentés — ' : 'Ordre du jour — '}${dt(d.seance.dateSeance, { dateStyle: 'long' })}`}
        sub={<span>{meta.data?.teams && <span className="mr-2"><TeamsLink teams={meta.data.teams} /></span>}Format de numérotation : <code>{d.pattern}</code> · <Badge tone={arrete ? 'ok' : 'warn'}>{arrete ? `arrêté le ${dt(d.arreteAt, { dateStyle: 'short' })}` : 'en préparation — numéros provisoires'}</Badge>{d.lock && <span className="ml-2 inline-flex items-center gap-1 text-warn"><Lock className="h-3.5 w-3.5" /> en cours de modification par {d.lock.username}</span>}</span>}
        actions={<>
          {canEdit && meta.data && meta.data.statut !== 'annulee' && <button className="btn-secondary" onClick={() => setTeamsOpen(true)}>Teams…</button>}
          <button className="btn-secondary" onClick={exportCsv}><Download className="h-4 w-4" /> Tableau de suivi (CSV)</button>
          {canEdit && !arrete && <button className="btn-secondary" onClick={() => previewPattern(d.pattern)}>Numérotation…</button>}
          {canEdit && !arrete && <button className="btn-primary" onClick={() => doArret(false)} disabled={busy}>Arrêter l'ordre du jour</button>}
        </>} />
      {d.warnings.length > 0 && <div className="mb-4 rounded border border-warn/30 bg-warn-bg p-3 text-warn">{d.warnings.map((w: any) => <div key={w.itemId}>⚠ {w.message}</div>)}</div>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="card" aria-label="Ordre du jour">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
            <b>{d.totals.deliberations} délibération(s)</b>{d.totals.retires > 0 && <Badge>{d.totals.retires} retirée(s)</Badge>}
            {canEdit && <div className="ml-auto flex flex-wrap gap-2">
              <button className="btn-secondary !py-1" onClick={undo} disabled={!history.length}><Undo2 className="h-3.5 w-3.5" /> Annuler</button>
              <select className="input !w-auto !py-1" aria-label="Aide de tri" value="" onChange={(e) => { if (e.target.value) propose(e.target.value); }}><option value="">Trier par…</option><option value="rubrique">Rubrique</option><option value="rapporteur">Rapporteur</option><option value="numero">N° de suivi</option><option value="alpha">Ordre alphabétique</option></select>
              <button className="btn-secondary !py-1" onClick={() => setPoint({ kind: 'libre', titre: '', numerote: false })}><Plus className="h-3.5 w-3.5" /> Point libre / chapitre</button>
            </div>}
          </div>
          {order.some((i) => i.acte && i.acte.etat !== 'pret') && <div className="border-b border-line px-4 py-2"><Legende /></div>}
          {!order.length ? <Empty>Aucun point. Affectez des dossiers depuis la colonne de droite.</Empty> : (
            <ol>{order.map((it) => {
              const idx = active.findIndex((x) => x.id === it.id);
              if (it.statut === 'a_traiter' && it.kind !== 'chapitre' && it.numerote !== false) ordre++;
              if (it.kind === 'chapitre') return (
                <li key={it.id} draggable={canEdit} onDragStart={() => setDragFrom(idx)} onDragOver={(e) => { e.preventDefault(); setOver(idx); }} onDrop={() => { if (dragFrom !== null) move(dragFrom, idx); setDragFrom(null); setOver(null); }}
                  className={`flex items-center gap-2 border-b border-line bg-primary px-4 py-2 text-white ${over === idx ? 'ring-2 ring-action' : ''}`}>
                  {canEdit && <GripVertical className="h-4 w-4 cursor-grab opacity-70" />}<span className="flex-1 text-[12px] font-bold uppercase tracking-wider">{it.titre}</span>
                  {canEdit && <button aria-label="Supprimer le chapitre" onClick={() => run((m) => api.delete(orgPath(o, `/seances/${id}/odj/points/${it.id}`), { params: { motif: m } }))}><Trash2 className="h-4 w-4" /></button>}
                </li>);
              const retire = it.statut === 'retire';
              return (
                <li key={it.id} draggable={canEdit && !retire} onDragStart={() => setDragFrom(idx)} onDragEnd={() => { setDragFrom(null); setOver(null); }} onDragOver={(e) => { if (!retire) { e.preventDefault(); setOver(idx); } }}
                  onDrop={() => { if (dragFrom !== null && !retire) move(dragFrom, idx); setDragFrom(null); setOver(null); }}
                  className={`flex items-center gap-3 border-b border-line px-3 py-3 ${retire ? 'bg-slate-50 opacity-60' : (it.acte ? ETAT[it.acte.etat]?.bg : null) ?? 'bg-white'} ${dragFrom === idx ? 'opacity-40' : ''} ${over === idx && dragFrom !== idx ? 'shadow-lift ring-2 ring-action' : ''}`}>
                  {canEdit && !retire ? <GripVertical className="h-5 w-5 shrink-0 cursor-grab text-slate-400" aria-label="Poignée de déplacement" /> : <span className="w-5" />}
                  <div className="w-36 shrink-0"><div className={`font-mono text-[13px] font-bold ${it.provisoire ? 'italic text-mute' : 'text-primary'}`}>{it.numero ?? '—'}</div>{it.numero && it.provisoire && <div className="text-[10px] uppercase text-mute">provisoire</div>}{it.ajouteApresArret && <Badge tone="warn">ajouté</Badge>}</div>
                  <div className="min-w-0 flex-1">
                    <div className={`font-semibold ${retire ? 'line-through' : ''}`}>{it.acte ? <Link className="text-primary hover:underline" to={`/dossiers/${it.acte.id}`}>{it.titre}</Link> : it.titre}</div>
                    <div className="text-[12px] text-mute">{it.acte ? `Dossier #${it.acte.numeroSuivi} · ${it.acte.rubrique ?? '—'} · rapporteur : ${it.acte.rapporteur ?? '—'}` : 'Point libre'}{it.ordreDeliberation > 1 || (it.acte && order.filter((x) => x.acte?.id === it.acte.id).length > 1) ? ` · délibération ${it.ordreDeliberation}` : ''}</div>
                    {retire && <div className="text-[12px] text-ko">Retiré : {it.retireMotif}</div>}
                    {!retire && it.acte && it.acte.etat !== 'pret' && <div className="mt-0.5"><Badge tone={ETAT[it.acte.etat]?.tone}>{it.acte.etat === 'en_circuit' ? (it.acte.etape ?? 'En circuit') : ETAT[it.acte.etat]?.label}</Badge>{it.acte.holders?.length ? <span className="ml-2 text-[11px] text-mute">chez {it.acte.holders.join(', ')}</span> : null}</div>}
                  </div>
                  {canEdit && !retire && <div className="flex shrink-0 items-center">
                    <button className="rounded p-1 hover:bg-slate-100" aria-label="Monter" onClick={() => move(idx, idx - 1)} disabled={idx === 0}><ArrowUp className="h-4 w-4" /></button>
                    <button className="rounded p-1 hover:bg-slate-100" aria-label="Descendre" onClick={() => move(idx, idx + 1)} disabled={idx === active.length - 1}><ArrowDown className="h-4 w-4" /></button>
                    <button className="rounded p-1 text-ko hover:bg-ko-bg" aria-label="Retirer" onClick={() => (it.acte ? retirer(it.acte.id) : run((m) => api.delete(orgPath(o, `/seances/${id}/odj/points/${it.id}`), { params: { motif: m } })))}><Trash2 className="h-4 w-4" /></button></div>}
                </li>);
            })}</ol>)}
        </section>

        <aside className="card h-fit" aria-label="Dossiers en attente d'affectation">
          <div className="border-b border-line px-4 py-3"><h3>En attente d'affectation <Badge tone="blue">{pendingLoad.data?.length ?? 0}</Badge></h3><p className="text-[12px] text-mute">Dossiers dont le circuit est terminé ; les autres se trouvent plus bas et peuvent aussi être ajoutés.</p></div>
          {pendingLoad.loading ? <Loading /> : !pendingLoad.data?.length ? <Empty>Aucun dossier en attente.</Empty> : (
            <>
              <ul className="max-h-[60vh] overflow-auto">{pendingLoad.data.map((a) => (
                <li key={a.id} className="border-b border-line px-4 py-3"><label className="flex items-start gap-3"><input type="checkbox" className="mt-1" disabled={!canEdit} checked={sel.includes(a.id)} onChange={(e) => setSel(e.target.checked ? [...sel, a.id] : sel.filter((x) => x !== a.id))} />
                  <span className="min-w-0"><span className="block font-semibold">{a.titre}</span><span className="block text-[12px] text-mute">#{a.numeroSuivi} · {a.rubrique ?? '—'} · {a.rapporteur ?? 'sans rapporteur'}</span>
                    <span className="mt-1 flex flex-wrap gap-1">{a.deliberations > 1 && <Badge>{a.deliberations} délibérations</Badge>}{a.commissions > 0 && <Badge tone={a.avisRendus === a.commissions ? 'ok' : 'warn'}>avis {a.avisRendus}/{a.commissions}</Badge>}{a.seanceViseeId === Number(id) && <Badge tone="blue">séance visée</Badge>}</span></span></label></li>))}</ul>
              {canEdit && <div className="border-t border-line p-3"><button className="btn-primary w-full" disabled={!sel.length || busy} onClick={affecter}>{busy && <Spinner />} Ajouter {sel.length || ''} dossier(s) à l'ordre du jour</button></div>}
            </>)}
        </aside>
      </div>


      {(visant.data?.length ?? 0) > 0 && (
        <section className="card mt-6" aria-labelledby="visant">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3"><h3 id="visant">Dossiers proposés à cette séance</h3><Badge tone="blue">{visant.data!.length}</Badge>
            <span className="text-[12px] text-mute">Tous ceux qui visent cette séance, où qu'ils en soient dans le circuit — ils peuvent être ajoutés avant la fin du circuit.</span><span className="ml-auto"><Legende /></span></div>
          <table className="w-full"><thead><tr><th>N°</th><th>Dossier</th><th>Direction</th><th>Rapporteur</th><th>Avancement</th><th /></tr></thead><tbody>
            {visant.data!.map((a: any) => (
              <tr key={a.id} className={`hover:brightness-95 ${a.dansOdj ? '' : ETAT[a.etat]?.bg ?? ''}`}>
                <td className="font-mono text-[12px]">#{a.numeroSuivi}</td>
                <td><Link className="font-semibold text-primary hover:underline" to={`/dossiers/${a.id}`}>{a.titre}</Link><div className="text-[12px] text-mute">{a.rubrique ?? '—'} · {a.redacteur}</div></td>
                <td className="text-mute">{a.direction}</td><td>{a.rapporteur ?? <span className="text-warn">à désigner</span>}</td>
                <td>{a.dansOdj && <Badge tone="ok">À l'ordre du jour</Badge>} {a.etat === 'pret' ? <Badge tone="ok">{a.dansOdj ? 'Circuit terminé' : 'Prêt à affecter'}</Badge> : a.etat === 'brouillon' ? <Badge>En rédaction</Badge> : a.etat === 'a_corriger' ? <Badge tone="warn">À corriger</Badge> : <Badge tone="blue">{a.etape ?? a.statut}</Badge>}{a.holders?.length ? <div className="text-[11px] text-mute">chez {a.holders.join(', ')}</div> : null}</td>
                <td className="text-right">{canEdit && a.eligible && !a.dansOdj && !arrete && <button className="btn-secondary !py-1" disabled={busy} onClick={() => run((motif) => api.post(orgPath(o, `/seances/${id}/odj/affectations`), { acteIds: [a.id], motif }), 'Ajouté à l\'ordre du jour')}>Ajouter à l'ordre du jour</button>}</td>
              </tr>))}
          </tbody></table>
        </section>)}

      {point && <Modal title="Ajouter à l'ordre du jour" onClose={() => setPoint(null)}><div className="space-y-4">
        <Field label="Type"><select className="input" value={point.kind} onChange={(e) => setPoint({ ...point, kind: e.target.value as any })}><option value="libre">Point libre (approbation du PV, questions diverses…)</option><option value="chapitre">Chapitre (titre de regroupement, sans numéro)</option></select></Field>
        <Field label="Intitulé"><input className="input" autoFocus value={point.titre} onChange={(e) => setPoint({ ...point, titre: e.target.value })} /></Field>
        {point.kind === 'libre' && <label className="flex items-center gap-2"><input type="checkbox" checked={point.numerote} onChange={(e) => setPoint({ ...point, numerote: e.target.checked })} /> Numéroter ce point</label>}
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setPoint(null)}>Annuler</button>
          <button className="btn-primary" disabled={point.titre.trim().length < 2} onClick={() => { const p = point; setPoint(null); run((motif) => api.post(orgPath(o, `/seances/${id}/odj/points`), { ...p, motif }), 'Point ajouté'); }}>Ajouter</button></div></div></Modal>}

      {pattern && <Modal title="Format de numérotation" onClose={() => setPattern(null)}><div className="space-y-4">
        <Field label="Motif" hint="Variables : {ANNEE} {N_SEANCE} {ORDRE} {ORDRE:03} {RUBRIQUE} — préfixes, suffixes et séparateurs libres."><input className="input font-mono" value={pattern.value} onChange={(e) => previewPattern(e.target.value)} /></Field>
        <div className="rounded bg-soft p-3"><b>Aperçu</b><ul className="mt-1 font-mono">{pattern.exemples.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        <p className="text-[12px] text-mute">S'applique à cette séance tant que l'ordre du jour n'est pas arrêté ; les numéros déjà attribués ne changent jamais.</p>
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setPattern(null)}>Fermer</button>
          <button className="btn-primary" onClick={async () => { try { await api.put(orgPath(o, `/seances/${id}/odj/motif`), { pattern: pattern.value }); setPattern(null); toast('Format enregistré'); odj.reload(); } catch (e) { toast(errMsg(e), 'ko'); } }}>Enregistrer</button></div></div></Modal>}

      {arret && <Modal title="Anomalies avant l'arrêt" onClose={() => setArret(null)} wide><div className="space-y-3">
        <p>L'ordre du jour comporte des anomalies :</p><ul className="list-disc pl-5 text-warn">{(Array.isArray(arret) ? arret : []).map((p: any, i: number) => <li key={i}>{p.message}</li>)}</ul>
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setArret(null)}>Corriger</button><button className="btn-ko" onClick={() => doArret(true)}>Arrêter malgré tout</button></div></div></Modal>}
      {teamsOpen && meta.data && <TeamsForm seance={meta.data} onClose={() => setTeamsOpen(false)} onDone={() => { toast('Visioconférence enregistrée'); meta.reload(); }} />}
      {node}
    </div>
  );
}
