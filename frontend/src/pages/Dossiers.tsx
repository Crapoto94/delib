import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt, STATUTS } from '../format';
import { Empty, ErrorBox, Field, Loading, Modal, PageTitle, Spinner, StatutBadge, useLoad } from '../ui';
import { AgentName } from '../AgentName';

/** REC-08 : des actes proches existent déjà (dans la limite de mes droits) — consulter avant de rédiger. */
function Similaires({ titre }: { titre: string }) {
  const { org } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    if (titre.trim().length < 10) { setItems([]); return; }
    const t = setTimeout(() => { api.get(orgPath(org!.id, '/recherche/similaires'), { params: { titre: titre.trim() } }).then((r) => setItems(r.data.items || [])).catch(() => setItems([])); }, 500);
    return () => clearTimeout(t);
  }, [titre, org]);
  if (!items.length) return null;
  return (
    <div className="rounded border border-warn/40 bg-warn-bg p-3 text-[13px]" role="note">
      <b>Des actes proches existent déjà</b> — consultez-les avant de rédiger (vous pourrez vous en inspirer) :
      <ul className="mt-1 list-disc pl-5">{items.map((a) => <li key={a.acteId}><Link className="font-semibold text-primary hover:underline" to={`/dossiers/${a.acteId}`} target="_blank">{a.titre}</Link> <span className="text-mute">#{a.numeroSuivi}{a.numero ? ` · ${a.numero}` : ''}</span></li>)}</ul>
    </div>
  );
}

function NewDossier({ onClose }: { onClose: () => void }) {
  const { org, me } = useAuth();
  const nav = useNavigate();
  const types = useLoad(async () => (await api.get(orgPath(org!.id, '/referentiels/type_acte'))).data.items as any[], [org!.id]);
  const [typeId, setTypeId] = useState<number | ''>(''); const [titre, setTitre] = useState('');
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (types.data?.length && !typeId) setTypeId(types.data[0].id); }, [types.data]);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await api.post(orgPath(org!.id, '/actes'), { typeId, titre }); nav(`/dossiers/${r.data.id}`); } catch (x) { setErr(errMsg(x)); setBusy(false); }
  };
  return (
    <Modal title="Nouveau dossier" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox msg={err} />
        <Field label="Type d'acte"><select className="input" value={typeId} onChange={(e) => setTypeId(Number(e.target.value))}>{types.data?.map((t) => <option key={t.id} value={t.id}>{t.libelle}</option>)}</select></Field>
        <Field label="Titre explicite de l'acte" hint="Ce titre apparaîtra sur l'ordre du jour officiel."><input className="input" autoFocus required minLength={3} value={titre} onChange={(e) => setTitre(e.target.value)} /></Field>
        <Similaires titre={titre} />
        <p className="text-[12px] text-mute">Direction porteuse : <b>{me?.agent?.direction?.label ?? 'à préciser'}</b> (déduite de votre fiche RH).</p>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy || !typeId}>{busy && <Spinner />} Créer le brouillon</button></div>
      </form>
    </Modal>
  );
}

export default function Dossiers() {
  const { org } = useAuth();
  const [sp, setSp] = useSearchParams();
  const scope = sp.get('scope') || 'mine'; const q = sp.get('q') || ''; const statut = sp.get('statut') || '';
  const [creating, setCreating] = useState(sp.get('nouveau') === '1');
  const list = useLoad(async () => (await api.get(orgPath(org!.id, '/actes'), { params: { scope, q: q || undefined, statut: statut || undefined, limit: 100 } })).data, [org!.id, scope, q, statut]);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); n.delete('nouveau'); setSp(n); };

  return (
    <div>
      <PageTitle title="Actes & Dossiers" sub="Retrouvez, rédigez et suivez vos actes." actions={<button className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nouveau dossier</button>} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div role="tablist" className="flex rounded bg-white p-1 shadow-card">
          {[['mine', 'Mes dossiers'], ['following', 'Ceux que je suis'], ['all', 'Tous ceux que je peux voir']].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={scope === k} onClick={() => set('scope', k)} className={`rounded px-3 py-2 text-[13px] font-semibold ${scope === k ? 'bg-primary text-white' : 'text-slate-700'}`}>{l}</button>
          ))}
        </div>
        <label><span className="label">Statut</span><select className="input" value={statut} onChange={(e) => set('statut', e.target.value)}><option value="">Tous</option>{Object.entries(STATUTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label className="grow"><span className="label">Recherche</span><input className="input" value={q} placeholder="Titre ou n° de suivi" onChange={(e) => set('q', e.target.value)} /></label>
      </div>
      <div className="card overflow-x-auto">
        {list.loading ? <Loading /> : list.error ? <div className="p-4"><ErrorBox msg={list.error} /></div> : !list.data?.items.length ? <Empty>Aucun dossier ne correspond.</Empty> : (
          <table className="w-full"><thead><tr><th>N°</th><th>Titre</th><th>Direction</th><th>Rédacteur</th><th>Statut</th><th>Modifié</th></tr></thead><tbody>
            {list.data.items.map((a: any) => (
              <tr key={a.id} className="hover:bg-soft">
                <td className="font-mono text-[12px]">#{a.numeroSuivi}</td>
                <td><Link to={`/dossiers/${a.id}`} className="font-semibold text-primary hover:underline">{a.titre}</Link></td>
                <td className="text-mute">{a.direction?.label}</td><td><AgentName u={a.redacteur} /></td><td><StatutBadge statut={a.statut} /></td><td className="text-mute">{dt(a.updatedAt, { dateStyle: 'short' })}</td>
              </tr>))}
          </tbody></table>
        )}
      </div>
      {list.data && <p className="mt-2 text-[12px] text-mute">{list.data.total} dossier(s)</p>}
      {creating && <NewDossier onClose={() => { setCreating(false); set('nouveau', ''); }} />}
    </div>
  );
}
