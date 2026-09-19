import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, CheckCircle2, Download, Eye, FileText, Paperclip, RotateCcw, Send, Trash2, Upload, XCircle } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { d, dt } from '../format';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, Spinner, StatutBadge, useLoad, useToast } from '../ui';

/* ------------------------------------------------------------------------------------------------ frise du circuit */
function Frise({ circuit }: { circuit: any }) {
  if (!circuit?.path?.length) return null;
  return (
    <ol className="flex gap-2 overflow-x-auto pb-2" aria-label="Circuit d'approbation">
      {circuit.path.filter((p: any) => p.state !== 'skipped').map((p: any, i: number) => {
        const cur = p.state === 'current'; const done = p.state === 'done';
        return (
          <li key={p.key} className={`min-w-[150px] flex-1 rounded-lg border p-3 ${cur ? 'border-primary bg-primary text-white' : done ? 'border-ok/30 bg-white' : 'border-line bg-white/60'}`}>
            <div className="flex items-center gap-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${done ? 'bg-ok text-white' : cur ? 'bg-action text-white ring-4 ring-action/30' : 'bg-line text-slate-600'}`}>{done ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
              <span className="truncate text-[12px] font-bold">{p.label}</span>
            </div>
            <div className={`mt-1 truncate text-[11px] ${cur ? 'text-white/80' : 'text-mute'}`}>
              {p.instance?.actedBy ? `${p.instance.actedBy}${p.instance.onBehalfOf ? ` (pour ${p.instance.onBehalfOf})` : ''}` : p.missing ? '⚠ aucun titulaire' : (p.holders || []).join(', ') || '—'}
            </div>
            {cur && circuit.due && <div className="mt-1 text-[11px] font-semibold">{circuit.late ? '⏰ en retard · ' : 'échéance '}{dt(circuit.due, { dateStyle: 'short' })}</div>}
          </li>
        );
      })}
    </ol>
  );
}

/* --------------------------------------------------------------------------------------------------- fiche de l'acte */
function Fiche({ acte, editable, onSaved }: { acte: any; editable: boolean; onSaved: () => void }) {
  const { org } = useAuth(); const o = org!.id;
  const matieres = useLoad(async () => (await api.get(orgPath(o, '/referentiels/matiere'))).data.items as any[], [o]);
  const rubriques = useLoad(async () => (await api.get(orgPath(o, '/referentiels/rubrique'))).data.items as any[], [o]);
  const natures = useLoad(async () => (await api.get(orgPath(o, '/referentiels/nature'))).data.items as any[], [o]);
  const elus = useLoad(async () => (await api.get(orgPath(o, '/elus'))).data.items as any[], [o]);
  const seances = useLoad(async () => (await api.get(orgPath(o, '/seances'), { params: { statut: 'planifiee' } })).data.items as any[], [o]);
  const [f, setF] = useState<any>({});
  const [err, setErr] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  useEffect(() => { setF({ titre: acte.titre, matiereId: acte.matiereId ?? '', rubriqueId: acte.rubriqueId ?? '', natureId: acte.natureId ?? '', incidenceFinanciere: acte.incidenceFinanciere, montant: acte.montant ?? '', rapporteurId: acte.rapporteurId ?? '', seanceViseeId: acte.seanceViseeId ?? '', urgence: acte.urgence }); }, [acte]);
  const leaves = useMemo(() => { const parents = new Set((matieres.data ?? []).map((m) => m.parentCode).filter(Boolean)); return (matieres.data ?? []).filter((m) => !parents.has(m.code)); }, [matieres.data]);
  const nv = (v: any) => (v === '' ? null : Number(v));

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await api.put(orgPath(o, `/actes/${acte.id}`), {
        titre: f.titre, matiereId: nv(f.matiereId), rubriqueId: nv(f.rubriqueId), natureId: nv(f.natureId), incidenceFinanciere: f.incidenceFinanciere,
        montant: f.incidenceFinanciere && f.montant !== '' ? Number(f.montant) : null, rapporteurId: nv(f.rapporteurId), seanceViseeId: nv(f.seanceViseeId), urgence: !!f.urgence,
      });
      onSaved();
    } catch (x) { setErr(errMsg(x)); } finally { setSaving(false); }
  };
  const dis = !editable;
  return (
    <section className="card p-5" aria-labelledby="fiche">
      <h3 id="fiche" className="mb-4 flex items-center gap-2"><FileText className="h-5 w-5 text-action" /> Informations clés de la délibération</h3>
      <ErrorBox msg={err} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Direction porteuse"><div className="input bg-soft">{acte.direction?.label}{acte.service ? ` · ${acte.service.label}` : ''}</div></Field>
        <Field label="Séance visée" hint="Proposée par le rédacteur ; modifiable par la hiérarchie.">
          <select className="input" disabled={dis && !acte.droits?.modifierSeance} value={f.seanceViseeId ?? ''} onChange={(e) => setF({ ...f, seanceViseeId: e.target.value })}>
            <option value="">— à définir —</option>{seances.data?.map((s) => <option key={s.id} value={s.id}>{s.instance} — {d(s.dateSeance)}</option>)}
          </select>
        </Field>
        <div className="md:col-span-2"><Field label="Titre explicite de l'acte *"><input className="input" disabled={dis} value={f.titre ?? ''} onChange={(e) => setF({ ...f, titre: e.target.value })} /></Field></div>
        <Field label="Domaine d'intervention (matière) *"><select className="input" disabled={dis} value={f.matiereId ?? ''} onChange={(e) => setF({ ...f, matiereId: e.target.value })}>
          <option value="">— choisir —</option>{leaves.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.libelle}</option>)}</select></Field>
        <Field label="Rubrique *"><select className="input" disabled={dis} value={f.rubriqueId ?? ''} onChange={(e) => setF({ ...f, rubriqueId: e.target.value })}>
          <option value="">— choisir —</option>{rubriques.data?.map((m) => <option key={m.id} value={m.id}>{m.libelle}</option>)}</select></Field>
        <Field label="Nature *"><select className="input" disabled={dis} value={f.natureId ?? ''} onChange={(e) => setF({ ...f, natureId: e.target.value })}>
          <option value="">— choisir —</option>{natures.data?.map((m) => <option key={m.id} value={m.id}>{m.libelle}</option>)}</select></Field>
        <Field label="Élu rapporteur *"><select className="input" disabled={dis} value={f.rapporteurId ?? ''} onChange={(e) => setF({ ...f, rapporteurId: e.target.value })}>
          <option value="">— choisir —</option>{elus.data?.map((m) => <option key={m.id} value={m.id}>{m.nomComplet}{m.role ? ` (${m.role})` : ''}</option>)}</select></Field>
        <div>
          <span className="label">Impact budgétaire (dépense ou recette) ? *</span>
          <div className="flex items-center gap-4 py-2">
            {[[true, 'Oui'], [false, 'Non']].map(([v, l]) => (
              <label key={String(v)} className="flex items-center gap-1"><input type="radio" name="inc" disabled={dis} checked={f.incidenceFinanciere === v} onChange={() => setF({ ...f, incidenceFinanciere: v })} /> {l as string}</label>))}
            {f.incidenceFinanciere && <label className="flex items-center gap-2 rounded bg-soft px-3 py-1">Montant <input type="number" min={0} className="w-28 bg-transparent font-semibold outline-none" disabled={dis} value={f.montant ?? ''} onChange={(e) => setF({ ...f, montant: e.target.value })} /> €</label>}
          </div>
        </div>
        <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" disabled={dis} checked={!!f.urgence} onChange={(e) => setF({ ...f, urgence: e.target.checked })} /> Dossier urgent</label>
      </div>
      {editable && <div className="mt-4 flex justify-end"><button className="btn-secondary" onClick={save} disabled={saving}>{saving && <Spinner />} Enregistrer la fiche</button></div>}
    </section>
  );
}

/* --------------------------------------------------------------------------------------------------------- textes */
function SpanView({ spans }: { spans: any[] }) {
  return <div className="whitespace-pre-wrap text-[16px] leading-[26px]">{spans.map((s, i) => s.type === 'insert'
    ? <ins key={i} style={{ color: s.color, background: `${s.color}1A`, textDecoration: 'none', fontWeight: 600 }} title={`${s.name || s.author}`}>{s.text}</ins>
    : s.type === 'delete' ? <del key={i} style={{ color: s.color, opacity: 0.8 }} title={`${s.name || s.author}`}>{s.text}</del> : <span key={i}>{s.text}</span>)}</div>;
}

function TexteEditor({ acte, t, editable, onChanged, toast }: { acte: any; t: any; editable: boolean; onChanged: () => void; toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const { org } = useAuth(); const o = org!.id;
  const base = orgPath(o, `/actes/${acte.id}/textes/${t.id}`);
  const [mode, setMode] = useState<'suivi' | 'propre'>('suivi');
  const [view, setView] = useState<any>(null);
  const [text, setText] = useState(''); const [version, setVersion] = useState(1);
  const [state, setState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved'); const [conflict, setConflict] = useState<string | null>(null);
  const timer = useRef<any>(null); const latest = useRef({ text: '', version: 1 });

  const load = useCallback(async () => {
    const r = (await api.get(base, { params: { mode } })).data;
    setView(r); setText(r.markdown); setVersion(r.version); latest.current = { text: r.markdown, version: r.version }; setState('saved');
  }, [base, mode]);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const commit = useCallback(async () => {
    setState('saving');
    try {
      const r = (await api.put(base, { markdown: latest.current.text, baseVersion: latest.current.version })).data;
      latest.current.version = r.version; setVersion(r.version); setState('saved'); setConflict(null);
      if (r.changed) load().then(onChanged);
    } catch (e: any) {
      if (e.response?.status === 409 && e.response.data?.details?.currentVersion) setConflict('Ce texte a été modifié par quelqu\'un d\'autre. Rechargez pour voir sa version.');
      else toast(errMsg(e), 'ko');
      setState('error');
    }
  }, [base, load, onChanged, toast]);

  const change = (v: string) => { setText(v); latest.current.text = v; setState('dirty'); clearTimeout(timer.current); timer.current = setTimeout(commit, 1500); };
  useEffect(() => () => clearTimeout(timer.current), []);

  const resolve = async (decision: 'accept' | 'reject', cid?: string) => {
    try { await api.post(`${base}/modifications`, cid ? { decision, cids: [cid] } : { decision, all: true }); await load(); onChanged(); } catch (e) { toast(errMsg(e), 'ko'); }
  };
  const canResolve = editable && view?.tracking && view?.changes?.length;
  const preview = async () => {
    try {
      await commit();
      const r = await api.post(orgPath(o, `/actes/${acte.id}/apercu`), { cible: t.kind === 'expose' ? 'expose' : 'deliberation', deliberationId: t.deliberationId ?? undefined, mode: view?.tracking ? 'suivi' : 'propre' }, { responseType: 'blob' });
      window.open(URL.createObjectURL(r.data), '_blank');
    } catch (e: any) { toast('Aperçu impossible : ' + (e?.response?.data instanceof Blob ? 'erreur serveur' : errMsg(e)), 'ko'); }
  };
  if (!view) return <Loading />;
  const readOnly = !editable || !view.canEdit;
  return (
    <div className="mb-8">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3>{t.label}{t.deliberationId ? '' : ''}</h3>
        <div className="flex items-center gap-2 text-[12px]">
          {view.tracking && <div className="flex rounded bg-soft p-0.5">{(['suivi', 'propre'] as const).map((m) => <button key={m} className={`rounded px-2 py-1 font-semibold ${mode === m ? 'bg-white shadow-card' : ''}`} onClick={() => setMode(m)}>{m === 'suivi' ? 'Suivi coloré' : 'Version propre'}</button>)}</div>}
          {!readOnly && <span className={state === 'error' ? 'text-ko' : 'text-mute'}>{state === 'saving' ? 'Enregistrement…' : state === 'dirty' ? 'Modifications en attente…' : state === 'error' ? 'Non enregistré' : `Enregistré · v${version}`}</span>}
          <button className="btn-secondary !py-1" onClick={preview}><Eye className="h-3.5 w-3.5" /> Aperçu mis en page</button>
        </div>
      </div>
      {conflict && <div role="alert" className="mb-2 rounded border border-warn/30 bg-warn-bg p-2 text-warn">{conflict} <button className="underline" onClick={load}>Recharger</button></div>}
      {readOnly || mode === 'propre'
        ? <div className="rounded border border-line bg-white p-4">{view.markdown ? (mode === 'suivi' && view.tracking ? <SpanView spans={view.spans} /> : <div className="whitespace-pre-wrap text-[16px] leading-[26px]">{view.markdown}</div>) : <span className="text-mute">Texte vide.</span>}</div>
        : (
          <>
            {view.tracking && view.changes.length > 0 && <div className="mb-2 rounded border border-line bg-white p-3"><SpanView spans={view.spans} /></div>}
            <textarea className="input min-h-[160px] text-[16px] leading-[26px]" value={text} onChange={(e) => change(e.target.value)} onBlur={() => { if (state === 'dirty') { clearTimeout(timer.current); commit(); } }}
              aria-label={t.label} placeholder={t.kind === 'expose' ? "Résumez l'intérêt communal en quelques paragraphes simples…" : t.kind === 'visas' ? 'Vu le code général des collectivités territoriales…' : 'ARTICLE 1 : …'} />
          </>
        )}
      {canResolve && mode === 'suivi' && (
        <div className="mt-2 rounded border border-line bg-white">
          <div className="flex items-center justify-between border-b border-line px-3 py-2"><b>{view.changes.length} modification(s) suivie(s)</b>
            <span className="flex gap-2"><button className="btn-ok !py-1" onClick={() => resolve('accept')}>Tout accepter</button></span></div>
          <ul>{view.changes.map((c: any) => (
            <li key={c.cid} className="flex items-center gap-2 border-b border-line px-3 py-2 last:border-0">
              <span className="h-3 w-3 rounded-full" style={{ background: c.color }} /><span className="text-[12px] font-semibold">{c.name || c.author}</span>
              <span className="min-w-0 flex-1 truncate text-[12px]">{c.deleted && <del className="mr-2 text-ko">{c.deleted}</del>}{c.inserted && <ins className="text-ok-text no-underline">{c.inserted}</ins>}</span>
              <button className="text-ok" aria-label="Accepter" onClick={() => resolve('accept', c.cid)}><CheckCircle2 className="h-5 w-5" /></button>
              <button className="text-ko" aria-label="Rejeter" onClick={() => resolve('reject', c.cid)}><XCircle className="h-5 w-5" /></button>
            </li>))}</ul>
        </div>
      )}
    </div>
  );
}

function Textes({ acte, editable, onChanged, toast }: { acte: any; editable: boolean; onChanged: () => void; toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const { org } = useAuth();
  const texts = useLoad(async () => (await api.get(orgPath(org!.id, `/actes/${acte.id}/textes`))).data.items as any[], [acte.id, acte.statut]);
  if (texts.loading) return <Loading />;
  const dels = acte.deliberations || [];
  return (
    <section className="card p-5" aria-labelledby="textes">
      <h3 id="textes" className="mb-4">Textes de la délibération</h3>
      {(texts.data ?? []).map((t) => (
        <div key={t.id}>
          {t.deliberationId && dels.length > 1 && t.kind === 'visas' && <h4 className="mb-2 mt-4 text-[15px] font-bold text-primary">Délibération {dels.find((x: any) => x.id === t.deliberationId)?.ordre} — {dels.find((x: any) => x.id === t.deliberationId)?.titre}</h4>}
          <TexteEditor acte={acte} t={t} editable={editable} onChanged={onChanged} toast={toast} />
        </div>))}
    </section>
  );
}

/* ------------------------------------------------------------------------------------------------------- annexes */
function Annexes({ acte, editable, toast }: { acte: any; editable: boolean; toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const { org } = useAuth(); const o = org!.id;
  const list = useLoad(async () => (await api.get(orgPath(o, `/actes/${acte.id}/annexes`))).data.items as any[], [acte.id]);
  const [busy, setBusy] = useState(false); const input = useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    setBusy(true);
    try { const fd = new FormData(); fd.append('titre', file.name.replace(/\.pdf$/i, '')); fd.append('communicable', 'true'); fd.append('file', file); await api.post(orgPath(o, `/actes/${acte.id}/annexes`), fd); list.reload(); }
    catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); }
  };
  const download = async (a: any) => { const r = await api.get(orgPath(o, `/actes/${acte.id}/annexes/${a.id}/file`), { responseType: 'blob' }); window.open(URL.createObjectURL(r.data), '_blank'); };
  return (
    <section className="card p-5" aria-labelledby="annexes">
      <h3 id="annexes" className="mb-3 flex items-center gap-2"><Paperclip className="h-5 w-5 text-action" /> Pièces jointes au dossier</h3>
      {editable && (
        <div className="mb-4 cursor-pointer rounded-lg border-2 border-dashed border-action/30 bg-soft p-6 text-center" onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) upload(f); }}>
          {busy ? <Spinner /> : <Upload className="mx-auto h-6 w-6 text-action" />}
          <div className="mt-1 font-semibold">Glissez votre fichier ici ou cliquez pour choisir</div><div className="text-[12px] text-mute">PDF uniquement (annexes, plans, devis…)</div>
          <input ref={input} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
        </div>)}
      {list.loading ? <Loading /> : !list.data?.length ? <p className="text-mute">Aucune pièce jointe.</p> : (
        <ul>{list.data.map((a) => (
          <li key={a.id} className="flex items-center gap-3 border-b border-line py-2 last:border-0">
            <span className="flex h-10 w-10 items-center justify-center rounded bg-ko-bg text-[10px] font-bold text-ko">PDF</span>
            <div className="min-w-0 flex-1"><div className="truncate font-semibold">{a.titre}</div><div className="text-[12px] text-mute">{a.fichier.pages} p. · {(a.fichier.taille / 1048576).toFixed(1)} Mo · v{a.version} · {a.createdBy}</div></div>
            {a.communicable && <Badge tone="ok">Communicable</Badge>}
            <button className="text-slate-600 hover:text-primary" aria-label="Télécharger" onClick={() => download(a)}><Download className="h-5 w-5" /></button>
            {editable && <button className="text-slate-600 hover:text-ko" aria-label="Supprimer" onClick={async () => { if (confirm(`Supprimer « ${a.titre} » ?`)) { await api.delete(orgPath(o, `/actes/${acte.id}/annexes/${a.id}`)); list.reload(); } }}><Trash2 className="h-5 w-5" /></button>}
          </li>))}</ul>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------------------------------------------- discussion */
function Discussion({ acte, toast }: { acte: any; toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const { org } = useAuth(); const o = org!.id;
  const list = useLoad(async () => (await api.get(orgPath(o, `/actes/${acte.id}/commentaires`))).data.items as any[], [acte.id]);
  const [body, setBody] = useState('');
  const send = async () => { if (!body.trim()) return; try { await api.post(orgPath(o, `/actes/${acte.id}/commentaires`), { body }); setBody(''); list.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  return (
    <section className="card p-5" aria-labelledby="disc">
      <h3 id="disc" className="mb-3">Discussion <Badge tone="blue">{list.data?.length ?? 0}</Badge></h3>
      <ul className="mb-3 space-y-2">{(list.data ?? []).map((c) => (
        <li key={c.id} className={`rounded border p-3 ${c.kind === 'refus' ? 'border-warn/40 bg-warn-bg' : 'border-line bg-slate-50'}`}>
          <div className="flex justify-between text-[11px] text-mute"><b className="text-slate-700">{c.author}{c.kind === 'refus' ? ' · modification demandée' : ''}</b><span>{dt(c.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</span></div>
          <div className="mt-1 whitespace-pre-wrap">{c.body}</div></li>))}
      </ul>
      <textarea className="input" rows={2} placeholder="Écrire une consigne ou mentionner un collègue avec @identifiant…" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="mt-2 flex justify-end"><button className="btn-secondary" onClick={send}>Publier</button></div>
    </section>
  );
}

/* ------------------------------------------------------------------------------------- panneau latéral : actions */
function Actions({ acte, circuit, reload, toast }: { acte: any; circuit: any; reload: () => void; toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const { org } = useAuth(); const o = org!.id;
  const [busy, setBusy] = useState(false); const [refus, setRefus] = useState(false); const [motif, setMotif] = useState('');
  const [target, setTarget] = useState('previous'); const [resume, setResume] = useState('direct'); const [derog, setDerog] = useState<any>(null);
  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true);
    try { await fn(); toast(ok); reload(); }
    catch (e: any) { if (e.response?.status === 423) setDerog(e.response.data); else toast(errMsg(e), 'ko'); }
    finally { setBusy(false); }
  };
  const a = circuit?.actions ?? {};
  return (
    <>
      <div className="card p-5">
        <h3 className="mb-2">Actions</h3>
        {a.submit && <button className="btn-primary w-full" disabled={busy} onClick={() => act(() => api.post(orgPath(o, `/actes/${acte.id}/envoi`)), 'Dossier envoyé au circuit')}><Send className="h-4 w-4" /> {acte.statut === 'modification_demandee' ? 'Renvoyer au circuit' : 'Envoyer pour validation'}</button>}
        {a.validate && <button className="btn-ok mt-2 w-full" disabled={busy} onClick={() => act(() => api.post(orgPath(o, `/actes/${acte.id}/validation`), {}), 'Étape validée')}><Check className="h-4 w-4" /> Valider{a.onBehalfOf ? ` (pour ${a.onBehalfOf})` : ''}</button>}
        {a.refuse && <button className="btn-ko mt-2 w-full" disabled={busy} onClick={() => setRefus(true)}><RotateCcw className="h-4 w-4" /> Demander une modification…</button>}
        {!a.submit && !a.validate && !a.refuse && <p className="text-mute">{circuit?.submitted ? 'Vous n\'avez rien à faire sur ce dossier pour le moment.' : 'Vous ne pouvez pas envoyer ce dossier.'}</p>}
        {circuit?.blocked && <p className="mt-2 rounded bg-ko-bg p-2 text-ko">Étape sans titulaire : contactez l'administrateur.</p>}
      </div>
      {refus && (
        <Modal title="Demander une modification" onClose={() => setRefus(false)}>
          <div className="space-y-4">
            <Field label="Renvoyer à"><select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="previous">L'étape précédente</option>{(circuit.refuseTargets || []).map((t: any) => <option key={t.key} value={t.key}>{t.first ? `${t.label} (rédacteur)` : t.label}</option>)}
            </select></Field>
            <Field label="Après correction, l'acte…"><select className="input" value={resume} onChange={(e) => setResume(e.target.value)}>
              <option value="direct">revient directement à mon étape</option><option value="complet">repasse par tout le circuit</option></select></Field>
            <Field label="Motif (obligatoire)"><textarea className="input" rows={4} value={motif} onChange={(e) => setMotif(e.target.value)} autoFocus /></Field>
            <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setRefus(false)}>Annuler</button>
              <button className="btn-ko" disabled={busy || motif.trim().length < 3} onClick={() => act(() => api.post(orgPath(o, `/actes/${acte.id}/refus`), { target, resume, motif }).then(() => setRefus(false)), 'Modification demandée')}>Renvoyer</button></div>
          </div>
        </Modal>)}
      {derog && <DerogModal acte={acte} info={derog} onClose={() => setDerog(null)} toast={toast} reload={reload} />}
    </>
  );
}

function DerogModal({ acte, info, onClose, toast, reload }: { acte: any; info: any; onClose: () => void; toast: (m: string, k?: 'ok' | 'ko') => void; reload: () => void }) {
  const { org } = useAuth(); const o = org!.id; const [motif, setMotif] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <Modal title="Date limite de rédaction dépassée" onClose={onClose}>
      <p className="mb-4 rounded bg-warn-bg p-3 text-warn">{info.error}</p>
      <Field label="Motif de la demande de dérogation"><textarea className="input" rows={3} value={motif} onChange={(e) => setMotif(e.target.value)} /></Field>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {info.details?.seanceSuivanteId && <button className="btn-secondary" disabled={busy} onClick={async () => { setBusy(true); try { await api.post(orgPath(o, `/actes/${acte.id}/report`), { motif: 'Reporté à la séance suivante (date limite dépassée)' }); toast('Dossier reporté à la séance suivante'); onClose(); reload(); } catch (e) { toast(errMsg(e), 'ko'); setBusy(false); } }}>Reporter à la séance suivante</button>}
        <button className="btn-primary" disabled={busy || motif.trim().length < 5} onClick={async () => { setBusy(true); try { await api.post(orgPath(o, `/actes/${acte.id}/derogations`), { motif }); toast('Demande envoyée au SCC / DGS'); onClose(); } catch (e) { toast(errMsg(e), 'ko'); setBusy(false); } }}>Demander une dérogation</button>
      </div>
    </Modal>
  );
}

function Completude({ c }: { c: any }) {
  if (!c) return null;
  return (
    <div className="card p-5">
      <h3 className="mb-2 flex items-center gap-2"><CheckCircle2 className={`h-5 w-5 ${c.complete ? 'text-ok' : 'text-mute'}`} /> État de complétude</h3>
      {c.complete ? <p className="rounded bg-ok-bg p-2 text-ok-text">Votre dossier est prêt à être envoyé.</p> : (
        <ul className="space-y-1">{c.missing.map((m: any) => <li key={m.code} className="flex items-center gap-2 text-warn"><span>•</span>{m.label}</li>)}</ul>)}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- commissions (avis) */
function CommissionsBox({ acte, editable, toast }: { acte: any; editable: boolean; toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const { org } = useAuth(); const o = org!.id;
  const mine = useLoad(async () => (await api.get(orgPath(o, `/actes/${acte.id}/commissions`))).data, [acte.id]);
  const all = useLoad(async () => (await api.get(orgPath(o, '/commissions'), { params: { actif: 'true' } })).data.items as any[], [o]);
  const [sel, setSel] = useState('');
  const AVIS: Record<string, string> = { favorable: 'Favorable', defavorable: 'Défavorable', reserve: 'Réservé', sans_avis: 'Sans avis' };
  const add = async () => { try { await api.post(orgPath(o, `/actes/${acte.id}/commissions`), { commissionId: Number(sel) }); setSel(''); mine.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  const remove = async (c: any) => {
    const motif = c.misADispositionAt ? prompt('Motif du retrait (obligatoire, les membres seront prévenus) :') : undefined;
    if (c.misADispositionAt && !motif) return;
    try { await api.delete(orgPath(o, `/actes/${acte.id}/commissions/${c.commissionId}`), { params: { motif } }); mine.reload(); } catch (e) { toast(errMsg(e), 'ko'); }
  };
  const avis = async (c: any) => {
    const v = prompt('Avis (favorable, defavorable, reserve, sans_avis) :', 'favorable'); if (!v) return;
    try { await api.put(orgPath(o, `/actes/${acte.id}/commissions/${c.commissionId}/avis`), { avis: v }); mine.reload(); } catch (e) { toast(errMsg(e), 'ko'); }
  };
  const taken = new Set((mine.data?.items ?? []).filter((c: any) => !c.retireeAt).map((c: any) => c.commissionId));
  return (
    <div className="card p-5">
      <h3 className="mb-2">Commissions (pour avis)</h3>
      {mine.data?.horsCommission ? <p className="text-mute">Hors commission.</p> : (
        <ul className="space-y-2">{mine.data?.items.filter((c: any) => !c.retireeAt).map((c: any) => (
          <li key={c.id} className="rounded border border-line p-2">
            <div className="flex items-center justify-between"><b>{c.commission}</b>{editable && <button className="text-ko" aria-label="Retirer" onClick={() => remove(c)}><Trash2 className="h-4 w-4" /></button>}</div>
            <div className="text-[12px] text-mute">{c.suspendue ? '⏸ mise à disposition suspendue' : c.misADispositionAt ? `Mis à disposition le ${d(c.misADispositionAt)}` : 'Mise à disposition à la validation DGS'}</div>
            {c.avis ? <Badge tone={c.avis === 'favorable' ? 'ok' : c.avis === 'defavorable' ? 'ko' : 'warn'}>{AVIS[c.avis]}</Badge> : c.misADispositionAt && <button className="text-[12px] font-semibold text-action" onClick={() => avis(c)}>Saisir l'avis</button>}
          </li>))}</ul>)}
      {editable && <div className="mt-3 flex gap-2"><select className="input" value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Ajouter une commission"><option value="">Ajouter une commission…</option>
        {all.data?.filter((c) => !taken.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}</select><button className="btn-secondary" disabled={!sel} onClick={add}>Ajouter</button></div>}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------- la page */
export default function Dossier() {
  const { id } = useParams();
  const { org } = useAuth(); const o = org!.id;
  const { toast, node } = useToast();
  const acte = useLoad(async () => (await api.get(orgPath(o, `/actes/${id}`))).data, [o, id]);
  const circuit = useLoad(async () => (await api.get(orgPath(o, `/actes/${id}/circuit`))).data, [o, id]);
  const reloadAll = useCallback(() => { acte.reload(); circuit.reload(); }, [acte, circuit]);
  if (acte.loading && !acte.data) return <Loading />;
  if (acte.error || !acte.data) return <div><ErrorBox msg={acte.error || 'Dossier introuvable'} /><Link className="mt-4 inline-block text-action" to="/dossiers">← Retour aux dossiers</Link></div>;
  const a = acte.data; const c = circuit.data;
  const editable = !!a.droits?.modifier;
  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 text-[12px] text-mute"><Link to="/dossiers" className="hover:underline">Actes & Dossiers</Link> › Dossier #{a.numeroSuivi}</div>
        <div className="flex flex-wrap items-center gap-3"><h1 className="min-w-0 flex-1">{a.titre}</h1><StatutBadge statut={a.statut} />
          <button className="btn-secondary" onClick={async () => { try { const r = await api.post(orgPath(o, `/actes/${a.id}/apercu`), { cible: 'dossier', mode: 'propre' }, { responseType: 'blob' }); window.open(URL.createObjectURL(r.data), '_blank'); } catch { toast('Aperçu du dossier impossible (textes ou fond de page manquants ?)', 'ko'); } }}><Eye className="h-4 w-4" /> Aperçu PDF du dossier</button></div>
      </div>
      {c && <div className="card p-4"><Frise circuit={c} />{c.statut === 'modification_demandee' && <p className="mt-2 rounded bg-warn-bg p-2 text-warn">Modification demandée — voir la discussion pour le motif.</p>}</div>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Fiche acte={a} editable={editable} onSaved={() => { reloadAll(); toast('Fiche enregistrée'); }} />
          <Textes acte={a} editable={editable || !!c?.actions?.validate} onChanged={acte.reload} toast={toast} />
          <Annexes acte={a} editable={editable} toast={toast} />
          <Discussion acte={a} toast={toast} />
        </div>
        <aside className="space-y-4">
          <Actions acte={a} circuit={c} reload={reloadAll} toast={toast} />
          {a.statut === 'brouillon' || a.statut === 'modification_demandee' ? <Completude c={a.completude} /> : null}
          <CommissionsBox acte={a} editable={editable} toast={toast} />
          {c?.events?.length > 0 && (
            <div className="card p-5"><h3 className="mb-2">Historique</h3><ul className="space-y-2 text-[12px]">{c.events.slice().reverse().slice(0, 12).map((e: any) => (
              <li key={e.id}><b>{e.actor}</b>{e.onBehalfOf ? ` (pour ${e.onBehalfOf})` : ''} · {e.action}{e.to ? ` → ${e.to}` : ''}<div className="text-mute">{dt(e.at)}</div></li>))}</ul></div>)}
        </aside>
      </div>
      {node}
    </div>
  );
}
