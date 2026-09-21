import { FormEvent, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, Copy, Download, FileUp, Pencil, Plus, Rocket, Trash2, TriangleAlert, Wrench } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import AgentPicker from '../AgentPicker';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, Spinner, useLoad, useToast } from '../ui';
import { Select } from '../Select';

type Step = { key: string; label: string; resolver: { kind: string; fonction?: string; code?: string; username?: string }; mode?: string; quorum?: number; canEdit?: boolean; optional?: boolean; nonDelegable?: boolean; masquerNoms?: boolean; slaDays?: number; refusTo?: string; onEnter?: any; onDone?: any };
type Transition = { from: string; to: string; when?: { field: string; op: string; value?: any }; otherwise?: boolean };
type Graph = { start: string; steps: Step[]; transitions: Transition[] };

const KINDS: Record<string, string> = { redacteur: 'Rédacteur', titulaire: 'Titulaire d\'une fonction', groupe: 'Groupe de valideurs', agent: 'Agent désigné' };
const FONCTIONS: Record<string, string> = { responsable_intermediaire: 'Responsable intermédiaire', chef_service: 'Chef de service', directeur: 'Directeur', dga: 'DGA', dgs: 'DGS' };
const MODES: Record<string, string> = { one: 'Un seul valideur suffit', all: 'Tous doivent valider', quorum: 'Quorum' };
const FIELDS: Record<string, string> = { incidenceFinanciere: 'Incidence financière', montant: 'Montant', urgence: 'Urgence', hasCommission: 'Passe en commission', typeCode: "Type d'acte", directionCode: 'Direction', serviceCode: 'Service' };
const OPS: Record<string, string> = { eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', in: 'parmi', empty: 'est vide', notEmpty: "n'est pas vide" };
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const resolverLabel = (s: Step) => `${KINDS[s.resolver?.kind] ?? '?'}${s.resolver?.fonction ? ` : ${FONCTIONS[s.resolver.fonction] ?? s.resolver.fonction}` : ''}${s.resolver?.code ? ` : ${s.resolver.code}` : ''}${s.resolver?.username ? ` : @${s.resolver.username}` : ''}`;

/** Ordre d'affichage : parcours en largeur depuis l'étape initiale (les étapes non reliées suivent). */
function orderOf(g: Graph): Step[] {
  const seen = new Set<string>(); const out: Step[] = []; const q = [g.start];
  while (q.length) { const k = q.shift()!; if (seen.has(k)) continue; seen.add(k); const s = g.steps.find((x) => x.key === k); if (s) out.push(s); g.transitions.filter((t) => t.from === k).forEach((t) => q.push(t.to)); }
  return [...out, ...g.steps.filter((s) => !seen.has(s.key))];
}
/** Étapes situées en amont d'une étape (candidates à l'étape de refus). */
function upstream(g: Graph, key: string): string[] {
  const rev = new Map<string, string[]>(); g.transitions.forEach((t) => rev.set(t.to, [...(rev.get(t.to) ?? []), t.from]));
  const seen = new Set<string>(); const st = [...(rev.get(key) ?? [])];
  while (st.length) { const k = st.pop()!; if (seen.has(k)) continue; seen.add(k); (rev.get(k) ?? []).forEach((x) => st.push(x)); }
  return [...seen];
}

/**
 * Circuits de validation (D71, ORG-08, ORG-09) : création, modification, duplication, suppression, import / export, et éditeur d'un brouillon —
 * étapes (valideurs, mode, délai, ÉTAPE DE REFUS) et transitions (avec conditions) ; contrôle de cohérence, puis publication.
 */
export default function Circuits() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const list = useLoad(async () => (await api.get(orgPath(o, '/circuits'))).data.items as any[], [o]);
  const [creating, setCreating] = useState(false); const [dup, setDup] = useState<any>(null); const [props, setProps] = useState<any>(null); const [editing, setEditing] = useState<{ c: any; version: number } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const edit = async (c: any) => {
    try {
      let draft = c.versions.find((v: any) => v.status === 'draft');
      if (!draft) draft = (await api.post(orgPath(o, `/circuits/${c.id}/versions`), {})).data;
      setEditing({ c, version: draft.version });
    } catch (e) { toast(errMsg(e), 'ko'); }
  };
  const remove = async (c: any) => { if (!window.confirm(`Supprimer définitivement le circuit « ${c.nom} » ?`)) return; try { await api.delete(orgPath(o, `/circuits/${c.id}`)); toast('Circuit supprimé'); list.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  const exporter = async (c: any) => { const r = (await api.get(orgPath(o, `/circuits/${c.id}/export`))).data; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' })); a.download = `circuit-${c.code}.json`; a.click(); };
  const importer = async (f: File) => {
    try { const j = JSON.parse(await f.text()); await api.post(orgPath(o, '/circuits/import'), { format: j.format, code: `${j.code}-import`.slice(0, 40), nom: `${j.nom} (import)`, graph: j.graph }); toast('Circuit importé (brouillon)'); list.reload(); } catch (e) { toast(errMsg(e), 'ko'); }
  };

  if (editing) return <>{<Editor o={o} c={editing.c} version={editing.version} toast={toast} onClose={() => { setEditing(null); list.reload(); }} />}{node}</>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="max-w-3xl text-mute">Le circuit est une <b>donnée</b> : il se crée, se modifie, se duplique et se supprime sans toucher au code (administrateur et SCC). Chaque étape définit ses valideurs et son <b>étape de refus</b> (par défaut : l'étape précédente).</p>
        <span className="ml-auto flex gap-2"><input ref={file} type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importer(f); e.target.value = ''; }} />
          <button className="btn-secondary" onClick={() => file.current?.click()}><FileUp className="h-4 w-4" /> Importer</button>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nouveau circuit</button></span>
      </div>
      {list.loading ? <Loading /> : !list.data?.length ? <Empty>Aucun circuit : les dossiers ne peuvent pas être envoyés.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2">{list.data.map((c) => {
          const pub = c.versions.find((v: any) => v.status === 'published'); const draft = c.versions.find((v: any) => v.status === 'draft');
          return (
            <article key={c.id} className="card p-5">
              <div className="flex items-start justify-between gap-2"><div><h3>{c.nom}</h3><code className="text-[11px] text-mute">{c.code}</code></div><span className="flex gap-1">{pub ? <Badge tone="ok">v{pub.version} publiée</Badge> : <Badge>jamais publié</Badge>}{draft && <Badge tone="warn">brouillon v{draft.version}</Badge>}</span></div>
              <p className="mt-1 text-mute">{c.directionCode ? `Direction ${c.directionCode}` : 'Toutes directions'}{c.typeActeId ? " · type d'acte précis" : ' · tous types d’actes'} · {c.versions.length} version(s)</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-primary !py-1" onClick={() => edit(c)}><Wrench className="h-3.5 w-3.5" /> Modifier</button>
                <button className="btn-secondary !py-1" onClick={() => setProps(c)}><Pencil className="h-3.5 w-3.5" /> Propriétés</button>
                <button className="btn-secondary !py-1" onClick={() => setDup(c)}><Copy className="h-3.5 w-3.5" /> Dupliquer</button>
                <button className="btn-secondary !py-1" onClick={() => exporter(c)}><Download className="h-3.5 w-3.5" /> Exporter</button>
                <button className="btn-secondary !py-1 !text-ko" onClick={() => remove(c)}><Trash2 className="h-3.5 w-3.5" /> Supprimer</button>
              </div>
            </article>);
        })}</div>)}
      {creating && <CreateForm o={o} onClose={() => setCreating(false)} onDone={(c) => { toast('Circuit créé (brouillon)'); list.reload(); setEditing({ c, version: 1 }); }} />}
      {dup && <DupForm o={o} c={dup} onClose={() => setDup(null)} onDone={() => { toast('Circuit dupliqué'); list.reload(); }} />}
      {props && <PropsForm o={o} c={props} onClose={() => setProps(null)} onDone={() => { toast('Propriétés enregistrées'); list.reload(); }} />}
      {node}
    </div>
  );
}

function CreateForm({ o, onClose, onDone }: { o: number; onClose: () => void; onDone: (c: any) => void }) {
  const modeles = useLoad(async () => (await api.get(orgPath(o, '/circuits/modeles'))).data.items as any[], [o]);
  const [f, setF] = useState({ nom: '', code: '', modele: '' }); const [manual, setManual] = useState(false); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const c = (await api.post(orgPath(o, '/circuits'), { code: f.code, nom: f.nom, fromTemplate: f.modele || undefined })).data; onDone(c); onClose(); } catch (x) { setErr(errMsg(x)); setBusy(false); }
  };
  return (
    <Modal title="Nouveau circuit" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4"><ErrorBox msg={err} />
        <Field label="Nom"><input className="input" required autoFocus value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value, code: manual ? f.code : slug(e.target.value).replace(/_/g, '-') })} /></Field>
        <Field label="Code" hint="Minuscules, chiffres, - et _"><input className="input" required pattern="[a-z0-9_-]{2,40}" value={f.code} onChange={(e) => { setManual(true); setF({ ...f, code: e.target.value }); }} /></Field>
        <Field label="Point de départ"><Select className="input" value={f.modele} onChange={(e) => setF({ ...f, modele: e.target.value })}><option value="">Circuit vide (rédaction seule)</option>{modeles.data?.map((m) => <option key={m.code} value={m.code}>{m.nom}</option>)}</Select></Field>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />} Créer</button></div>
      </form>
    </Modal>
  );
}
function DupForm({ o, c, onClose, onDone }: { o: number; c: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ nom: `${c.nom} (copie)`, code: `${c.code}-copie`.slice(0, 40) }); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setErr(null); try { await api.post(orgPath(o, `/circuits/${c.id}/duplication`), f); onDone(); onClose(); } catch (x) { setErr(errMsg(x)); setBusy(false); } };
  return (
    <Modal title={`Dupliquer « ${c.nom} »`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4"><ErrorBox msg={err} />
        <Field label="Nom"><input className="input" required value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} /></Field>
        <Field label="Code"><input className="input" required pattern="[a-z0-9_-]{2,40}" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />} Dupliquer</button></div>
      </form>
    </Modal>
  );
}
function PropsForm({ o, c, onClose, onDone }: { o: number; c: any; onClose: () => void; onDone: () => void }) {
  const dirs = useLoad(async () => (await api.get('/directory/directions')).data.items as any[], []);
  const types = useLoad(async () => (await api.get(orgPath(o, '/referentiels/type_acte'))).data.items as any[], [o]);
  const [f, setF] = useState({ nom: c.nom, directionCode: c.directionCode ?? '', typeActeId: c.typeActeId ?? '' }); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.put(orgPath(o, `/circuits/${c.id}`), { nom: f.nom, directionCode: f.directionCode || null, typeActeId: f.typeActeId ? Number(f.typeActeId) : null }); onDone(); onClose(); } catch (x) { setErr(errMsg(x)); setBusy(false); }
  };
  return (
    <Modal title={`Propriétés — ${c.nom}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4"><ErrorBox msg={err} />
        <Field label="Nom"><input className="input" required value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} /></Field>
        <Field label="Direction" hint="Le circuit le plus spécifique s'applique."><Select className="input" value={f.directionCode} onChange={(e) => setF({ ...f, directionCode: e.target.value })}><option value="">Toutes les directions</option>{dirs.data?.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}</Select></Field>
        <Field label="Type d'acte"><Select className="input" value={f.typeActeId} onChange={(e) => setF({ ...f, typeActeId: e.target.value })}><option value="">Tous les types</option>{types.data?.map((t) => <option key={t.id} value={t.id}>{t.libelle}</option>)}</Select></Field>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />} Enregistrer</button></div>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------------------------------------- éditeur d'un brouillon */
function Editor({ o, c, version, toast, onClose }: { o: number; c: any; version: number; toast: (m: string, k?: 'ok' | 'ko') => void; onClose: () => void }) {
  const base = orgPath(o, `/circuits/${c.id}/versions/${version}`);
  const v = useLoad(async () => (await api.get(base)).data, [base]);
  const groupes = useLoad(async () => (await api.get(orgPath(o, '/groupes'))).data.items as any[], [o]);
  const [g, setG] = useState<Graph | null>(null); const [dirty, setDirty] = useState(false); const [sel, setSel] = useState<string | null>(null);
  const [ctl, setCtl] = useState<any>(null); const [busy, setBusy] = useState(false); const [pub, setPub] = useState(false);
  if (v.data && !g) setG(clone(v.data.graph));
  const change = (fn: (x: Graph) => void) => { setG((cur) => { const n = clone(cur!); fn(n); return n; }); setDirty(true); setCtl(null); };
  const ordered = useMemo(() => (g ? orderOf(g) : []), [g]);
  if (!g) return <Loading />;
  const cur = g.steps.find((s) => s.key === sel) ?? null;
  const upd = (key: string, patch: Partial<Step>) => change((x) => { const s = x.steps.find((y) => y.key === key)!; Object.assign(s, patch); Object.keys(patch).forEach((k) => { if ((patch as any)[k] === undefined || (patch as any)[k] === '') delete (s as any)[k]; }); });

  const insertAfter = (after: string) => change((x) => {
    let k = 'etape'; let n = 1; while (x.steps.some((s) => s.key === `${k}_${n}`)) n++; const key = `${k}_${n}`;
    x.steps.push({ key, label: 'Nouvelle étape', resolver: { kind: 'titulaire', fonction: 'chef_service' }, canEdit: true, slaDays: 3 });
    x.transitions.forEach((t) => { if (t.from === after) t.from = key; });
    x.transitions.push({ from: after, to: key }); setSel(key);
  });
  const removeStep = (key: string) => {
    if (key === g.start) { toast("L'étape initiale (rédaction) ne se supprime pas", 'ko'); return; }
    const out = g.transitions.filter((t) => t.from === key);
    if (out.length > 1) { toast('Cette étape a plusieurs sorties : supprimez d’abord ses branches (transitions)', 'ko'); return; }
    change((x) => {
      const next = out[0]?.to;
      x.transitions = x.transitions.filter((t) => t.from !== key).map((t) => (t.to === key ? (next ? { ...t, to: next } : null) : t)).filter(Boolean) as Transition[];
      x.steps = x.steps.filter((s) => s.key !== key); x.steps.forEach((s) => { if (s.refusTo === key) delete s.refusTo; });
    });
    setSel(null);
  };
  /** Fait descendre une étape d'un rang dans un tronçon linéaire : a → k → b devient a → b → k. Monter = faire descendre la précédente. */
  const moveDown = (x: Graph, key: string) => {
    const inn = x.transitions.filter((t) => t.to === key); const out = x.transitions.filter((t) => t.from === key);
    if (inn.length !== 1 || out.length !== 1 || key === x.start) return;
    const b = out[0].to; const bOut = x.transitions.filter((t) => t.from === b);
    inn[0].to = b; out[0].from = b; out[0].to = key; bOut.forEach((t) => { t.from = key; });
  };
  const move = (key: string, dir: -1 | 1) => change((x) => {
    if (dir === 1) return moveDown(x, key);
    const inn = x.transitions.filter((t) => t.to === key);
    if (inn.length === 1 && inn[0].from !== x.start) moveDown(x, inn[0].from);
  });

  const save = async (silent = false) => { setBusy(true); try { await api.put(base, g); setDirty(false); if (!silent) toast('Brouillon enregistré'); return true; } catch (e) { toast(errMsg(e), 'ko'); return false; } finally { setBusy(false); } };
  const controle = async () => { if (!(await save(true))) return; try { setCtl((await api.post(`${base}/controle`, {})).data); } catch (e) { toast(errMsg(e), 'ko'); } };
  const supprimer = async () => { if (!window.confirm('Supprimer ce brouillon ?')) return; try { await api.delete(base); toast('Brouillon supprimé'); onClose(); } catch (e) { toast(errMsg(e), 'ko'); } };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-secondary" onClick={() => { if (!dirty || window.confirm('Quitter sans enregistrer ?')) onClose(); }}>← Circuits</button>
        <h3>{c.nom} <Badge tone="warn">brouillon v{version}</Badge></h3>
        <span className="ml-auto flex flex-wrap gap-2">
          <button className="btn-secondary" disabled={busy} onClick={() => save()}>{busy && <Spinner />} Enregistrer{dirty ? ' •' : ''}</button>
          <button className="btn-secondary" onClick={controle}><CheckCircle2 className="h-4 w-4" /> Contrôler</button>
          <button className="btn-primary" onClick={async () => { if (await save(true)) setPub(true); }}><Rocket className="h-4 w-4" /> Publier…</button>
          <button className="btn-secondary !text-ko" onClick={supprimer}><Trash2 className="h-4 w-4" /> Supprimer le brouillon</button>
        </span>
      </div>
      {ctl && (
        <div role="status" className={`rounded border px-4 py-3 ${ctl.ok ? 'border-ok/30 bg-ok-bg text-ok' : 'border-ko/30 bg-ko-bg text-ko'}`}>
          {ctl.ok ? <b>Circuit cohérent : prêt à être publié.</b> : <><b>{ctl.errors.length} erreur(s) à corriger :</b><ul className="mt-1 list-disc pl-5">{ctl.errors.map((e: any, i: number) => <li key={i}>{e.message}</li>)}</ul></>}
          {ctl.warnings?.length > 0 && <ul className="mt-1 list-disc pl-5 text-warn">{ctl.warnings.map((e: any, i: number) => <li key={i}><TriangleAlert className="mr-1 inline h-3.5 w-3.5" />{e.message}</li>)}</ul>}
        </div>)}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3"><h4>Étapes</h4><span className="text-[12px] text-mute">{g.steps.length} étape(s)</span></div>
          <ol>{ordered.map((s, i) => (
            <li key={s.key} className={`flex items-center gap-2 border-b border-line/60 px-3 py-2 ${sel === s.key ? 'bg-action/10' : ''}`}>
              <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setSel(s.key)}>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">{i + 1}</span>
                <span className="min-w-0"><span className="block truncate font-semibold">{s.label}</span><span className="block truncate text-[11px] text-mute">{resolverLabel(s)}{s.slaDays ? ` · ${s.slaDays} j` : ''}{s.optional ? ' · optionnelle' : ''}{s.refusTo ? ` · refus → ${g.steps.find((x) => x.key === s.refusTo)?.label ?? s.refusTo}` : ''}</span></span></button>
              {s.key !== g.start && <><button className="rounded p-1 hover:bg-slate-100" aria-label="Monter" onClick={() => move(s.key, -1)}><ArrowUp className="h-4 w-4" /></button><button className="rounded p-1 hover:bg-slate-100" aria-label="Descendre" onClick={() => move(s.key, 1)}><ArrowDown className="h-4 w-4" /></button></>}
              <button className="rounded p-1 text-action hover:bg-slate-100" title="Ajouter une étape après celle-ci" aria-label="Ajouter une étape après" onClick={() => insertAfter(s.key)}><Plus className="h-4 w-4" /></button>
              {s.key !== g.start && <button className="rounded p-1 text-ko hover:bg-ko-bg" aria-label="Supprimer l’étape" onClick={() => removeStep(s.key)}><Trash2 className="h-4 w-4" /></button>}
            </li>))}</ol>
        </section>

        <section className="card p-4">
          {!cur ? <p className="text-mute">Sélectionnez une étape pour la modifier, ou ajoutez-en une avec le bouton +.</p> : (
            <div className="space-y-3">
              <h4>Étape « {cur.label} » <code className="text-[11px] font-normal text-mute">{cur.key}</code></h4>
              <Field label="Libellé"><input className="input" value={cur.label} onChange={(e) => upd(cur.key, { label: e.target.value })} /></Field>
              {cur.key !== g.start ? (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Qui valide"><Select className="input" value={cur.resolver?.kind} onChange={(e) => upd(cur.key, { resolver: e.target.value === 'titulaire' ? { kind: 'titulaire', fonction: 'chef_service' } : e.target.value === 'groupe' ? { kind: 'groupe', code: groupes.data?.[0]?.code ?? '' } : e.target.value === 'agent' ? { kind: 'agent', username: '' } : { kind: 'redacteur' } })}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
                    {cur.resolver?.kind === 'titulaire' && <Field label="Fonction"><Select className="input" value={cur.resolver.fonction} onChange={(e) => upd(cur.key, { resolver: { kind: 'titulaire', fonction: e.target.value } })}>{Object.entries(FONCTIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>}
                    {cur.resolver?.kind === 'groupe' && <Field label="Groupe"><Select className="input" value={cur.resolver.code} onChange={(e) => upd(cur.key, { resolver: { kind: 'groupe', code: e.target.value } })}>{groupes.data?.map((x) => <option key={x.code} value={x.code}>{x.nom}</option>)}</Select></Field>}
                    {cur.resolver?.kind === 'agent' && <AgentPicker label="Agent" value={cur.resolver.username ?? ''} onChange={(u) => upd(cur.key, { resolver: { kind: 'agent', username: u } })} />}
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <Field label="Validation"><Select className="input" value={cur.mode ?? 'one'} onChange={(e) => upd(cur.key, { mode: e.target.value === 'one' ? undefined : e.target.value, quorum: e.target.value === 'quorum' ? 2 : undefined })}>{Object.entries(MODES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
                    {cur.mode === 'quorum' && <Field label="Quorum"><input className="input" type="number" min={1} value={cur.quorum ?? 2} onChange={(e) => upd(cur.key, { quorum: Number(e.target.value) })} /></Field>}
                    <Field label="Délai (jours ouvrés)"><input className="input" type="number" min={0} max={365} value={cur.slaDays ?? ''} onChange={(e) => upd(cur.key, { slaDays: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
                  </div>
                  <Field label="Étape de refus" hint="Où repart le dossier si cette étape le refuse. Sans choix : l'étape précédente (−1).">
                    <Select className="input" value={cur.refusTo ?? ''} onChange={(e) => upd(cur.key, { refusTo: e.target.value || undefined })}><option value="">Étape précédente (par défaut)</option>{upstream(g, cur.key).map((k) => <option key={k} value={k}>{g.steps.find((s) => s.key === k)?.label ?? k}</option>)}</Select></Field>
                  <div className="flex flex-wrap gap-4 text-[13px]">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!cur.canEdit} onChange={(e) => upd(cur.key, { canEdit: e.target.checked || undefined })} /> Peut modifier le texte</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!cur.optional} onChange={(e) => upd(cur.key, { optional: e.target.checked || undefined })} /> Étape optionnelle (ignorée sans titulaire)</label>
                    <label className="flex items-center gap-2" title="Sur le tableau de bord et la frise du dossier, seule l’étape de validation est affichée, pas le nom des valideurs. Par défaut : activé pour les étapes tenues par un groupe (financier, juridique, SCC)."><input type="checkbox" checked={cur.masquerNoms ?? cur.resolver.kind === 'groupe'} onChange={(ev) => upd(cur.key, { masquerNoms: ev.target.checked })} /> Ne pas afficher les noms des valideurs (seulement l’étape)</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!cur.nonDelegable} onChange={(e) => upd(cur.key, { nonDelegable: e.target.checked || undefined })} /> Non déléguable</label>
                  </div>
                </>) : <p className="text-[12px] text-mute">L'étape initiale est celle du rédacteur : elle ne se paramètre pas davantage.</p>}
            </div>)}
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3"><h4>Transitions <span className="text-[12px] font-normal text-mute">— l'enchaînement des étapes, avec ses conditions</span></h4>
          <button className="btn-secondary !py-1" onClick={() => change((x) => { x.transitions.push({ from: x.steps[0].key, to: x.steps[Math.min(1, x.steps.length - 1)].key }); })}><Plus className="h-3.5 w-3.5" /> Transition</button></div>
        <div className="overflow-x-auto"><table className="w-full text-[13px]"><thead><tr><th>De</th><th>Vers</th><th>Condition</th><th /></tr></thead><tbody>
          {g.transitions.map((t, i) => (
            <tr key={i}>
              <td><Select className="input w-auto" value={t.from} onChange={(e) => change((x) => { x.transitions[i].from = e.target.value; })}>{g.steps.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</Select></td>
              <td><Select className="input w-auto" value={t.to} onChange={(e) => change((x) => { x.transitions[i].to = e.target.value; })}>{g.steps.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</Select></td>
              <td className="space-x-2">
                <Select className="input w-auto" value={t.otherwise ? 'otherwise' : t.when ? 'when' : 'none'} onChange={(e) => change((x) => { const y = x.transitions[i]; delete y.when; delete y.otherwise; if (e.target.value === 'when') y.when = { field: 'incidenceFinanciere', op: 'eq', value: true }; if (e.target.value === 'otherwise') y.otherwise = true; })}>
                  <option value="none">Toujours</option><option value="when">Si…</option><option value="otherwise">Sinon (par défaut)</option></Select>
                {t.when && <>
                  <Select className="input w-auto" value={t.when.field} onChange={(e) => change((x) => { x.transitions[i].when!.field = e.target.value; })}>{Object.entries(FIELDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
                  <Select className="input w-auto" value={t.when.op} onChange={(e) => change((x) => { x.transitions[i].when!.op = e.target.value; })}>{Object.entries(OPS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
                  {!['empty', 'notEmpty'].includes(t.when.op) && <input className="input inline-block w-32" value={String(t.when.value ?? '')} onChange={(e) => change((x) => { const raw = e.target.value; x.transitions[i].when!.value = raw === 'true' ? true : raw === 'false' ? false : raw !== '' && !isNaN(Number(raw)) ? Number(raw) : raw; })} />}</>}
              </td>
              <td className="text-right"><button className="rounded p-1 text-ko hover:bg-ko-bg" aria-label="Supprimer la transition" onClick={() => change((x) => { x.transitions.splice(i, 1); })}><Trash2 className="h-4 w-4" /></button></td>
            </tr>))}
          {!g.transitions.length && <tr><td colSpan={4} className="py-4 text-center text-mute">Aucune transition : le circuit s'arrête à la rédaction.</td></tr>}
        </tbody></table></div>
      </section>
      {pub && <Publier base={base} onClose={() => setPub(false)} onDone={() => { toast('Version publiée'); onClose(); }} />}
    </div>
  );
}

function Publier({ base, onClose, onDone }: { base: string; onClose: () => void; onDone: () => void }) {
  const [effect, setEffect] = useState<'nouveaux-seulement' | 'migrer'>('nouveaux-seulement'); const [comment, setComment] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setErr(null); try { await api.post(`${base}/publication`, { effect, comment: comment || undefined }); onDone(); } catch (e) { setErr(errMsg(e)); setBusy(false); } };
  return (
    <Modal title="Publier cette version" onClose={onClose}>
      <div className="space-y-4"><ErrorBox msg={err} />
        <label className="flex items-start gap-3 rounded border border-line p-3"><input type="radio" className="mt-1" checked={effect === 'nouveaux-seulement'} onChange={() => setEffect('nouveaux-seulement')} /><span><b>Nouveaux dossiers seulement</b><br /><span className="text-[12px] text-mute">Les dossiers en cours gardent leur circuit (l'historique n'est jamais modifié).</span></span></label>
        <label className="flex items-start gap-3 rounded border border-line p-3"><input type="radio" className="mt-1" checked={effect === 'migrer'} onChange={() => setEffect('migrer')} /><span><b>Migrer les dossiers en cours</b><br /><span className="text-[12px] text-mute">Les dossiers en cours passent sur le nouveau circuit, à l'étape de même nom.</span></span></label>
        <Field label="Commentaire (facultatif)"><input className="input" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={300} /></Field>
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy} onClick={go}>{busy && <Spinner />} Publier</button></div></div>
    </Modal>
  );
}
