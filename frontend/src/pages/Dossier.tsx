import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, CheckCircle2, Download, Eye, FileText, Copy, Paperclip, Pencil, RotateCcw, Send, Sparkles, Trash2, Undo2, Upload } from 'lucide-react';
import TexteModal, { KIND_LABEL } from '../TexteModal';
import { MentionTextarea } from '../AgentPicker';
import { Progress, useAiJobs } from '../AiStatus';
import { mdToHtml } from '../mdconv';
import { api, errMsg, openPdf, org as orgPath } from '../api';
import { showDocs, type PdfDoc } from '../PdfViewer';
import { useAuth } from '../auth';
import { d, dt } from '../format';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, Spinner, StatutBadge, TypeBadge, useLoad, useToast } from '../ui';
import { AgentName, AgentNames } from '../AgentName';
import { useIa } from '../useIa';
import { Select } from '../Select';
import { roleInclusif } from '../genre';
import { MatiereTree } from '../MatiereTree';
import DossierAssiste, { ActiverAssiste } from '../DossierAssiste';
import EnvoiBravo from '../EnvoiBravo';
import SignaturePlacement from '../SignaturePlacement';

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
  const rubriques = useLoad(async () => (await api.get(orgPath(o, '/referentiels/rubrique'))).data.items as any[], [o]);
  const natures = useLoad(async () => (await api.get(orgPath(o, '/referentiels/nature'))).data.items as any[], [o]);
  const elus = useLoad(async () => (await api.get(orgPath(o, '/elus'))).data.items as any[], [o]);
  // séances proposables : celles à venir (hors annulées) ; la séance déjà visée par le dossier reste toujours affichée, même tenue ou passée
  const seances = useLoad(async () => ((await api.get(orgPath(o, '/seances'), { params: { from: new Date(Date.now() - 86400000).toISOString(), limit: 100 } })).data.items as any[]).filter((s) => s.statut !== 'annulee'), [o]);
  const commissions = useLoad(async () => (await api.get(orgPath(o, `/actes/${acte.id}/commissions`))).data, [acte.id]);
  const allCommissions = useLoad(async () => ((await api.get(orgPath(o, '/commissions'), { params: { actif: 'true' } })).data.items as any[]).filter((c) => c.type !== 'autre'), [o]);
  const directions = useLoad(async () => (await api.get('/directory/directions')).data.items as any[], []);
  const [f, setF] = useState<any>({});
  const [cv, setCv] = useState<Record<string, any>>({}); // valeurs des champs personnalisés
  const [selCommission, setSelCommission] = useState('');
  const [dirsInfo, setDirsInfo] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  // Un acte signé par le maire (décision, arrêté) ne passe pas au conseil : ni séance à viser, ni élu rapporteur.
  const signature = !!acte.typeInfo?.meta?.signature;
  useEffect(() => { setCv(Object.fromEntries((acte.champs || []).map((c: any) => [c.code, c.valeur]))); }, [acte.champs]);
  useEffect(() => { setF({ titre: acte.titre, matiereId: acte.matiereId ?? '', rubriqueId: acte.rubriqueId ?? '', natureId: acte.natureId ?? '', incidenceFinanciere: acte.incidenceFinanciere, montant: acte.montant ?? '', rapporteurId: acte.rapporteurId ?? '', seanceViseeId: acte.seanceViseeId ?? '', urgence: acte.urgence }); }, [acte]);
  useEffect(() => { setDirsInfo(Array.isArray(acte.directionsInfo) ? acte.directionsInfo.map((d: any) => ({ ...d })) : []); }, [acte.directionsInfo]);
  const nv = (v: any) => (v === '' ? null : Number(v));
  // Champs obligatoires non renseignés : surlignés pour guider la saisie tant que la fiche est modifiable (CRE-02).
  const manque = {
    titre: !String(f.titre ?? '').trim(),
    matiere: f.matiereId === '' || f.matiereId == null,
    rubrique: f.rubriqueId === '' || f.rubriqueId == null,
    nature: f.natureId === '' || f.natureId == null,
    rapporteur: !signature && (f.rapporteurId === '' || f.rapporteurId == null),
    commission: (allCommissions.data?.length ?? 0) > 0 && !(commissions.data?.items ?? []).some((c: any) => !c.retireeAt),
    incidence: f.incidenceFinanciere == null,
  };
  const mq = (k: keyof typeof manque) => editable && manque[k];
  const takenCommissions = new Set((commissions.data?.items ?? []).filter((c: any) => !c.retireeAt).map((c: any) => c.commissionId));
  const addCommission = async () => {
    if (!selCommission) return; setErr(null);
    try { await api.post(orgPath(o, `/actes/${acte.id}/commissions`), { commissionId: Number(selCommission) }); setSelCommission(''); commissions.reload(); onSaved(); }
    catch (x) { setErr(errMsg(x)); }
  };
  const removeCommission = async (c: any) => {
    const motif = c.misADispositionAt ? prompt('Motif du retrait (obligatoire, les membres seront prévenus) :') : undefined;
    if (c.misADispositionAt && !motif) return;
    try { await api.delete(orgPath(o, `/actes/${acte.id}/commissions/${c.commissionId}`), { params: { motif } }); commissions.reload(); onSaved(); }
    catch (x) { setErr(errMsg(x)); }
  };

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await api.put(orgPath(o, `/actes/${acte.id}`), {
        titre: f.titre, matiereId: nv(f.matiereId), rubriqueId: nv(f.rubriqueId), natureId: nv(f.natureId), incidenceFinanciere: f.incidenceFinanciere,
        montant: f.incidenceFinanciere && f.montant !== '' ? Number(f.montant) : null, rapporteurId: signature ? null : nv(f.rapporteurId), seanceViseeId: signature ? null : nv(f.seanceViseeId), urgence: !!f.urgence,
        directionsInfo: dirsInfo.map((d: any) => d.code),
        ...((acte.champs || []).length ? { custom: { ...(acte.custom || {}), ...Object.fromEntries((acte.champs || []).filter((c: any) => c.modifiable).map((c: any) => [c.code, cv[c.code] ?? ''])) } } : {}),
      });
      onSaved();
    } catch (x) { setErr(errMsg(x)); } finally { setSaving(false); }
  };
  const dis = !editable;
  return (
    <section className="card p-5" aria-labelledby="fiche">
      <h3 id="fiche" className="mb-4 flex items-center gap-2"><FileText className="h-5 w-5 text-action" /> Informations clés de l'acte</h3>
      {acte.statut === 'signe' && <p className="mb-3 rounded bg-ok-bg p-2 text-[13px] text-ok-text">Acte signé : les informations sont en <b>lecture seule</b>.</p>}
      <ErrorBox msg={err} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Direction porteuse"><div className="input bg-soft">{acte.direction?.label}{acte.service ? ` · ${acte.service.label}` : ''}</div></Field>
        {!signature && (
        <Field label="Séance visée" hint={acte.seanceVisee ? (acte.seanceVisee.inscrit ? "Inscrit à l'ordre du jour de cette séance." : "Séance visée — pas encore inscrit à l'ordre du jour.") : 'Proposée par le rédacteur ; modifiable par la hiérarchie.'}>
          <Select className="input" disabled={dis && !acte.droits?.modifierSeance} value={f.seanceViseeId ?? ''} onChange={(e) => setF({ ...f, seanceViseeId: e.target.value })}>
            <option value="">— à définir —</option>{[...(seances.data ?? []), ...(acte.seanceVisee && !(seances.data ?? []).some((s) => s.id === acte.seanceVisee.id) ? [acte.seanceVisee] : [])].map((s) => <option key={s.id} value={s.id}>{s.instance} — {d(s.dateSeance)}</option>)}
          </Select>
        </Field>)}
        <div className="md:col-span-2"><Field label="Titre explicite de l'acte *" missing={mq('titre')}><input className="input" disabled={dis} value={f.titre ?? ''} onChange={(e) => setF({ ...f, titre: e.target.value })} /></Field></div>
        <Field label="Domaine d'intervention (matière) *" missing={mq('matiere')} hint="Nomenclature de la préfecture : parcourez l'arborescence, seules les matières précises (feuilles) sont sélectionnables.">
          <MatiereTree disabled={dis} value={f.matiereId} onChange={(id) => setF({ ...f, matiereId: id ?? '' })} /></Field>
        <Field label="Rubrique *" missing={mq('rubrique')}><Select className="input" disabled={dis} value={f.rubriqueId ?? ''} onChange={(e) => setF({ ...f, rubriqueId: e.target.value })}>
          <option value="">— choisir —</option>{rubriques.data?.map((m) => <option key={m.id} value={m.id}>{m.libelle}</option>)}</Select></Field>
        <Field label="Nature *" missing={mq('nature')}><Select className="input" disabled={dis} value={f.natureId ?? ''} onChange={(e) => setF({ ...f, natureId: e.target.value })}>
          <option value="">— choisir —</option>{natures.data?.map((m) => <option key={m.id} value={m.id}>{m.libelle}</option>)}</Select></Field>
        {!signature && (
        <Field label="Élu rapporteur *" missing={mq('rapporteur')}><Select className="input" disabled={dis} value={f.rapporteurId ?? ''} onChange={(e) => setF({ ...f, rapporteurId: e.target.value })}>
          <option value="">— choisir —</option>{elus.data?.map((m) => <option key={m.id} value={m.id}>{m.nomComplet}{m.role ? ` (${roleInclusif(m.role, m.prenom, m.civilite)})` : ''}</option>)}</Select></Field>)}
        <div className="md:col-span-2">
          <Field label="Commissions (pour avis) *" missing={mq('commission')} hint="Le projet est soumis pour avis à la ou les commissions sélectionnées. Obligatoire dès que la collectivité a des commissions actives.">
            {(commissions.data?.items ?? []).some((c: any) => !c.retireeAt) ? (
              <ul className="mb-2 flex flex-wrap gap-2">{(commissions.data?.items ?? []).filter((c: any) => !c.retireeAt).map((c: any) => (
                <li key={c.id} className="inline-flex items-center gap-2 rounded-full border border-line bg-soft px-3 py-1 text-[13px]"><b>{c.commission}</b>{editable && <button type="button" className="text-ko" aria-label={`Retirer ${c.commission}`} onClick={() => removeCommission(c)}><Trash2 className="h-3.5 w-3.5" /></button>}</li>))}</ul>
            ) : <p className="mb-2 text-[13px] text-mute">{commissions.data?.horsCommission ? 'Hors commission : aucune commission pour avis.' : 'Aucune commission pour avis.'}</p>}
            {editable && (allCommissions.data?.length ?? 0) > 0 && (
              <div className="flex gap-2">
                <Select className="input" value={selCommission} onChange={(e) => setSelCommission(e.target.value)} aria-label="Ajouter une commission">
                  <option value="">Ajouter une commission…</option>
                  {(allCommissions.data ?? []).filter((c) => !takenCommissions.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </Select>
                <button type="button" className="btn-secondary" disabled={!selCommission} onClick={addCommission}>Ajouter</button>
              </div>)}
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Directions en info (copie)" hint="Facultatif. Le directeur de ces directions est notifié quand le projet arrive au SCC, leur DGA quand la délibération arrive à l'étape DGA.">
            {dirsInfo.length ? <ul className="mb-2 flex flex-wrap gap-2">{dirsInfo.map((d: any) => (
              <li key={d.code} className="inline-flex items-center gap-2 rounded-full border border-line bg-soft px-3 py-1 text-[13px]"><b>{d.label || d.code}</b>{editable && <button type="button" className="text-ko" aria-label={`Retirer ${d.code}`} onClick={() => setDirsInfo((x) => x.filter((y) => y.code !== d.code))}><Trash2 className="h-3.5 w-3.5" /></button>}</li>))}</ul> : <p className="mb-2 text-[13px] text-mute">Aucune direction en info.</p>}
            {editable && <Select className="input" value="" onChange={(e) => { const code = e.target.value; if (!code) return; const d = (directions.data ?? []).find((x) => x.code === code); if (d) setDirsInfo((x) => (x.some((y) => y.code === code) ? x : [...x, { code, label: d.label }])); }} aria-label="Ajouter une direction en info">
              <option value="">Ajouter une direction en info…</option>
              {(directions.data ?? []).filter((x) => !dirsInfo.some((y) => y.code === x.code)).map((x) => <option key={x.code} value={x.code}>{x.label || x.code}</option>)}
            </Select>}
          </Field>
        </div>
        <div className={mq('incidence') ? 'rounded-md border-l-4 border-warn bg-warn-bg/50 px-3 py-2' : ''}>
          <span className="label">Impact budgétaire (dépense ou recette) ? *{mq('incidence') && <span className="ml-1 inline-block h-2 w-2 rounded-full bg-warn align-middle" title="À renseigner" aria-label="À renseigner" />}</span>
          <div className="flex items-center gap-4 py-2">
            {[[true, 'Oui'], [false, 'Non']].map(([v, l]) => (
              <label key={String(v)} className="flex items-center gap-1"><input type="radio" name="inc" disabled={dis} checked={f.incidenceFinanciere === v} onChange={() => setF({ ...f, incidenceFinanciere: v })} /> {l as string}</label>))}
            {f.incidenceFinanciere && <label className="flex items-center gap-2 rounded bg-soft px-3 py-1">Montant <input type="number" min={0} className="w-28 bg-transparent font-semibold outline-none" disabled={dis} value={f.montant ?? ''} onChange={(e) => setF({ ...f, montant: e.target.value })} /> €</label>}
          </div>
        </div>
        {(acte.champs || []).filter((c: any) => (!c.visibleSi || String(c.visibleSi?.egal ?? '') === '' || String(cv[c.visibleSi?.champ] ?? '') === String(c.visibleSi?.egal ?? ''))).map((c: any) => (
          <Field key={c.code} label={`${c.libelle}${c.obligatoire ? ' *' : ''}`} hint={c.aide || (!c.modifiable ? 'Non modifiable à ce stade ou avec votre rôle.' : undefined)} missing={editable && c.obligatoire && (cv[c.code] === undefined || cv[c.code] === null || cv[c.code] === '')}>
            <ChampInput c={c} v={cv[c.code]} onChange={(x) => setCv({ ...cv, [c.code]: x })} disabled={dis || !c.modifiable} elus={elus.data ?? []} />
          </Field>))}
        <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" disabled={dis} checked={!!f.urgence} onChange={(e) => setF({ ...f, urgence: e.target.checked })} /> Dossier urgent</label>
      </div>
      {editable && <div className="mt-4 flex justify-end"><button className="btn-secondary" onClick={save} disabled={saving}>{saving && <Spinner />} Enregistrer la fiche</button></div>}
    </section>
  );
}

/* --------------------------------------------------------------------------------------------------------- textes */
/**
 * Joindre le document de l'acte rédigé hors application (PDF ou Word). Deux questions à l'agent : le fichier, et
 * faut-il ajouter la trame (en-tête / pied de page) de la collectivité. Avertissement : dans ce mode, les
 * modifications et corrections en cours de circuit ne sont pas possibles.
 */
function SourceModal({ acte, onClose, onDone, toast }: { acte: any; onClose: () => void; onDone: () => void; toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const { org } = useAuth(); const o = org!.id;
  const [file, setFile] = useState<File | null>(null); const [trame, setTrame] = useState<'presente' | 'a_ajouter'>('presente'); const [busy, setBusy] = useState(false);
  const envoyer = async () => {
    if (!file) return; setBusy(true);
    try { const fd = new FormData(); fd.append('file', file); fd.append('trame', trame); await api.post(orgPath(o, `/actes/${acte.id}/document-source`), fd); toast('Document joint à l’acte'); onDone(); onClose(); }
    catch (e) { toast(errMsg(e), 'ko'); setBusy(false); }
  };
  return (
    <Modal title="Joindre le document de l'acte" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="rounded bg-warn-bg p-3 text-[13px] text-warn"><b>Important :</b> dans ce mode, le texte n'est pas rédigé dans VibeDélib. Les <b>modifications et corrections en cours de circuit ne seront pas possibles</b> : seul ce document fait foi. Pour le corriger, il faudra le retirer et repasser par l'éditeur de l'outil.</p>
        <Field label="Document (PDF ou Word .docx)"><input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <fieldset className="rounded border border-line p-3">
          <legend className="px-1 text-[12px] font-semibold uppercase text-mute">La trame de la collectivité (en-tête, pied de page)</legend>
          <div className="space-y-2">
            <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={trame === 'presente'} onChange={() => setTrame('presente')} /><span><b>Elle est déjà dans le document</b><br /><span className="text-[12px] text-mute">Le document est utilisé tel quel.</span></span></label>
            <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={trame === 'a_ajouter'} onChange={() => setTrame('a_ajouter')} /><span><b>Il faut la rajouter</b><br /><span className="text-[12px] text-mute">L'en-tête et le pied de page du gabarit de l'acte sont posés dans les marges du document.</span></span></label>
          </div>
        </fieldset>
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={!file || busy} onClick={envoyer}>{busy && <Spinner />} Joindre le document</button></div>
      </div>
    </Modal>
  );
}

/** Aperçu d'un texte dans la page ; un clic ouvre l'éditeur plein écran (D39). */
function Textes({ acte, editable, onChanged, onApercu, toast }: { acte: any; editable: boolean; onChanged: () => void; onApercu: () => void; toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const { org } = useAuth();
  const texts = useLoad(async () => (await api.get(orgPath(org!.id, `/actes/${acte.id}/textes`))).data.items as any[], [acte.id, acte.statut]);
  const previews = useLoad(async () => {
    const items = (await api.get(orgPath(org!.id, `/actes/${acte.id}/textes`))).data.items as any[];
    const out: Record<number, string> = {};
    await Promise.all(items.map(async (t) => { out[t.id] = (await api.get(orgPath(org!.id, `/actes/${acte.id}/textes/${t.id}`), { params: { mode: 'propre' } })).data.markdown; }));
    return out;
  }, [acte.id, acte.statut, acte.updatedAt]);
  const [open, setOpen] = useState<number | null>(null);
  const [srcOpen, setSrcOpen] = useState(false);
  // Une décision (ou un arrêté) n'a pas de délibéré : le dispositif est l'acte lui-même, on le nomme par son type.
  const acteLabel = acte.typeCode === 'decision' ? 'Décision' : acte.typeCode === 'arrete' ? 'Arrêté' : null;
  // Le dispositif d'une délibération est son « délibéré » ; celui d'une décision ou d'un arrêté est son « décide ».
  const dispositifLabel = acteLabel ? 'Décide' : KIND_LABEL.dispositif;
  // Une fois l'acte signé par le maire, le texte n'est plus modifiable : le PDF signé revenu du parapheur fait foi.
  const signe = acte.statut === 'signe' && !!acte.typeInfo?.meta?.signature;
  // Le guide « dossier assisté » peut demander l'ouverture directe de l'éditeur (bouton « Montrer »).
  useEffect(() => {
    const h = (e: Event) => {
      if (signe) return; // pas d'éditeur une fois l'acte signé
      const kind = (e as CustomEvent<{ kind?: string }>).detail?.kind;
      const items = (texts.data ?? []) as any[];
      if (!items.length) return;
      const cible = (kind ? items.find((x) => x.kind === kind) : null) ?? items.find((x) => x.empty) ?? items[0];
      if (cible) setOpen(cible.id);
    };
    window.addEventListener('vibedelib:ouvrir-texte', h);
    return () => window.removeEventListener('vibedelib:ouvrir-texte', h);
  }, [texts.data, signe]);
  if (texts.loading && !texts.data) return <Loading />;
  const dels = acte.deliberations || [];
  const list = texts.data ?? [];
  const kindLabel = (t: any) => (t.kind === 'dispositif' ? dispositifLabel : KIND_LABEL[t.kind]);
  const ouvrirSigne = async () => { const m = await openPdf(() => api.get(orgPath(org!.id, `/parapheur/actes/${acte.id}/document-signe`), { responseType: 'blob' }), `${acteLabel || 'Acte'} signé(e) — ${acte.titre}`); if (m) toast(m, 'ko'); };
  // Acte rédigé hors application : c'est le document joint qui fait foi, on ne propose pas l'éditeur de texte.
  const source = acte.documentSource;
  const voirSource = async () => { const m = await openPdf(() => api.get(orgPath(org!.id, `/actes/${acte.id}/document-source`), { responseType: 'blob' }), `${acteLabel || 'Acte'} — ${acte.titre}`); if (m) toast(m, 'ko'); };
  const retirerSource = async () => { if (!confirm('Retirer le document joint et revenir à la rédaction dans l’outil ?')) return; try { await api.delete(orgPath(org!.id, `/actes/${acte.id}/document-source`)); toast('Document retiré'); onChanged(); } catch (e) { toast(errMsg(e), 'ko'); } };
  if (source) return (
    <section className="card p-5" aria-labelledby="textes">
      <h3 id="textes" className="mb-3">{acteLabel ? "Texte de l'acte" : 'Textes de la délibération'}</h3>
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="mb-1 flex flex-wrap items-center gap-2"><Badge tone="blue">Rédigé hors application</Badge><b className="min-w-0 break-all">{source.nom}</b></div>
        <p className="text-[13px] text-mute">{source.trame === 'a_ajouter' ? "La trame de la collectivité (en-tête, pied de page) a été ajoutée au document." : "La trame de la collectivité est déjà présente dans le document."}</p>
        <p className="mt-2 rounded bg-warn-bg p-2 text-[12px] text-warn">Les modifications et corrections en cours de circuit ne sont pas possibles sur ce document. Pour corriger, retirez-le et repassez par l'éditeur de l'outil.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={voirSource}><Eye className="h-4 w-4" /> Voir le document (PDF)</button>
          {editable && <button className="btn-secondary" onClick={() => setSrcOpen(true)}><Upload className="h-4 w-4" /> Remplacer</button>}
          {editable && <button className="btn-ko" onClick={retirerSource}><Trash2 className="h-4 w-4" /> Retirer</button>}
        </div>
      </div>
      {srcOpen && <SourceModal acte={acte} onClose={() => setSrcOpen(false)} onDone={onChanged} toast={toast} />}
    </section>
  );
  return (
    <section className="card p-5" aria-labelledby="textes">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h3 id="textes">{acteLabel ? "Texte de l'acte" : 'Textes de la délibération'}</h3>
        {list.length > 0 && <div className="flex items-center gap-2">
          {signe ? (
            <button className="btn-primary" onClick={ouvrirSigne}><Download className="h-4 w-4" /> Document signé (PDF)</button>
          ) : (
            <><button className="btn-secondary" onClick={onApercu}><Eye className="h-4 w-4" /> Prévisualiser</button>
              <button className="btn-primary" onClick={() => setOpen(list[0].id)}><Pencil className="h-4 w-4" /> {editable ? "Ouvrir l'éditeur" : 'Ouvrir en plein écran'}</button></>)}
        </div>}</div>
      {signe && <p className="mb-3 rounded bg-ok-bg p-2 text-[13px] text-ok-text">Acte signé par le maire : le texte n'est plus modifiable. Seul le <b>document signé</b> revenu du parapheur fait foi.</p>}
      <div className="space-y-4">
        {list.map((t) => {
          const d = dels.find((x: any) => x.id === t.deliberationId);
          const md = previews.data?.[t.id] ?? '';
          const inner = (<>
            <div className="mb-1 flex items-center gap-2"><h4 className="text-[15px] font-bold text-head">{kindLabel(t)}{d && dels.length > 1 ? ` — délibération ${d.ordre}` : ''}</h4>
              {t.empty ? <Badge tone="warn">à rédiger</Badge> : <Badge tone="ok">ok</Badge>}{t.tracking && <Badge tone="blue">suivi actif</Badge>}{!signe && <span className="ml-auto text-[12px] font-semibold text-action">{editable ? 'Modifier' : 'Ouvrir'} →</span>}</div>
            {md ? <div className="text-preview line-clamp-4 text-[14px] leading-[22px] text-slate-700" dangerouslySetInnerHTML={{ __html: mdToHtml(md) }} /> : <p className="text-mute">Cliquez pour rédiger ce texte.</p>}
          </>);
          return signe
            ? <div key={t.id} className="rounded-lg border border-line bg-surface p-4">{inner}</div>
            : <button key={t.id} onClick={() => setOpen(t.id)} className="block w-full rounded-lg border border-line bg-surface p-4 text-left hover:border-action hover:shadow-lift" aria-label={`Ouvrir ${kindLabel(t)}`}>{inner}</button>;
        })}
      </div>
      {open !== null && !signe && <TexteModal acte={acte} texts={list} initialId={open} editable={editable} onClose={() => setOpen(null)} onChanged={() => { previews.reload(); onChanged(); }} toast={toast} />}
    </section>
  );
}

/* ------------------------------------------------------------------------------------------------------- annexes */
function Annexes({ acte, editable, toast }: { acte: any; editable: boolean; toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const { org } = useAuth(); const o = org!.id;
  const list = useLoad(async () => (await api.get(orgPath(o, `/actes/${acte.id}/annexes`))).data.items as any[], [acte.id]);
  const [busy, setBusy] = useState(false); const input = useRef<HTMLInputElement>(null);
  const [comm, setComm] = useState(true);
  const upload = async (file: File) => {
    setBusy(true);
    try { const fd = new FormData(); fd.append('titre', file.name.replace(/\.pdf$/i, '')); fd.append('communicable', comm ? 'true' : 'false'); fd.append('file', file); await api.post(orgPath(o, `/actes/${acte.id}/annexes`), fd); list.reload(); }
    catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); }
  };
  const toggle = async (a: any) => { try { await api.put(orgPath(o, `/actes/${acte.id}/annexes/${a.id}`), { communicable: !a.communicable }); list.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  const voirPdf = async (a: any) => { const m = await openPdf(() => api.get(orgPath(o, `/actes/${acte.id}/annexes/${a.id}/file`), { params: { format: 'pdf' }, responseType: 'blob' }), a.titre); if (m) toast(m, 'ko'); };
  const telecharger = async (a: any, format?: 'pdf') => {
    try {
      const r = await api.get(orgPath(o, `/actes/${acte.id}/annexes/${a.id}/file`), { params: format ? { format } : {}, responseType: 'blob' });
      const url = URL.createObjectURL(r.data); const link = document.createElement('a'); link.href = url; link.download = format === 'pdf' ? `${a.titre}.pdf` : (a.fichier.nom || a.titre); link.click(); URL.revokeObjectURL(url);
    } catch (e) { toast(errMsg(e), 'ko'); }
  };
  const extDe = (a: any) => (String(a.fichier.nom || '').split('.').pop() || 'doc').toUpperCase();
  return (
    <section className="card p-5" aria-labelledby="annexes">
      <h3 id="annexes" className="mb-3 flex items-center gap-2"><Paperclip className="h-5 w-5 text-action" /> Pièces jointes au dossier</h3>
      {editable && (
        <>
          <div className="mb-2 cursor-pointer rounded-lg border-2 border-dashed border-action/30 bg-soft p-6 text-center" onClick={() => input.current?.click()}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) upload(f); }}>
            {busy ? <Spinner /> : <Upload className="mx-auto h-6 w-6 text-action" />}
            <div className="mt-1 font-semibold">Glissez votre fichier ici ou cliquez pour choisir</div><div className="text-[12px] text-mute">PDF uniquement (annexes, plans, devis…)</div>
            <input ref={input} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
          </div>
          <label className="mb-4 flex items-center justify-center gap-2 text-[12px] text-mute"><input type="checkbox" checked={comm} onChange={(e) => setComm(e.target.checked)} /> Communicable (visible dans la bibliothèque et par les élus)</label>
        </>)}
      {list.loading ? <Loading /> : !list.data?.length ? <p className="text-mute">Aucune pièce jointe.</p> : (
        <ul>{list.data.map((a) => (
          <li key={a.id} className="flex items-center gap-3 border-b border-line py-2 last:border-0">
            <span className="flex h-10 w-10 items-center justify-center rounded bg-ko-bg text-[9px] font-bold text-ko">{extDe(a)}</span>
            <div className="min-w-0 flex-1"><div className="truncate font-semibold">{a.titre}</div><div className="text-[12px] text-mute">{a.fichier.pages ? `${a.fichier.pages} p. · ` : ''}{(a.fichier.taille / 1048576).toFixed(1)} Mo · v{a.version} · {a.createdBy}</div></div>
            {editable ? <button type="button" onClick={() => toggle(a)} title="Basculer communicable / non communicable"><Badge tone={a.communicable ? 'ok' : 'warn'}>{a.communicable ? 'Communicable' : 'Non communicable'}</Badge></button> : <Badge tone={a.communicable ? 'ok' : 'warn'}>{a.communicable ? 'Communicable' : 'Non communicable'}</Badge>}
            {a.pdf ? (
              <>
                <button className="btn-secondary !px-2 !py-1 !text-[12px]" onClick={() => telecharger(a)} title={`Télécharger l'original (${extDe(a)})`}><Download className="h-4 w-4" /> {extDe(a)}</button>
                <button className="btn-secondary !px-2 !py-1 !text-[12px]" onClick={() => voirPdf(a)} title="Voir le PDF"><Eye className="h-4 w-4" /> PDF</button>
              </>
            ) : (
              <button className="text-slate-600 hover:text-head" aria-label="Télécharger" onClick={() => telecharger(a)}><Download className="h-5 w-5" /></button>
            )}
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

/* ------------------------------------------------------------------ délibérations d'autorisation (décisions) */
/** Une décision est prise par le maire dans le cadre d'une délégation : on lie la ou les délibérations qui l'autorisent. */
function Autorisations({ acte, editable, onChanged, toast }: { acte: any; editable: boolean; onChanged: () => void; toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const { org } = useAuth(); const o = org!.id;
  const liens: any[] = acte.liens || [];
  const [q, setQ] = useState(''); const [props, setProps] = useState<any[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.trim().length < 3) { setProps([]); return; }
    const t = setTimeout(() => { api.get(orgPath(o, '/bibliotheque'), { params: { q: q.trim(), limit: 20 } }).then((r) => setProps(r.data.items || [])).catch(() => setProps([])); }, 400);
    return () => clearTimeout(t);
  }, [q, o]);
  const pris = new Set(liens.map((l) => l.cibleActeId));
  const add = async (id: number) => {
    setBusy(true);
    try { await api.post(orgPath(o, `/actes/${acte.id}/liens`), { cibleActeId: id }); toast('Délibération liée'); setQ(''); setProps([]); onChanged(); }
    catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); }
  };
  const remove = async (l: any) => { try { await api.delete(orgPath(o, `/actes/${acte.id}/liens/${l.id}`)); onChanged(); } catch (e) { toast(errMsg(e), 'ko'); } };
  return (
    <section className="card p-5" aria-labelledby="autorisations">
      <h3 id="autorisations" className="mb-2">Délibérations d'autorisation <span className="text-[12px] font-normal text-mute">(facultatif)</span></h3>
      <p className="mb-3 text-[13px] text-mute">Une décision est prise par le maire dans le cadre d'une délégation du conseil : liez la ou les délibérations adoptées qui l'autorisent. C'est <b>facultatif</b> et n'empêche pas l'envoi (l'administrateur peut rendre ce lien obligatoire).</p>
      {!liens.length ? <p className="mb-3 text-mute">Aucune délibération liée.</p> : (
        <ul className="mb-3 space-y-2">{liens.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-2 rounded border border-line p-2">
            <span className="min-w-0"><Link className="font-semibold text-head hover:underline" to={`/dossiers/${l.cibleActeId}`}>{l.titre}</Link><span className="ml-2 text-[12px] text-mute">#{l.numeroSuivi}</span></span>
            {editable && <button className="shrink-0 text-ko" aria-label="Retirer le lien" onClick={() => remove(l)}><Trash2 className="h-4 w-4" /></button>}
          </li>))}</ul>)}
      {editable && (
        <div>
          <Field label="Lier une délibération adoptée" hint="Tapez au moins 3 caractères (titre ou numéro) : la recherche porte sur la bibliothèque des délibérations adoptées.">
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="rechercher une délibération…" />
          </Field>
          {props.length > 0 && (
            <ul className="mt-2 max-h-64 space-y-1 overflow-auto">{props.filter((p) => !pris.has(p.acteId)).map((p) => (
              <li key={p.acteId} className="flex items-center justify-between gap-2 rounded border border-line p-2 text-[13px]">
                <span className="min-w-0"><b className="block truncate">{p.titre}</b><span className="text-[12px] text-mute">#{p.numeroSuivi}{p.dateSeance ? ` · ${d(p.dateSeance)}` : ''}</span></span>
                <button className="btn-secondary shrink-0" disabled={busy} onClick={() => add(p.acteId)}>Lier</button>
              </li>))}</ul>)}
        </div>)}
    </section>
  );
}

/* ------------------------------------------------------------------------------ signature du maire (parapheur) */
const SENS: Record<string, string> = { sortant: 'Envoyé', entrant: 'Retourné' };
/** Libellés lisibles pour le journal du parapheur (on n'affiche jamais de JSON brut). */
const JOURNAL_LABELS: Record<string, string> = {
  titre: 'Titre', signataire: 'Signataire', mode: 'Mode', fournisseur: 'Parapheur', signatureMode: 'Mode de signature',
  document: 'Document', documents: 'Documents', statut: 'Statut', status: 'Statut', reference: 'Référence', ref: 'Référence',
  id: 'Identifiant', lien: 'Lien', url: 'Adresse', email: 'E-mail', nom: 'Nom', test: 'Document de test', deadline: 'Échéance',
  motif: 'Motif', reason: 'Motif', message: 'Message', erreur: 'Erreur', detail: 'Détail', details: 'Détail',
  signature: 'Emplacement', page: 'Page', x: 'X', y: 'Y', w: 'Largeur', h: 'Hauteur', documentIndex: 'Document',
};
const journalValue = (v: any): string => {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? journalValue(x) : String(x))).join(' ; ');
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${JOURNAL_LABELS[k] || k} : ${journalValue(x)}`).join(' · ');
  if (typeof v === 'boolean') return v ? 'oui' : 'non';
  return String(v);
};
/** Détail d'un échange, présenté en clair (libellés français, aucune accolade). */
function JournalDetails({ data }: { data: any }) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data ? <p className="mt-1 text-[12px]">{journalValue(data)}</p> : null;
  const entries = Object.entries(data).filter(([k, v]) => !k.startsWith('_') && v !== null && v !== undefined && v !== '');
  if (!entries.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 rounded bg-soft p-2 text-[12px]">
      {entries.map(([k, v]) => <span key={k}><span className="text-mute">{JOURNAL_LABELS[k] || k} : </span><span className="font-medium">{journalValue(v)}</span></span>)}
    </div>
  );
}
/** Suivi de la signature d'une décision / d'un arrêté : envoi au parapheur, état, journal des échanges. */
function Signature({ acte, toast, onChanged }: { acte: any; toast: (m: string, k?: 'ok' | 'ko') => void; onChanged?: () => void }) {
  const { org, me, isAdmin, isScc } = useAuth(); const o = org!.id;
  const etat = useLoad(async () => (await api.get(orgPath(o, `/parapheur/actes/${acte.id}`))).data, [o, acte.id, acte.statut]);
  const [busy, setBusy] = useState<string | null>(null);
  const [placeOpen, setPlaceOpen] = useState(false);
  const staff = isAdmin || isScc;
  const peutPlacer = staff || acte.redacteur === me?.username || (acte.coRedacteurs || []).includes(me?.username);
  // Emplacement de la signature (mécanisme du Hub DSI) : requis avant l'envoi au parapheur.
  const pos = etat.data?.signaturePosition || acte.signaturePosition || null;
  const go = async (cle: string, fn: () => Promise<any>, ok: string) => {
    setBusy(cle);
    try { await fn(); toast(ok); etat.reload(); onChanged?.(); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(null); }
  };
  const e = etat.data?.envoi;
  const voirSigne = async () => { const m = await openPdf(() => api.get(orgPath(o, `/parapheur/actes/${acte.id}/document-signe`), { responseType: 'blob' }), `Document signé — ${acte.titre}`); if (m) toast(m, 'ko'); };
  // L'acte est « en attente de signature » (fin de circuit) : seul cas où l'envoi est « normal ».
  const enAttente = ['a_signer', 'signature_refusee'].includes(acte.statut) || !e || ['erreur', 'annule', 'refuse'].includes(e.statut);
  // Le circuit n'est pas terminé : un administrateur / le SCC peut tout de même envoyer la décision en signature.
  const circuitEnCours = !['a_signer', 'signe', 'signature_refusee'].includes(acte.statut);
  // Un envoi existe mais s'est mal passé (erreur du parapheur) : le dossier peut être « renvoyé » tel quel.
  const enErreur = !!e && e.statut === 'erreur';
  const titreEnvoi = etat.data?.blocage || null;
  const envoyer = async (forcer: boolean) => {
    if (forcer && !confirm(`Envoyer « ${acte.titre} » en signature du maire ?\n\nLe circuit n'est pas terminé. Le dossier passera à l'état « À signer ».`)) return;
    await go('envoi', () => api.post(orgPath(o, `/parapheur/actes/${acte.id}/envoi`), forcer ? { forcer: true } : {}), forcer ? 'Décision envoyée en signature (circuit non terminé)' : 'Document envoyé en signature');
  };
  // Le Hub n'a pas de webhook : tant qu'un envoi est en cours, on interroge le parapheur en arrière-plan
  // pour refléter une signature ou un refus sans attendre un clic.
  const enCours = !!e && ['envoye', 'a_signer'].includes(e.statut) && !etat.data?.simulateur;
  const syncRef = useRef(false);
  useEffect(() => {
    if (!enCours) return;
    let stop = false;
    const tick = async () => {
      if (syncRef.current || stop || document.hidden) return;
      syncRef.current = true;
      try { await api.post(orgPath(o, `/parapheur/actes/${acte.id}/synchroniser`)); if (!stop) { etat.reload(); onChanged?.(); } }
      catch { /* Hub injoignable : on réessaiera */ }
      finally { syncRef.current = false; }
    };
    const t = setTimeout(tick, 1500);
    const iv = setInterval(tick, 30000);
    return () => { stop = true; clearTimeout(t); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enCours, acte.id, o]);
  return (
    <section className="card p-5" aria-labelledby="signature">
      <h3 id="signature" className="mb-2 flex items-center gap-2">Signature du maire {e?.statut && <Badge tone={e.statut === 'signe' ? 'ok' : e.statut === 'refuse' ? 'ko' : 'warn'}>{e.statut === 'signe' ? 'Signé' : e.statut === 'refuse' ? 'Refusé' : e.statut === 'erreur' ? 'Erreur' : 'En attente'}</Badge>}</h3>
      <p className="mb-3 text-[13px] text-mute">Cet acte n'est pas inscrit au conseil : à la fin du circuit, il est envoyé au parapheur pour la signature du maire.</p>
      {etat.loading && !etat.data ? <Loading /> : !etat.data ? <ErrorBox msg={etat.error} /> : (
        <>
          {enErreur && <p className="mb-3 rounded bg-ko-bg p-2 text-[13px] text-ko">L'envoi précédent a échoué{e.motif ? ` : ${e.motif}` : ''}. Corrigez le paramétrage si besoin, puis <b>renvoyez</b> le document.</p>}
          <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
            <dt className="text-mute">Parapheur</dt><dd>{etat.data.config.fournisseurs.find((f: any) => f.code === etat.data.config.fournisseur)?.nom}{etat.data.simulateur && <span className="ml-2 text-[12px] text-warn">(simulation : aucun envoi réel)</span>}</dd>
            <dt className="text-mute">Mode</dt><dd>{etat.data.config.mode === 'dev' ? `dev — envoi à ${etat.data.config.email_test}` : `prod — signataire ${etat.data.config.signataire_email}`}</dd>
            <dt className="text-mute">Signature</dt><dd>{(etat.data.config.modes_signature?.find((x: any) => x.code === etat.data.config.signature_mode)?.nom) || 'Signature P12 (certificat)'}{e?.signataireEmail && etat.data.config.signature_mode === 'sms' && etat.data.config.signataire_telephone ? ` · ${etat.data.config.signataire_telephone}` : ''}</dd>
            <dt className="text-mute">Emplacement</dt><dd>{pos ? `page ${pos.page} · ${Math.round(pos.x)} % / ${Math.round(pos.y)} %` : <span className="font-semibold text-warn">à définir</span>}{peutPlacer && <button className="ml-2 text-action underline" onClick={() => setPlaceOpen(true)}>{pos ? 'modifier' : 'définir'}</button>}</dd>
            {e && <><dt className="text-mute">Signataire</dt><dd>{e.signataireNom} · {e.signataireEmail}</dd>
              <dt className="text-mute">Demandé le</dt><dd>{dt(e.demandeAt)}</dd>
              {e.signeAt && <><dt className="text-mute">Signé le</dt><dd>{dt(e.signeAt)}</dd></>}
              {e.motif && <><dt className="text-mute">Motif</dt><dd>{e.motif}</dd></>}
              {e.ref && <><dt className="text-mute">Référence</dt><dd className="font-mono text-[12px]">{e.ref}</dd></>}</>}
          </dl>
          {(e?.statut === 'signe' || e?.documentSigne) && (
            <div className="mb-3">
              <button className="btn-primary" onClick={voirSigne}><Download className="h-4 w-4" /> Document signé (PDF)</button>
              <p className="mt-1 text-[12px] text-mute">Le document signé revenu du parapheur fait foi : il ne peut plus être modifié.</p>
            </div>)}
          {staff && !pos && <p className="mb-3 rounded bg-warn-bg p-2 text-[13px] text-warn">Définissez l'<b>emplacement de la signature</b> ci-dessus avant d'envoyer le document au parapheur.</p>}
          {staff && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {acte.statut === 'signe' && <button className="btn-warn" disabled={!!busy} title="Rouvrir la décision signée pour modification : elle perd son document signé et revient à l'étape précédente" onClick={() => { const m = prompt('Motif de la réouverture (obligatoire) :'); if (m && m.trim().length >= 3) go('reouvrir', () => api.post(orgPath(o, `/parapheur/actes/${acte.id}/reouvrir`), { motif: m }), 'Décision rouverte pour modification'); }}><Undo2 className="h-4 w-4" /> Rouvrir pour modification</button>}
              {enErreur && <button className="btn-primary" disabled={!!busy || !pos} title="Renvoyer le document au parapheur (l'envoi précédent a échoué)" onClick={() => envoyer(false)}><RotateCcw className="h-4 w-4" /> Renvoyer au parapheur</button>}
              {enAttente && !enErreur && <button className={titreEnvoi ? 'btn-primary' : 'btn-warn'} disabled={!!busy || !pos} title={titreEnvoi || 'Envoyer ce document en signature du maire'} onClick={() => envoyer(false)}><Send className="h-4 w-4" /> {e ? 'Renvoyer en signature' : 'Envoyer en signature'}</button>}
              {!enAttente && !e && staff && circuitEnCours && <button className="btn-warn" disabled={!!busy || !pos} title="Le circuit n'est pas terminé : vous pouvez tout de même envoyer la décision en signature (administrateur / SCC)." onClick={() => envoyer(true)}><Send className="h-4 w-4" /> Envoyer en signature (forcé)</button>}
              {e && ['envoye', 'a_signer'].includes(e.statut) && <button className="btn-secondary" disabled={!!busy} onClick={() => go('sync', () => api.post(orgPath(o, `/parapheur/actes/${acte.id}/synchroniser`)), 'État interrogé')}>Interroger le parapheur</button>}
              {e && ['envoye', 'a_signer'].includes(e.statut) && <button className="btn-secondary text-ko" disabled={!!busy} onClick={() => { const m = prompt('Motif de l\'annulation :'); if (m !== null) go('annul', () => api.post(orgPath(o, `/parapheur/actes/${acte.id}/annuler`), { motif: m }), 'Envoi annulé'); }}>Annuler l'envoi</button>}
              {e && ['envoye', 'a_signer'].includes(e.statut) && <button className="btn-secondary" disabled={!!busy} title="Recréer un dossier de signature au parapheur (si l'envoi en cours est incomplet)" onClick={() => { if (confirm('Renvoyer un nouveau document au parapheur ?\n\nUn nouveau dossier de signature sera créé, à jour du document. L\'ancien envoi restera sans suite.')) envoyer(false); }}><RotateCcw className="h-4 w-4" /> Renvoyer au parapheur</button>}
              {etat.data.simulateur && e && ['envoye', 'a_signer'].includes(e.statut) && <><button className="btn-ok" disabled={!!busy} onClick={() => go('simok', () => api.post(orgPath(o, `/parapheur/actes/${acte.id}/retour`), { statut: 'signe' }), 'Signature simulée')}>Simuler : signé</button>
                <button className="btn-ko" disabled={!!busy} onClick={() => { const m = prompt('Motif du refus (optionnel) :') ?? undefined; go('simko', () => api.post(orgPath(o, `/parapheur/actes/${acte.id}/retour`), { statut: 'refuse', motif: m }), 'Refus simulé'); }}>Simuler : refusé</button></>}
            </div>)}
          {staff && !enAttente && !e && !titreEnvoi && (
            <p className="mb-3 rounded bg-warn-bg p-2 text-[13px] text-warn">Le circuit n'est pas terminé : l'envoi en signature deviendra possible à la fin du circuit, ou tout de suite avec « Envoyer en signature (forcé) ».</p>)}
          {etat.data.journal?.length > 0 && (
            <details className="rounded border border-line">
              <summary className="cursor-pointer p-2 text-[13px] font-semibold">Journal des échanges avec le parapheur ({etat.data.journal.length})</summary>
              <ul className="space-y-2 p-2">{etat.data.journal.map((x: any) => (
                <li key={x.id} className="rounded border border-line p-2 text-[12px]">
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={x.sens === 'sortant' ? 'blue' : 'gray'}>{SENS[x.sens] || x.sens}</Badge>
                    {x.methode && <span className="font-mono">{x.methode}</span>}{x.httpStatus && <span className="text-mute">HTTP {x.httpStatus}</span>}<span className="ml-auto text-mute">{dt(x.at)}</span></div>
                  {x.resume && <div className="mt-1">{x.resume}</div>}
                  {x.erreur && <div className="mt-1 text-ko">{x.erreur}</div>}
                  {x.corps && <JournalDetails data={x.corps} />}
                  {x.reponse && <JournalDetails data={x.reponse} />}
                </li>))}</ul>
            </details>)}
        </>)}
      {placeOpen && <SignaturePlacement acte={acte} initial={pos} onClose={() => setPlaceOpen(false)} onSaved={() => { etat.reload(); onChanged?.(); }} toast={toast} />}
    </section>
  );
}

/* ------------------------------------------------------------------------------------- panneau latéral : actions */
function Actions({ acte, circuit, reload, toast, onEnvoye }: { acte: any; circuit: any; reload: () => void; toast: (m: string, k?: 'ok' | 'ko') => void; onEnvoye?: (data: any) => void }) {
  const { org, me } = useAuth(); const o = org!.id;
  const [busy, setBusy] = useState(false); const [refus, setRefus] = useState(false); const [motif, setMotif] = useState('');
  const [rappel, setRappel] = useState(false); const [rappelMotif, setRappelMotif] = useState(''); const [recap, setRecap] = useState<string[] | null>(null);
  const [target, setTarget] = useState('previous'); const [resume, setResume] = useState('direct'); const [derog, setDerog] = useState<any>(null);
  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true);
    try { const r = await fn(); toast(ok); reload(); return r; }
    catch (e: any) { if (e.response?.status === 423) setDerog(e.response.data); else toast(errMsg(e), 'ko'); }
    finally { setBusy(false); }
  };
  const a = circuit?.actions ?? {};
  // Le rappel (interruption du circuit) ne concerne pas un acte déjà signé, et porte le nom du type d'acte.
  const rappelLibelle = acte.typeCode === 'decision' ? 'la décision' : acte.typeCode === 'arrete' ? "l'arrêté" : 'la délibération';
  const peutRappeler = !!circuit?.submitted && acte.statut !== 'signe' && (acte.redacteur === me?.username || acte.droits?.administrer);
  const ouvrirRappel = async () => {
    setRappelMotif(''); setRecap(null); setRappel(true);
    try { const r = await api.get(orgPath(o, `/actes/${acte.id}/notifications/destinataires`), { params: { code: 'acte.rappele' } }); setRecap(r.data.items || []); } catch { setRecap([]); }
  };
  const prevenus = useMemo(() => {
    const s = new Set<string>();
    for (const p of (circuit?.path ?? [])) for (const h of (p.holders ?? [])) if (h) s.add(h);
    if (acte.redacteur) s.add(acte.redacteur);
    return [...s];
  }, [circuit, acte.redacteur]);
  return (
    <>
      <div className="card p-5" id="actions">
        <h3 className="mb-2">Actions</h3>
        {a.submit && <button className="btn-primary w-full" disabled={busy} onClick={async () => { const r = await act(() => api.post(orgPath(o, `/actes/${acte.id}/envoi`)), 'Dossier envoyé au circuit'); if (r?.data) onEnvoye?.(r.data); }}><Send className="h-4 w-4" /> {acte.statut === 'modification_demandee' ? 'Renvoyer au circuit' : 'Envoyer pour validation'}</button>}
        {a.validate && <button className="btn-ok mt-2 w-full" disabled={busy} onClick={() => act(() => api.post(orgPath(o, `/actes/${acte.id}/validation`), {}), 'Étape validée')}><Check className="h-4 w-4" /> Valider{a.onBehalfOf ? ` (pour ${a.onBehalfOf})` : ''}</button>}
        {a.refuse && <button className="btn-ko mt-2 w-full" disabled={busy} onClick={() => setRefus(true)}><RotateCcw className="h-4 w-4" /> Demander une modification…</button>}
        {peutRappeler && <button className="btn-secondary mt-2 w-full" disabled={busy} onClick={ouvrirRappel}><Undo2 className="h-4 w-4" /> Rappeler {rappelLibelle}…</button>}
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
      {rappel && (
        <Modal title={`Rappeler ${rappelLibelle}`} onClose={() => setRappel(false)}>
          <div className="space-y-4">
            <p className="rounded bg-warn-bg p-3 text-warn">Le circuit est interrompu : aucune validation n'est plus attendue. Seules les personnes ayant eu affaire à {rappelLibelle} seront prévenues.</p>
            <div>
              <div className="label">Personnes prévenues</div>
              {recap === null ? <Loading /> : (
                <ul className="space-y-1 text-[13px]">{(recap.length ? recap : prevenus).map((u) => <li key={u}><AgentName u={u} /></li>)}
                  {!recap.length && !prevenus.length && <li className="text-mute">Aucune personne identifiée.</li>}</ul>)}
              <p className="mt-1 text-[12px] text-mute">Validations faites, avis, commentaires et amendements sur cette délibération, plus le rédacteur.</p>
            </div>
            <Field label="Motif du rappel (obligatoire)"><textarea className="input" rows={4} value={rappelMotif} onChange={(e) => setRappelMotif(e.target.value)} autoFocus /></Field>
            <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setRappel(false)}>Annuler</button>
              <button className="btn-ko" disabled={busy || rappelMotif.trim().length < 3} onClick={() => act(() => api.post(orgPath(o, `/actes/${acte.id}/rappeler`), { motif: rappelMotif }).then(() => setRappel(false)), 'Délibération rappelée : circuit interrompu')}>Rappeler</button></div>
          </div>
        </Modal>)}
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
/** Suivi des avis de commission (le rattachement se fait depuis la fiche, « infos clés »). */
function CommissionsBox({ acte, editable, toast }: { acte: any; editable: boolean; toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const { org } = useAuth(); const o = org!.id;
  const mine = useLoad(async () => (await api.get(orgPath(o, `/actes/${acte.id}/commissions`))).data, [acte.id]);
  const AVIS: Record<string, string> = { favorable: 'Favorable', defavorable: 'Défavorable', reserve: 'Réservé', sans_avis: 'Sans avis' };
  const remove = async (c: any) => {
    const motif = c.misADispositionAt ? prompt('Motif du retrait (obligatoire, les membres seront prévenus) :') : undefined;
    if (c.misADispositionAt && !motif) return;
    try { await api.delete(orgPath(o, `/actes/${acte.id}/commissions/${c.commissionId}`), { params: { motif } }); mine.reload(); } catch (e) { toast(errMsg(e), 'ko'); }
  };
  const avis = async (c: any) => {
    const v = prompt('Avis (favorable, defavorable, reserve, sans_avis) :', 'favorable'); if (!v) return;
    try { await api.put(orgPath(o, `/actes/${acte.id}/commissions/${c.commissionId}/avis`), { avis: v }); mine.reload(); } catch (e) { toast(errMsg(e), 'ko'); }
  };
  return (
    <div className="card p-5">
      <h3 className="mb-2">Avis des commissions</h3>
      {mine.data?.horsCommission ? <p className="text-mute">Hors commission.</p> : (
        <ul className="space-y-2">{mine.data?.items.filter((c: any) => !c.retireeAt).map((c: any) => (
          <li key={c.id} className="rounded border border-line p-2">
            <div className="flex items-center justify-between"><b>{c.commission}</b>{editable && <button className="text-ko" aria-label="Retirer" onClick={() => remove(c)}><Trash2 className="h-4 w-4" /></button>}</div>
            <div className="text-[12px] text-mute">{c.suspendue ? '⏸ mise à disposition suspendue' : c.misADispositionAt ? `Mis à disposition le ${d(c.misADispositionAt)}` : 'Mise à disposition à la validation DGS'}</div>
            {c.avis ? <Badge tone={c.avis === 'favorable' ? 'ok' : c.avis === 'defavorable' ? 'ko' : 'warn'}>{AVIS[c.avis]}</Badge> : c.misADispositionAt && <button className="text-[12px] font-semibold text-action" onClick={() => avis(c)}>Saisir l'avis</button>}
          </li>))}</ul>)}
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

/** Actions de l'historique qui correspondent à une étape validante (on écarte entrées, sauts et renvois). */
const HIST_ACTIONS: Record<string, { label: string; tone: 'ok' | 'blue' | 'gray' }> = {
  validate: { label: 'a validé', tone: 'ok' },
  auto_validate: { label: 'validée implicitement', tone: 'gray' },
  approve: { label: 'a approuvé (validation partielle)', tone: 'blue' },
  complete: { label: 'circuit terminé', tone: 'ok' },
};
/** Historique du circuit : uniquement les étapes validantes, sous forme de frise chronologique. */
function Historique({ circuit }: { circuit: any }) {
  const labels = new Map<string, string>((circuit?.path ?? []).map((p: any) => [p.key, p.label]));
  const items = (circuit?.events ?? []).filter((e: any) => HIST_ACTIONS[e.action]);
  if (!items.length) return null;
  return (
    <div className="card p-5"><h3 className="mb-3">Historique</h3>
      <ol className="relative ml-1 border-l border-line">
        {items.map((e: any) => {
          const h = HIST_ACTIONS[e.action];
          const step = e.from ? (labels.get(e.from) || e.from) : null;
          return (
            <li key={e.id} className="relative mb-4 pl-5 last:mb-0">
              <span className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ${h.tone === 'ok' ? 'bg-ok-solid' : h.tone === 'blue' ? 'bg-action-solid' : 'bg-line'}`} />
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <b className="text-head">{e.actor ? <AgentName u={e.actor} /> : 'Étape'}</b>
                {e.onBehalfOf && <span className="text-mute">(pour <AgentName u={e.onBehalfOf} />)</span>}
                <span className="text-mute">{h.label}</span>
                {step && <Badge tone={h.tone}>{step}</Badge>}
              </div>
              {e.comment && <div className="mt-0.5 text-[12px] italic text-mute">{e.comment}</div>}
              <div className="text-[11px] text-mute">{dt(e.at)}</div>
            </li>);
        })}
      </ol>
    </div>
  );
}

export default function Dossier() {
  const { id } = useParams();
  const { org, me } = useAuth(); const o = org!.id;
  const nav = useNavigate();
  const { toast, node } = useToast();
  const acte = useLoad(async () => (await api.get(orgPath(o, `/actes/${id}`))).data, [o, id]);
  const circuit = useLoad(async () => (await api.get(orgPath(o, `/actes/${id}/circuit`))).data, [o, id]);
  const gabarits = useLoad(async () => (await api.get(orgPath(o, '/gabarits'))).data.items as any[], [o]);
  const reloadAll = useCallback(() => { acte.reload(); circuit.reload(); }, [acte, circuit]);
  const [copying, setCopying] = useState(false);
  const [envoi, setEnvoi] = useState<{ data: any; premier: boolean } | null>(null);
  if (acte.loading && !acte.data) return <Loading />;
  if (acte.error || !acte.data) return <div><ErrorBox msg={acte.error || 'Dossier introuvable'} /><Link className="mt-4 inline-block text-action" to="/">← Retour aux dossiers</Link></div>;
  const a = acte.data; const c = circuit.data;
  // Un acte signé est figé : ses informations passent en lecture seule.
  const editable = !!a.droits?.modifier && a.statut !== 'signe';
  const peutSupprimer = !['en_circuit', 'en_attente_scc'].includes(a.statut)
    && (['adopte', 'archive', 'executoire', 'publie', 'transmis', 'ar_recu', 'rejete', 'retire'].includes(a.statut)
      ? !!a.droits?.administrer
      : (a.redacteur === me?.username || !!a.droits?.administrer));
  const supprimer = async () => {
    if (!confirm(`Supprimer définitivement le dossier #${a.numeroSuivi} « ${a.titre} » ?`)) return;
    try { await api.delete(orgPath(o, `/actes/${a.id}`)); toast('Dossier supprimé'); nav('/dossiers'); } catch (e) { toast(errMsg(e), 'ko'); }
  };
  const apercuDossier = async () => {
    try {
      const docs: PdfDoc[] = [{ title: `Dossier #${a.numeroSuivi} — ${a.titre}`, fetch: async () => (await api.post(orgPath(o, `/actes/${a.id}/apercu`), { cible: 'dossier', mode: 'propre', avecAnnexes: false }, { responseType: 'blob' })).data }];
      const annexes = (await api.get(orgPath(o, `/actes/${a.id}/annexes`))).data.items as any[];
      for (const x of annexes) docs.push({ title: x.titre || x.nom || 'Annexe', fetch: async () => (await api.get(orgPath(o, `/actes/${a.id}/annexes/${x.id}/file`), { params: { format: 'pdf' }, responseType: 'blob' })).data });
      showDocs(docs, 0);
    } catch (e) { toast(errMsg(e), 'ko'); }
  };
  // Le gabarit du document dépend du type d'acte : une décision (ou un arrêté) a son propre gabarit.
  const gabaritType = ['decision', 'arrete'].includes(a.typeCode) ? a.typeCode : 'deliberation';
  const libelleType = a.typeCode === 'decision' ? 'Décision' : a.typeCode === 'arrete' ? 'Arrêté' : 'Délibération';
  const modeleDocx = !!gabarits.data?.find((t) => t.docType === gabaritType)?.docx;
  const telechargerDocx = async () => { try { const r = await api.get(orgPath(o, `/actes/${a.id}/docx`), { params: { docType: gabaritType }, responseType: 'blob' }); const url = URL.createObjectURL(r.data); const el = document.createElement('a'); el.href = url; el.download = `${gabaritType}-${a.numeroSuivi}.docx`; el.click(); URL.revokeObjectURL(url); } catch (e) { toast(errMsg(e), 'ko'); } };
  const apercuModele = async () => { const m = await openPdf(() => api.get(orgPath(o, `/actes/${a.id}/docx-pdf`), { params: { docType: gabaritType }, responseType: 'blob' }), `${libelleType} (modèle Word) — ${a.titre}`); if (m) toast(`Aperçu impossible : ${m}`, 'ko'); };
  const onEnvoye = (data: any) => {
    let premier = true;
    try { const k = `vibedelib.premier-envoi.${me?.username ?? 'x'}`; premier = !localStorage.getItem(k); localStorage.setItem(k, '1'); } catch { /* stockage indisponible : message générique */ }
    setEnvoi({ data, premier });
  };
  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 text-[12px] text-mute"><Link to="/" className="hover:underline">Mes actes</Link> › Dossier #{a.numeroSuivi}</div>
        <div className="flex flex-wrap items-center gap-3"><h1 className="min-w-0 flex-1">{a.titre}</h1><TypeBadge acte={a} /><StatutBadge statut={a.statut} />
          <button className="btn-secondary" onClick={() => setCopying(true)}><Copy className="h-4 w-4" /> Copier…</button>
          <button className="btn-secondary" onClick={apercuDossier}><Eye className="h-4 w-4" /> Aperçu PDF du dossier</button>
          {modeleDocx && <button className="btn-secondary" onClick={telechargerDocx}><FileText className="h-4 w-4" /> {libelleType} Word</button>}
          {modeleDocx && <button className="btn-secondary" onClick={apercuModele}><Eye className="h-4 w-4" /> {libelleType} (modèle)</button>}
          {peutSupprimer && <button className="btn-secondary text-ko" onClick={supprimer}><Trash2 className="h-4 w-4" /> Supprimer</button>}</div>
      </div>
      {c && <div className="card p-4"><Frise circuit={c} />{c.statut === 'modification_demandee' && <p className="mt-2 rounded bg-warn-bg p-2 text-warn">Modification demandée — voir la discussion pour le motif.</p>}</div>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Fiche acte={a} editable={editable} onSaved={() => { reloadAll(); toast('Fiche enregistrée'); }} />
          {a.typeInfo?.meta?.autorisations && <Autorisations acte={a} editable={editable} onChanged={() => { reloadAll(); toast('Délibérations d\'autorisation mises à jour'); }} toast={toast} />}
          <Textes acte={a} editable={editable || !!c?.actions?.validate} onChanged={acte.reload} onApercu={apercuDossier} toast={toast} />
          {a.typeInfo?.meta?.signature && <Signature acte={a} toast={toast} onChanged={reloadAll} />}          <Annexes acte={a} editable={editable} toast={toast} />
          <Discussion acte={a} toast={toast} />
        </div>
        <aside className="space-y-4">
          {a.custom?.entrainement && <div role="note" className="rounded border border-primary/30 bg-primary/5 p-3 text-[13px]"><b>Dossier d’entraînement</b> : essayez tout librement. Il ne partira jamais dans un vrai circuit et se supprime tout seul au bout de 14 jours.</div>}
          <ActiverAssiste acte={a} editable={editable} onReload={reloadAll} toast={toast} />
          <Actions acte={a} circuit={c} reload={reloadAll} toast={toast} onEnvoye={onEnvoye} />
          {/* Propositions de l'IA : utiles en rédaction seulement — masquées une fois signé, validé DGS ou renvoyé. */}
          {!['signe', 'valide_dgs', 'modification_demandee'].includes(a.statut) && <IaPanel acte={a} editable={editable} onApplied={acte.reload} toast={toast} />}
          {a.statut === 'brouillon' || a.statut === 'modification_demandee' ? <Completude c={a.completude} /> : null}
          <CommissionsBox acte={a} editable={editable} toast={toast} />
          {(a.statut === 'brouillon' || a.statut === 'modification_demandee') && <ActesProches acte={a} />}
          <Historique circuit={c} />
        </aside>
      </div>
      {copying && <CopieModal acte={a} onClose={() => setCopying(false)} toast={toast} />}
      {a.custom?.assiste?.actif && <DossierAssiste acte={a} editable={editable} onReload={reloadAll} onApercu={apercuDossier} toast={toast} />}
      {envoi && <EnvoiBravo data={envoi.data} premier={envoi.premier} onClose={() => setEnvoi(null)} />}
      {node}
    </div>
  );
}
