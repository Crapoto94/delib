import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, LogIn, Plus, Trash2, UserPlus, Waypoints } from 'lucide-react';
import { api, errMsg } from '../api';
import { useAuth } from '../auth';
import AgentPicker from '../AgentPicker';
import { OrgLogo } from '../Brand';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, Spinner, useLoad, useToast } from '../ui';

const TYPES: Record<string, string> = { commune: 'Commune', ccas: 'CCAS', autre: 'Autre organisme' };
const ROLES: Record<string, string> = { org_admin: 'Administrateur', scc: 'SCC', teletransmission: 'Télétransmission', lecteur: 'Lecteur' };
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/**
 * Collectivités (multi-organismes, MOR) : réservé à l'administrateur de plateforme. Chaque collectivité a ses propres circuits, séances,
 * actes, titulaires, gabarits, logo et paramètres, et reste étanche vis-à-vis des autres. Les agents accèdent à une collectivité par un
 * rôle explicite ou parce que leur direction lui est rattachée.
 */
export default function Collectivites() {
  const { me, org, setOrg, reload } = useAuth(); const nav = useNavigate(); const { toast, node } = useToast();
  const list = useLoad(async () => (await api.get('/organismes')).data.items as any[], []);
  const [creating, setCreating] = useState(false); const [dirsFor, setDirsFor] = useState<any>(null); const [adminsFor, setAdminsFor] = useState<any>(null);

  const refresh = async () => { await list.reload(); await reload(); };
  const toggle = async (o: any) => {
    try { await api.put(`/organismes/${o.id}`, { actif: !o.actif }); toast(o.actif ? 'Collectivité désactivée' : 'Collectivité réactivée'); await refresh(); } catch (e) { toast(errMsg(e), 'ko'); }
  };
  if (!me?.isPlatformAdmin) return <Empty>Cet écran est réservé à l'administrateur de plateforme.</Empty>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="max-w-3xl text-mute">Chaque collectivité (commune, CCAS, autre organisme) travaille dans son propre espace — circuits, séances, dossiers, titulaires, gabarits, logo — sans jamais voir les autres. Une direction de l'organigramme RH est rattachée à <b>une seule</b> collectivité ; les agents des directions non rattachées relèvent de la collectivité par défaut.</p>
        <button className="btn-primary ml-auto" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nouvelle collectivité</button>
      </div>
      {list.loading ? <Loading /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.data?.map((o) => (
            <section key={o.id} className={`card p-5 ${o.id === org?.id ? 'ring-2 ring-action' : ''} ${o.actif === false ? 'opacity-70' : ''}`}>
              <div className="flex items-start gap-3">
                <OrgLogo orgId={o.id} nom={o.nom} hasLogo={!!o.hasLogo} version={o.logoVersion ?? null} className="h-12" />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate">{o.nom}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[12px] text-mute"><code>{o.code}</code> · {TYPES[o.type] ?? o.type}{o.siren ? ` · SIREN ${o.siren}` : ''}</div>
                  <div className="mt-2 flex flex-wrap gap-1">{o.isDefault && <Badge tone="blue">Par défaut</Badge>}{o.id === org?.id && <Badge tone="ok">Affichée</Badge>}{o.actif === false && <Badge tone="ko">Désactivée</Badge>}</div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="btn-primary !py-1" disabled={o.actif === false} onClick={() => { setOrg(o.id); nav('/'); }}><LogIn className="h-3.5 w-3.5" /> Ouvrir</button>
                <button className="btn-secondary !py-1" onClick={() => setDirsFor(o)}><Waypoints className="h-3.5 w-3.5" /> Directions rattachées</button>
                <button className="btn-secondary !py-1" onClick={() => setAdminsFor(o)}><UserPlus className="h-3.5 w-3.5" /> Administrateurs</button>
                {!o.isDefault && <button className="btn-secondary !py-1" onClick={() => toggle(o)}>{o.actif === false ? 'Réactiver' : 'Désactiver'}</button>}
              </div>
            </section>))}
        </div>)}
      {creating && <CreateForm onClose={() => setCreating(false)} onDone={async (o) => { toast(`Collectivité « ${o.nom} » créée : circuit et instance de séances initialisés`); await refresh(); }} />}
      {dirsFor && <Directions o={dirsFor} onClose={() => setDirsFor(null)} onDone={async () => { toast('Directions rattachées mises à jour'); await refresh(); }} />}
      {adminsFor && <Admins o={adminsFor} onClose={() => setAdminsFor(null)} />}
      {node}
    </div>
  );
}

function CreateForm({ onClose, onDone }: { onClose: () => void; onDone: (o: any) => void }) {
  const [f, setF] = useState({ nom: '', code: '', type: 'commune', siren: '', adresse: '' }); const [manual, setManual] = useState(false);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = (await api.post('/organismes', { code: f.code, nom: f.nom, type: f.type, siren: f.siren || undefined, adresse: f.adresse || undefined })).data; onDone(r); onClose(); } catch (x) { setErr(errMsg(x)); setBusy(false); }
  };
  return (
    <Modal title="Nouvelle collectivité" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4"><ErrorBox msg={err} />
        <Field label="Nom"><input className="input" required autoFocus value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value, code: manual ? f.code : slug(e.target.value) })} placeholder="CCAS d'Ivry-sur-Seine" /></Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Code" hint="Identifiant court (minuscules, chiffres, - et _)"><input className="input" required pattern="[a-z0-9_-]{2,40}" value={f.code} onChange={(e) => { setManual(true); setF({ ...f, code: e.target.value }); }} /></Field>
          <Field label="Type"><select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="SIREN (facultatif)"><input className="input" pattern="[0-9]{9}" value={f.siren} onChange={(e) => setF({ ...f, siren: e.target.value })} /></Field>
          <Field label="Adresse (facultatif)"><input className="input" value={f.adresse} onChange={(e) => setF({ ...f, adresse: e.target.value })} /></Field>
        </div>
        <p className="text-[12px] text-mute">La collectivité est créée avec le circuit de validation standard, les groupes de valideurs et une instance de séances. Le logo, l'identité et les gabarits se règlent ensuite dans Administration de cette collectivité.</p>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />} Créer</button></div>
      </form>
    </Modal>
  );
}

function Directions({ o, onClose, onDone }: { o: any; onClose: () => void; onDone: () => void }) {
  const all = useLoad(async () => (await api.get('/directory/directions')).data.items as any[], []);
  const mine = useLoad(async () => (await api.get(`/organismes/${o.id}/directions`)).data.items as { code: string }[], [o.id]);
  const [sel, setSel] = useState<string[] | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [q, setQ] = useState('');
  const cur = sel ?? mine.data?.map((d) => d.code) ?? [];
  const toggle = (c: string) => setSel(cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api.put(`/organismes/${o.id}/directions`, { directions: cur.map((code) => ({ code, label: all.data?.find((d) => d.code === code)?.label })) }); onDone(); onClose(); } catch (x) { setErr(errMsg(x)); setBusy(false); }
  };
  const shown = (all.data ?? []).filter((d) => !q || `${d.label} ${d.code}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title={`Directions rattachées — ${o.nom}`} onClose={onClose} wide>
      <ErrorBox msg={err} />
      <p className="mb-3 text-[12px] text-mute">Les agents de ces directions accèdent à cette collectivité. Une direction ne peut être rattachée qu'à une seule collectivité (409 sinon).</p>
      <input className="input mb-3" placeholder="Filtrer les directions…" value={q} onChange={(e) => setQ(e.target.value)} />
      {all.loading || mine.loading ? <Loading /> : (
        <ul className="max-h-[50vh] divide-y divide-line overflow-auto rounded border border-line">{shown.map((d) => (
          <li key={d.code}><label className="flex items-center gap-3 px-3 py-2 hover:bg-soft"><input type="checkbox" checked={cur.includes(d.code)} onChange={() => toggle(d.code)} /><span className="flex-1">{d.label}</span><code className="text-[11px] text-mute">{d.code}</code></label></li>))}
          {!shown.length && <li className="px-3 py-4 text-mute">Aucune direction.</li>}</ul>)}
      <div className="mt-4 flex items-center justify-between"><span className="text-[12px] text-mute">{cur.length} direction(s) rattachée(s)</span>
        <div className="flex gap-2"><button className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy || sel === null} onClick={save}>{busy && <Spinner />} Enregistrer</button></div></div>
    </Modal>
  );
}

function Admins({ o, onClose }: { o: any; onClose: () => void }) {
  const roles = useLoad(async () => (await api.get(`/organismes/${o.id}/roles`)).data.items as any[], [o.id]);
  const [u, setU] = useState(''); const [role, setRole] = useState('org_admin'); const [err, setErr] = useState<string | null>(null);
  const add = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    try { await api.post(`/organismes/${o.id}/roles`, { username: u.trim().toLowerCase(), role }); setU(''); roles.reload(); } catch (x) { setErr(errMsg(x)); }
  };
  return (
    <Modal title={`Rôles — ${o.nom}`} onClose={onClose} wide>
      <form onSubmit={add} className="mb-4 grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end"><ErrorBox msg={err} />
        <AgentPicker label="Agent" value={u} onChange={setU} required />
        <Field label="Rôle"><select className="input" value={role} onChange={(e) => setRole(e.target.value)}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <button className="btn-primary" disabled={!u}><UserPlus className="h-4 w-4" /> Attribuer</button>
      </form>
      {roles.loading ? <Loading /> : !roles.data?.length ? <Empty><Building2 className="mx-auto mb-2 h-5 w-5" />Personne n'a de rôle dans cette collectivité.</Empty> : (
        <table className="w-full"><thead><tr><th>Agent</th><th>Rôle</th><th /></tr></thead><tbody>{roles.data.map((r) => (
          <tr key={r.id}><td>@{r.username}</td><td><Badge tone="blue">{ROLES[r.role] ?? r.role}</Badge></td>
            <td className="text-right"><button className="text-ko" aria-label="Retirer" onClick={async () => { try { await api.delete(`/organismes/${o.id}/roles/${r.id}`); roles.reload(); } catch (x) { setErr(errMsg(x)); } }}><Trash2 className="h-4 w-4" /></button></td></tr>))}</tbody></table>)}
    </Modal>
  );
}
