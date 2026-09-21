import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, CheckCircle2, Download, Eye, FileText, Copy, Paperclip, Pencil, RotateCcw, Send, Sparkles, Trash2, Upload } from 'lucide-react';
import TexteModal, { KIND_LABEL } from '../TexteModal';
import { MentionTextarea } from '../AgentPicker';
import { Progress, useAiJobs } from '../AiStatus';
import { mdToHtml } from '../mdconv';
import { api, errMsg, openPdf, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { d, dt } from '../format';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, Spinner, StatutBadge, useLoad, useToast } from '../ui';
import { AgentName, AgentNames } from '../AgentName';
import { useIa } from '../useIa';
import { Select } from '../Select';

/* ------------------------------------------------------------------------------------------------ frise du circuit */
const IGNOREE: Record<string, string> = {
  vacant: 'Poste vacant — étape ignorée', dgs_direct: 'Direction rattachée directement à la DGS — étape ignorée', sans_titulaire: 'Aucun titulaire — étape ignorée',
  auto_validation: 'Vous êtes le rédacteur — étape ignorée',
};

/** Frise du circuit : les étapes contournées (poste vacant, direction rattachée à la DGS…) et les validations implicites sont montrées comme telles. */
function Frise({ circuit }: { circuit: any }) {
  if (!circuit?.path?.length) return null;
  let n = 0;
  // Le rédacteur détient lui-même les étapes qui suivent (il est directeur, chef de service…) : elles ne sont pas affichées une à une, elles
  // fusionnent avec la rédaction en UNE carte « Rédacteur / Directeur » (les étapes contournées pour cette raison sont absorbées).
  const path: any[] = circuit.path.map((p: any) => ({ ...p, ignoree: p.state === 'skipped' || p.skipped }));
  const absorbee = (p: any) => p.ignoree && (p.reason === 'auto_validation' || p.reason === 'desactive');
  let fin = 1; while (fin < path.length && absorbee(path[fin])) fin++;
  const groupe = path.slice(0, fin); const roles = groupe.slice(1).filter((p) => p.reason === 'auto_validation' && p.via !== 'directeur').map((p) => p.label);
  const items = roles.length ? [{ ...path[0], label: ['Rédacteur', ...roles].join(' / '), fusion: true }, ...path.slice(fin)] : path;
  // Tant que le dossier est en rédaction (brouillon, ou renvoyé pour modification), aucune étape n’est « en cours » : c’est la rédaction, première carte.
  const enRedaction = ['brouillon', 'modification_demandee'].includes(circuit.statut) && !path.some((p: any) => p.state === 'current');
  return (
    <ol className="flex gap-2 overflow-x-auto pb-2" aria-label="Circuit d'approbation">
      {items.filter((p: any) => !(p.ignoree && (p.reason === 'desactive' || !p.reason))).map((p: any) => {
        const skipped = p.ignoree && !p.fusion;
        if (skipped) {
          return (
            <li key={p.key} className="min-w-[150px] flex-1 rounded-lg border border-dashed border-warn/40 bg-warn-bg/50 p-3 text-warn" title={IGNOREE[p.reason] ?? 'Étape ignorée'}>
              <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-warn/20 text-[11px] font-bold">⤼</span><span className="truncate text-[12px] font-bold line-through decoration-warn/50">{p.label}</span></div>
              <div className="mt-1 text-[11px] font-semibold">{IGNOREE[p.reason] ?? 'Étape ignorée'}{p.via === 'rh' && <span className="font-normal"> (vacant d'après les RH)</span>}</div>
            </li>);
        }
        n += 1;
        const cur = p.state === 'current' || (enRedaction && p.key === items[0].key); const done = p.state === 'done'; const implicite = done && p.instance?.decision === 'auto';
        return (
          <li key={p.key} className={`min-w-[150px] flex-1 rounded-lg border p-3 ${cur ? 'border-primary bg-primary text-white' : done ? 'border-ok/30 bg-surface' : 'border-line bg-white/60'}`}>
            <div className="flex items-center gap-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${done ? 'bg-ok-solid text-white' : cur ? 'bg-action-solid text-white ring-4 ring-action/30' : 'bg-line text-slate-600'}`}>{done ? <Check className="h-3.5 w-3.5" /> : n}</span>
              <span className="truncate text-[12px] font-bold">{p.label}</span>
            </div>
            <div className={`mt-1 truncate text-[11px] ${cur ? 'text-white/80' : 'text-mute'}`}>
              {p.instance?.actedBy ? <><AgentName u={p.instance.actedBy} />{p.instance.onBehalfOf && <> (pour <AgentName u={p.instance.onBehalfOf} />)</>}</> : p.missing ? '⚠ aucun titulaire' : (p.holders || []).length ? <AgentNames list={p.holders} /> : '—'}
            </div>
            {cur && enRedaction && <div className="mt-1 text-[11px] font-semibold">✎ en rédaction</div>}
            {implicite && <div className="mt-1 text-[11px] italic text-mute">validée implicitement (déjà validée par la même personne)</div>}
            {!done && p.via === 'directeur' && <div className={`mt-1 text-[11px] italic ${cur ? 'text-white/80' : 'text-mute'}`}>service de même nom : le directeur</div>}
            {cur && circuit.due && <div className="mt-1 text-[11px] font-semibold">{circuit.late ? '⏰ en retard · ' : 'échéance '}{dt(circuit.due, { dateStyle: 'short' })}</div>}
          </li>
        );
      })}
    </ol>
  );
}

/** Un champ personnalisé (PAR-10) : le contrôle dépend du type ; la valeur vide est renvoyée au serveur, qui la retire. */
function ChampInput({ c, v, onChange, disabled, elus }: { c: any; v: any; onChange: (x: any) => void; disabled: boolean; elus: any[] }) {
  const val = v ?? '';
  switch (c.kind) {
    case 'nombre': return <input className="input" type="number" disabled={disabled} value={val} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
    case 'date': return <input className="input" type="date" disabled={disabled} value={val} onChange={(e) => onChange(e.target.value)} />;
    case 'booleen': return <div className="flex items-center gap-4 py-2">{[[true, 'Oui'], [false, 'Non']].map(([b, l]) => <label key={String(b)} className="flex items-center gap-1"><input type="radio" disabled={disabled} checked={v === b} onChange={() => onChange(b)} /> {l}</label>)}</div>;
    case 'liste': return <Select className="input" disabled={disabled} value={val} onChange={(e) => onChange(e.target.value)}><option value="">— choisir —</option>{(c.options || []).map((o: any) => <option key={o.valeur} value={o.valeur}>{o.libelle}</option>)}</Select>;
    case 'elu': return <Select className="input" disabled={disabled} value={val} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}><option value="">— choisir —</option>{elus.map((m) => <option key={m.id} value={m.id}>{m.nomComplet}</option>)}</Select>;
    default: return <input className="input" disabled={disabled} value={val} onChange={(e) => onChange(e.target.value)} />;
  }
}

/* --------------------------------------------------------------------------------------------------- fiche de l'acte */
function Fiche({ acte, editable, onSaved }: { acte: any; editable: boolean; onSaved: () => void }) {
  const { org } = useAuth(); const o = org!.id;
  const matieres = useLoad(async () => (await api.get(orgPath(o, '/referentiels/matiere'))).data.items as any[], [o]);
  const rubriques = useLoad(async () => (await api.get(orgPath(o, '/referentiels/rubrique'))).data.items as any[], [o]);
  const natures = useLoad(async () => (await api.get(orgPath(o, '/referentiels/nature'))).data.items as any[], [o]);
  const elus = useLoad(async () => (await api.get(orgPath(o, '/elus'))).data.items as any[], [o]);
  // séances proposables : celles à venir (hors annulées) ; la séance déjà visée par le dossier reste toujours affichée, même tenue ou passée
  const seances = useLoad(async () => ((await api.get(orgPath(o, '/seances'), { params: { from: new Date(Date.now() - 86400000).toISOString(), limit: 100 } })).data.items as any[]).filter((s) => s.statut !== 'annulee'), [o]);
  const [f, setF] = useState<any>({});
  const [cv, setCv] = useState<Record<string, any>>({}); // valeurs des champs personnalisés
  const [err, setErr] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  useEffect(() => { setCv(Object.fromEntries((acte.champs || []).map((c: any) => [c.code, c.valeur]))); }, [acte.champs]);
  useEffect(() => { setF({ titre: acte.titre, matiereId: acte.matiereId ?? '', rubriqueId: acte.rubriqueId ?? '', natureId: acte.natureId ?? '', incidenceFinanciere: acte.incidenceFinanciere, montant: acte.montant ?? '', rapporteurId: acte.rapporteurId ?? '', seanceViseeId: acte.seanceViseeId ?? '', urgence: acte.urgence }); }, [acte]);
  const leaves = useMemo(() => { const parents = new Set((matieres.data ?? []).map((m) => m.parentCode).filter(Boolean)); return (matieres.data ?? []).filter((m) => !parents.has(m.code)); }, [matieres.data]);
  const nv = (v: any) => (v === '' ? null : Number(v));

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await api.put(orgPath(o, `/actes/${acte.id}`), {
        titre: f.titre, matiereId: nv(f.matiereId), rubriqueId: nv(f.rubriqueId), natureId: nv(f.natureId), incidenceFinanciere: f.incidenceFinanciere,
        montant: f.incidenceFinanciere && f.montant !== '' ? Number(f.montant) : null, rapporteurId: nv(f.rapporteurId), seanceViseeId: nv(f.seanceViseeId), urgence: !!f.urgence,
        ...((acte.champs || []).length ? { custom: { ...(acte.custom || {}), ...Object.fromEntries((acte.champs || []).filter((c: any) => c.modifiable).map((c: any) => [c.code, cv[c.code] ?? ''])) } } : {}),
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
          <Select className="input" disabled={dis && !acte.droits?.modifierSeance} value={f.seanceViseeId ?? ''} onChange={(e) => setF({ ...f, seanceViseeId: e.target.value })}>
            <option value="">— à définir —</option>{[...(seances.data ?? []), ...(acte.seanceVisee && !(seances.data ?? []).some((s) => s.id === acte.seanceVisee.id) ? [acte.seanceVisee] : [])].map((s) => <option key={s.id} value={s.id}>{s.instance} — {d(s.dateSeance)}</option>)}
          </Select>
        </Field>
        <div className="md:col-span-2"><Field label="Titre explicite de l'acte *"><input className="input" disabled={dis} value={f.titre ?? ''} onChange={(e) => setF({ ...f, titre: e.target.value })} /></Field></div>
        <Field label="Domaine d'intervention (matière) *"><Select className="input" disabled={dis} value={f.matiereId ?? ''} onChange={(e) => setF({ ...f, matiereId: e.target.value })}>
          <option value="">— choisir —</option>{leaves.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.libelle}</option>)}</Select></Field>
        <Field label="Rubrique *"><Select className="input" disabled={dis} value={f.rubriqueId ?? ''} onChange={(e) => setF({ ...f, rubriqueId: e.target.value })}>
          <option value="">— choisir —</option>{rubriques.data?.map((m) => <option key={m.id} value={m.id}>{m.libelle}</option>)}</Select></Field>
        <Field label="Nature *"><Select className="input" disabled={dis} value={f.natureId ?? ''} onChange={(e) => setF({ ...f, natureId: e.target.value })}>
          <option value="">— choisir —</option>{natures.data?.map((m) => <option key={m.id} value={m.id}>{m.libelle}</option>)}</Select></Field>
        <Field label="Élu rapporteur *"><Select className="input" disabled={dis} value={f.rapporteurId ?? ''} onChange={(e) => setF({ ...f, rapporteurId: e.target.value })}>
          <option value="">— choisir —</option>{elus.data?.map((m) => <option key={m.id} value={m.id}>{m.nomComplet}{m.role ? ` (${m.role})` : ''}</option>)}</Select></Field>
        <div>
          <span className="label">Impact budgétaire (dépense ou recette) ? *</span>
          <div className="flex items-center gap-4 py-2">
            {[[true, 'Oui'], [false, 'Non']].map(([v, l]) => (
              <label key={String(v)} className="flex items-center gap-1"><input type="radio" name="inc" disabled={dis} checked={f.incidenceFinanciere === v} onChange={() => setF({ ...f, incidenceFinanciere: v })} /> {l as string}</label>))}
            {f.incidenceFinanciere && <label className="flex items-center gap-2 rounded bg-soft px-3 py-1">Montant <input type="number" min={0} className="w-28 bg-transparent font-semibold outline-none" disabled={dis} value={f.montant ?? ''} onChange={(e) => setF({ ...f, montant: e.target.value })} /> €</label>}
          </div>
        </div>
        {(acte.champs || []).filter((c: any) => (!c.visibleSi || String(c.visibleSi?.egal ?? '') === '' || String(cv[c.visibleSi?.champ] ?? '') === String(c.visibleSi?.egal ?? ''))).map((c: any) => (
          <Field key={c.code} label={`${c.libelle}${c.obligatoire ? ' *' : ''}`} hint={c.aide || (!c.modifiable ? 'Non modifiable à ce stade ou avec votre rôle.' : undefined)}>
            <ChampInput c={c} v={cv[c.code]} onChange={(x) => setCv({ ...cv, [c.code]: x })} disabled={dis || !c.modifiable} elus={elus.data ?? []} />
          </Field>))}
        <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" disabled={dis} checked={!!f.urgence} onChange={(e) => setF({ ...f, urgence: e.target.checked })} /> Dossier urgent</label>
      </div>
      {editable && <div className="mt-4 flex justify-end"><button className="btn-secondary" onClick={save} disabled={saving}>{saving && <Spinner />} Enregistrer la fiche</button></div>}
    </section>
  );
}

/* --------------------------------------------------------------------------------------------------------- textes */
/** Aperçu d'un texte dans la page ; un clic ouvre l'éditeur plein écran (D39). */
function Textes({ acte, editable, onChanged, toast }: { acte: any; editable: boolean; onChanged: () => void; toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const { org } = useAuth();
  const texts = useLoad(async () => (await api.get(orgPath(org!.id, `/actes/${acte.id}/textes`))).data.items as any[], [acte.id, acte.statut]);
  const previews = useLoad(async () => {
    const items = (await api.get(orgPath(org!.id, `/actes/${acte.id}/textes`))).data.items as any[];
    const out: Record<number, string> = {};
    await Promise.all(items.map(async (t) => { out[t.id] = (await api.get(orgPath(org!.id, `/actes/${acte.id}/textes/${t.id}`), { params: { mode: 'propre' } })).data.markdown; }));
    return out;
  }, [acte.id, acte.statut, acte.updatedAt]);
  const [open, setOpen] = useState<number | null>(null);
  if (texts.loading && !texts.data) return <Loading />;
  const dels = acte.deliberations || [];
  const list = texts.data ?? [];
  return (
    <section className="card p-5" aria-labelledby="textes">
      <div className="mb-4 flex items-center justify-between"><h3 id="textes">Textes de la délibération</h3>
        {list.length > 0 && <button className="btn-primary" onClick={() => setOpen(list[0].id)}><Pencil className="h-4 w-4" /> {editable ? "Ouvrir l'éditeur" : 'Ouvrir en plein écran'}</button>}</div>
      <div className="space-y-4">
        {list.map((t) => {
          const d = dels.find((x: any) => x.id === t.deliberationId);
          const md = previews.data?.[t.id] ?? '';
          return (
            <button key={t.id} onClick={() => setOpen(t.id)} className="block w-full rounded-lg border border-line bg-surface p-4 text-left hover:border-action hover:shadow-lift" aria-label={`Ouvrir ${KIND_LABEL[t.kind]}`}>
              <div className="mb-1 flex items-center gap-2"><h4 className="text-[15px] font-bold text-head">{KIND_LABEL[t.kind]}{d && dels.length > 1 ? ` — délibération ${d.ordre}` : ''}</h4>
                {t.empty ? <Badge tone="warn">à rédiger</Badge> : <Badge tone="ok">v{t.version}</Badge>}{t.tracking && <Badge tone="blue">suivi actif</Badge>}<span className="ml-auto text-[12px] font-semibold text-action">{editable ? 'Modifier' : 'Ouvrir'} →</span></div>
              {md ? <div className="line-clamp-4 text-[14px] leading-[22px] text-slate-700" dangerouslySetInnerHTML={{ __html: mdToHtml(md) }} /> : <p className="text-mute">Cliquez pour rédiger ce texte.</p>}
            </button>);
        })}
      </div>
      {open !== null && <TexteModal acte={acte} texts={list} initialId={open} editable={editable} onClose={() => setOpen(null)} onChanged={() => { previews.reload(); onChanged(); }} toast={toast} />}
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
  const download = async (a: any) => { const m = await openPdf(() => api.get(orgPath(o, `/actes/${acte.id}/annexes/${a.id}/file`), { responseType: 'blob' }), a.titre); if (m) toast(m, 'ko'); };
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
            <button className="text-slate-600 hover:text-head" aria-label="Télécharger" onClick={() => download(a)}><Download className="h-5 w-5" /></button>
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
          <div className="flex justify-between text-[11px] text-mute"><b className="text-slate-700"><AgentName u={c.author} />{c.kind === 'refus' ? ' · modification demandée' : ''}</b><span>{dt(c.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</span></div>
          <div className="mt-1 whitespace-pre-wrap">{c.body}</div></li>))}
      </ul>
      <MentionTextarea rows={2} placeholder="Écrire une consigne ou mentionner un collègue en tapant @nom…" value={body} onChange={setBody} />
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
            <Field label="Renvoyer à"><Select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="previous">L'étape précédente</option>{(circuit.refuseTargets || []).map((t: any) => <option key={t.key} value={t.key}>{t.first ? `${t.label} (rédacteur)` : t.label}</option>)}
            </Select></Field>
            <Field label="Après correction, l'acte…"><Select className="input" value={resume} onChange={(e) => setResume(e.target.value)}>
              <option value="direct">revient directement à mon étape</option><option value="complet">repasse par tout le circuit</option></Select></Field>
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
  const all = useLoad(async () => ((await api.get(orgPath(o, '/commissions'), { params: { actif: 'true' } })).data.items as any[]).filter((c) => c.type !== 'autre'), [o]);
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
      {editable && <div className="mt-3 flex gap-2"><Select className="input" value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Ajouter une commission"><option value="">Ajouter une commission…</option>
        {all.data?.filter((c) => !taken.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}</Select><button className="btn-secondary" disabled={!sel} onClick={add}>Ajouter</button></div>}
    </div>
  );
}

/* ------------------------------------------------------------------------------- copie et assistant IA (D40) */
function CopieModal({ acte, onClose, toast }: { acte: any; onClose: () => void; toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const { org } = useAuth(); const o = org!.id; const nav = useNavigate();
  const ia = useIa(); const [adapter0, setAdapter] = useState(true); const adapter = adapter0 && ia.copie; const [contexte, setContexte] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = (await api.post(orgPath(o, `/actes/${acte.id}/copie`), adapter ? { adapter: true, contexte } : {})).data;
      if (r.iaError) toast(`Copie créée, mais l'IA n'a pas pu être sollicitée : ${r.iaError}`, 'ko'); else toast(adapter ? "Copie créée. L'IA prépare ses propositions en arrière plan : vous pouvez continuer à travailler." : 'Copie créée');
      onClose(); nav(`/dossiers/${r.acte.id}`);
    } catch (e) { toast(errMsg(e), 'ko'); setBusy(false); }
  };
  return (
    <Modal title="Copier ce dossier" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-mute">Un nouveau <b>brouillon</b> est créé avec la fiche et les textes de « {acte.titre} ».</p>
        <label className="flex items-start gap-3 rounded border border-line p-3"><input type="radio" className="mt-1" checked={!adapter} onChange={() => setAdapter(false)} /><span><b>Copie simple</b><br /><span className="text-mute">Vous adaptez les textes à la main.</span></span></label>
        {ia.copie && <label className="flex items-start gap-3 rounded border border-action bg-soft p-3"><input type="radio" className="mt-1" checked={adapter} onChange={() => setAdapter(true)} /><span><Sparkles className="mr-1 inline h-4 w-4 text-action" /><b>Copie adaptée avec l'IA</b><br /><span className="text-mute">L'IA <b>propose</b> les modifications pour le nouveau contexte ; vous acceptez ou refusez chacune. Rien n'est appliqué sans vous.</span></span></label>}
        {adapter && <Field label="Décrivez le nouveau contexte" hint="Objet, bénéficiaire, montants, dates, ce qui change par rapport à ce dossier."><textarea className="input" rows={5} autoFocus value={contexte} onChange={(e) => setContexte(e.target.value)} placeholder="Ex. : subvention 2027 à l'association Ivry Théâtre, 8 000 €, versée en deux fois…" /></Field>}
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy || (adapter && contexte.trim().length < 10)} onClick={go}>{busy && <Spinner />} Créer la copie</button></div>
      </div>
    </Modal>
  );
}

/** Propositions de l'IA pour ce brouillon : l'agent accepte (en éditant si besoin) ou refuse, une par une. */
function IaPanel({ acte, editable, onApplied, toast }: { acte: any; editable: boolean; onApplied: () => void; toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const { org } = useAuth(); const o = org!.id;
  const list = useLoad(async () => (await api.get(orgPath(o, `/actes/${acte.id}/ia/propositions`))).data.items as any[], [acte.id]);
  const [edit, setEdit] = useState<{ id: number; text: string } | null>(null);
  const { active, jobs } = useAiJobs((j) => { list.reload(); if (j.status === 'done') toast("L'IA a terminé : des propositions sont à examiner"); else if (j.status === 'error') toast(`L'IA n'a pas pu répondre : ${j.error ?? ''}`, 'ko'); }, acte.id);
  const pending = (list.data ?? []).filter((x) => x.status === 'pending');
  const failed = jobs.find((j) => j.status === 'error' && !active.length);
  if (active.length) {
    const j = active[0];
    return (
      <div className="card border-action/40 p-5" role="status" aria-live="polite">
        <h3 className="mb-1 flex items-center gap-2"><Sparkles className="h-5 w-5 animate-pulse text-action" /> L'IA analyse ce dossier…</h3>
        <p className="text-[12px] text-mute">{j.status === 'queued' ? `En file d'attente (n° ${j.position}) — l'IA est sollicitée par plusieurs personnes.` : `${j.stepLabel ?? 'Analyse'} (${j.progress}/${j.total || '?'})`} Vous pouvez continuer à travailler : cela se fait en arrière plan.</p>
        <Progress job={j} />
        <button className="mt-3 text-[12px] font-semibold text-ko" onClick={async () => { await api.delete(orgPath(o, `/ia/taches/${j.id}`)); }}>Annuler</button>
      </div>
    );
  }
  if (!pending.length) return failed ? <div className="card p-4 text-[12px] text-warn"><Sparkles className="mr-1 inline h-4 w-4" /> L'IA n'a pas pu analyser ce dossier ({failed.error}). Adaptez les textes à la main ou relancez plus tard.</div> : null;
  const KIND: Record<string, string> = { expose: 'Exposé', visas: 'Vu et considérant', dispositif: 'Délibéré' };
  const decide = async (p: any, decision: 'accept' | 'reject', replacement?: string) => {
    try { await api.post(orgPath(o, `/actes/${acte.id}/ia/propositions/${p.id}/decision`), { decision, replacement }); setEdit(null); list.reload(); if (decision === 'accept') onApplied(); }
    catch (e) { toast(errMsg(e), 'ko'); list.reload(); }
  };
  return (
    <div className="card border-action/40 p-5">
      <h3 className="mb-1 flex items-center gap-2"><Sparkles className="h-5 w-5 text-action" /> Propositions de l'IA <Badge tone="blue">{pending.length}</Badge></h3>
      <p className="mb-3 text-[12px] text-mute">L'IA propose, vous décidez : rien n'est appliqué sans votre accord.</p>
      <ul className="space-y-3">{pending.map((p) => (
        <li key={p.id} className="rounded border border-line p-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-mute">{KIND[p.textKind] ?? 'Texte'} {p.kind === 'alerte' && '· à vérifier'}</div>
          {p.kind === 'alerte' ? <p className="mt-1 rounded bg-warn-bg p-2 text-warn">⚠ {p.reason}</p> : (
            <>
              <div className="mt-1 text-[13px]"><del className="text-ko">{p.find}</del><br />{edit?.id !== p.id && <ins className="text-ok-text no-underline">{p.replacement}</ins>}</div>
              {edit?.id === p.id && <textarea className="input mt-1" rows={3} value={edit!.text} onChange={(e) => setEdit({ id: p.id, text: e.target.value })} />}
              {p.reason && <p className="mt-1 text-[12px] italic text-mute">{p.reason}</p>}
            </>)}
          {editable && <div className="mt-2 flex flex-wrap gap-2">
            {p.kind === 'alerte' ? <button className="btn-secondary !py-1" onClick={() => decide(p, 'reject')}>Écarter</button> : edit?.id === p.id ? (
              <><button className="btn-ok !py-1" onClick={() => decide(p, 'accept', edit!.text)}>Appliquer ma version</button><button className="btn-secondary !py-1" onClick={() => setEdit(null)}>Annuler</button></>
            ) : (
              <><button className="btn-ok !py-1" onClick={() => decide(p, 'accept')}><Check className="h-3.5 w-3.5" /> Accepter</button>
                <button className="btn-secondary !py-1" onClick={() => setEdit({ id: p.id, text: p.replacement })}><Pencil className="h-3.5 w-3.5" /> Modifier</button>
                <button className="btn-ko !py-1" onClick={() => decide(p, 'reject')}>Refuser</button></>)}
          </div>}
        </li>))}</ul>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------- la page */
/** REC-08 : actes proches de celui-ci (mêmes droits que la recherche) — pour s'en inspirer ou vérifier un précédent. */
function ActesProches({ acte }: { acte: any }) {
  const { org } = useAuth();
  const l = useLoad(async () => (await api.get(orgPath(org!.id, '/recherche/similaires'), { params: { acteId: acte.id } })).data.items as any[], [org!.id, acte.id]);
  if (!l.data?.length) return null;
  return (
    <div className="card p-5"><h3 className="mb-2">Actes proches</h3>
      <ul className="space-y-2 text-[13px]">{l.data.map((x) => <li key={x.acteId}><Link className="font-semibold text-head hover:underline" to={`/dossiers/${x.acteId}`}>{x.titre}</Link><div className="text-[11px] text-mute">#{x.numeroSuivi}{x.numero ? ` · délibération ${x.numero}` : ''}</div></li>)}</ul>
    </div>
  );
}

export default function Dossier() {
  const { id } = useParams();
  const { org } = useAuth(); const o = org!.id;
  const { toast, node } = useToast();
  const acte = useLoad(async () => (await api.get(orgPath(o, `/actes/${id}`))).data, [o, id]);
  const circuit = useLoad(async () => (await api.get(orgPath(o, `/actes/${id}/circuit`))).data, [o, id]);
  const reloadAll = useCallback(() => { acte.reload(); circuit.reload(); }, [acte, circuit]);
  const [copying, setCopying] = useState(false);
  if (acte.loading && !acte.data) return <Loading />;
  if (acte.error || !acte.data) return <div><ErrorBox msg={acte.error || 'Dossier introuvable'} /><Link className="mt-4 inline-block text-action" to="/dossiers">← Retour aux dossiers</Link></div>;
  const a = acte.data; const c = circuit.data;
  const editable = !!a.droits?.modifier;
  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 text-[12px] text-mute"><Link to="/dossiers" className="hover:underline">Actes & Dossiers</Link> › Dossier #{a.numeroSuivi}</div>
        <div className="flex flex-wrap items-center gap-3"><h1 className="min-w-0 flex-1">{a.titre}</h1><StatutBadge statut={a.statut} />
          <button className="btn-secondary" onClick={() => setCopying(true)}><Copy className="h-4 w-4" /> Copier…</button>
          <button className="btn-secondary" onClick={async () => { const m = await openPdf(() => api.post(orgPath(o, `/actes/${a.id}/apercu`), { cible: 'dossier', mode: 'propre' }, { responseType: 'blob' }), `Dossier #${a.numeroSuivi} — ${a.titre}`); if (m) toast(`Aperçu impossible : ${m}`, 'ko'); }}><Eye className="h-4 w-4" /> Aperçu PDF du dossier</button></div>
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
          {a.custom?.entrainement && <div role="note" className="rounded border border-primary/30 bg-primary/5 p-3 text-[13px]"><b>Dossier d’entraînement</b> : essayez tout librement. Il ne partira jamais dans un vrai circuit et se supprime tout seul au bout de 14 jours.</div>}
          <Actions acte={a} circuit={c} reload={reloadAll} toast={toast} />
          <IaPanel acte={a} editable={editable} onApplied={acte.reload} toast={toast} />
          {a.statut === 'brouillon' || a.statut === 'modification_demandee' ? <Completude c={a.completude} /> : null}
          <CommissionsBox acte={a} editable={editable} toast={toast} />
          <ActesProches acte={a} />
          {c?.events?.length > 0 && (
            <div className="card p-5"><h3 className="mb-2">Historique</h3><ul className="space-y-2 text-[12px]">{c.events.slice().reverse().slice(0, 12).map((e: any) => (
              <li key={e.id}><b>{e.actor ? <AgentName u={e.actor} /> : 'Étape de validation'}</b>{e.onBehalfOf && <> (pour <AgentName u={e.onBehalfOf} />)</>} · {e.action}{e.to ? ` → ${e.to}` : ''}<div className="text-mute">{dt(e.at)}</div></li>))}</ul></div>)}
        </aside>
      </div>
      {copying && <CopieModal acte={a} onClose={() => setCopying(false)} toast={toast} />}
      {node}
    </div>
  );
}
