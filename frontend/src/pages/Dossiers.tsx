import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { GraduationCap, Plus } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { SeanceVisee } from '../SeanceVisee';
import { dt, STATUTS } from '../format';
import { Empty, ErrorBox, Field, Loading, Modal, Pagination, PageTitle, Spinner, StatutBadge, useLoad } from '../ui';
import { AgentName } from '../AgentName';
import { Select } from '../Select';
import { AVATAR_NOM, Mascotte } from '../DossierAssiste';

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
      <ul className="mt-1 list-disc pl-5">{items.map((a) => <li key={a.acteId}><Link className="font-semibold text-head hover:underline" to={`/dossiers/${a.acteId}`} target="_blank">{a.titre}</Link> <span className="text-mute">#{a.numeroSuivi}{a.numero ? ` · ${a.numero}` : ''}</span></li>)}</ul>
    </div>
  );
}

export function NewDossier({ onClose, assisterParDefaut = false }: { onClose: () => void; assisterParDefaut?: boolean }) {
  const { org, me } = useAuth();
  const nav = useNavigate();
  const types = useLoad(async () => (await api.get(orgPath(org!.id, '/referentiels/type_acte'))).data.items as any[], [org!.id]);
  const [typeId, setTypeId] = useState<number | ''>(''); const [titre, setTitre] = useState('');
  const [serviceLibre, setServiceLibre] = useState('');
  const [mots, setMots] = useState(''); const [props, setProps] = useState<any[]>([]);
  const [assister, setAssister] = useState(assisterParDefaut);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [busyModele, setBusyModele] = useState<number | null>(null);
  useEffect(() => { if (types.data?.length && !typeId) setTypeId(types.data[0].id); }, [types.data]);
  const cles = mots.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
  useEffect(() => {
    if (cles.join(' ').length < 2) { setProps([]); return; }
    const t = setTimeout(() => { api.get(orgPath(org!.id, '/recherche/propositions'), { params: { mots: cles.join(',') } }).then((r) => setProps(r.data.items || [])).catch(() => setProps([])); }, 450);
    return () => clearTimeout(t);
  }, [mots]); // eslint-disable-line react-hooks/exhaustive-deps
  const prendreModele = async (p: any) => {
    setBusyModele(p.acteId); setErr(null);
    try {
      const body: any = { modeleId: p.acteId, ...(typeId ? { typeId } : {}), ...(titre.trim().length >= 3 ? { titre: titre.trim() } : {}), ...(serviceLibre.trim() ? { serviceLabel: serviceLibre.trim() } : {}), ...(cles.length ? { motsCles: cles } : {}) };
      const r = await api.post(orgPath(org!.id, '/actes/depuis-modele'), body); nav(`/dossiers/${r.data.id}`);
    } catch (x) { setErr(errMsg(x)); setBusyModele(null); }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const custom = { ...(assister ? { assiste: { actif: true } } : {}), ...(cles.length ? { motsCles: cles } : {}) };
    try { const r = await api.post(orgPath(org!.id, '/actes'), { typeId, titre, ...(serviceLibre.trim() ? { serviceLabel: serviceLibre.trim() } : {}), ...(Object.keys(custom).length ? { custom } : {}) }); nav(`/dossiers/${r.data.id}`); } catch (x) { setErr(errMsg(x)); setBusy(false); }
  };
  const infos = (p: any) => [
    p.numero ? `N° délibération : ${p.numero}` : null,
    p.annee ? `Année : ${p.annee}` : null,
    p.direction ? `Direction : ${p.direction}` : null,
    p.matiere ? `Matière : ${p.matiere}` : null,
    p.statut ? `Statut : ${String(p.statut).replace(/_/g, ' ')}` : null,
    p.motsCles?.length ? `Mots-clés : ${p.motsCles.join(', ')}` : null,
  ].filter(Boolean).join('\n');
  return (
    <Modal title="Nouveau dossier" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox msg={err} />
        <Field label="Type d'acte"><Select className="input" value={typeId} onChange={(e) => setTypeId(Number(e.target.value))}>{types.data?.map((t) => <option key={t.id} value={t.id}>{t.libelle}</option>)}</Select></Field>
        <Field label="Titre explicite de l'acte" hint="Ce titre apparaîtra sur l'ordre du jour officiel."><input className="input" autoFocus required minLength={3} value={titre} onChange={(e) => setTitre(e.target.value)} /></Field>
        <Field label="Mots-clés" hint="Séparez par des virgules (ex. subvention, association). Les acronymes sont reconnus (RIFSEEP trouve R.I.F.S.E.E.P). Ils mémorisent le dossier et proposent des délibérations passées."><input className="input" value={mots} onChange={(e) => setMots(e.target.value)} placeholder="rifseep, subvention, association" /></Field>
        {props.length > 0 && (
          <div className="rounded border border-action/40 bg-action/5 p-3 text-[13px]" role="note">
            <b>Délibérations passées correspondant à vos mots-clés</b> — reprenez-en une comme modèle :
            <ul className="mt-1 space-y-1">
              {props.map((p) => (
                <li key={p.acteId} className="flex items-center justify-between gap-2" title={infos(p)}>
                  <span className="min-w-0 cursor-help">
                    <span className="block truncate font-semibold text-head">{p.titre}</span>
                    <span className="block truncate text-[12px] text-mute">#{p.numeroSuivi}{p.annee ? ` · ${p.annee}` : ''}{p.numero ? ` · ${p.numero}` : ''}{p.direction ? ` · ${p.direction}` : ''}{p.correspondances ? ` · ${p.correspondances} mot(s)-clé(s)` : ''}</span>
                  </span>
                  <button type="button" className="btn-secondary shrink-0" disabled={busyModele !== null} onClick={() => prendreModele(p)}>{busyModele === p.acteId && <Spinner />} Utiliser comme modèle</button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-mute">Le nouveau dossier reprend tout du modèle (titre, textes, annexes) ; la direction reste la vôtre.</p>
          </div>
        )}
        <Similaires titre={titre} />
        <label className={`flex cursor-pointer items-start gap-3 rounded border p-3 ${assister ? 'border-action bg-action/5' : 'border-line'}`}>
          <input type="checkbox" className="mt-1" checked={assister} onChange={(e) => setAssister(e.target.checked)} />
          <Mascotte className="h-8 w-8 shrink-0" humeur={assister ? 'content' : 'neutre'} />
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold">Créer en dossier assisté</span>
            <span className="block text-[12px] text-mute">{AVATAR_NOM} vous accompagne pas à pas : à chaque étape, il vous dit quoi faire et vous donne des conseils. Vous pouvez couper l'aide à tout moment.</span>
          </span>
        </label>
        <p className="text-[12px] text-mute">Direction porteuse : <b>{me?.agent?.direction?.label ?? 'à préciser'}</b> (déduite de votre fiche RH).</p>
        <Field label="Service / bureau ou chargé de mission" hint="Facultatif. Précise le service porteur si la direction seule ne suffit pas. Ex. « chargé de mission subventions ».">
          <input className="input" value={serviceLibre} onChange={(e) => setServiceLibre(e.target.value)} maxLength={120} placeholder="chargé de mission…" />
        </Field>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy || !typeId}>{busy && <Spinner />} Créer le brouillon</button></div>
      </form>
    </Modal>
  );
}

/** Liste des dossiers (onglets de portée, filtre de statut, recherche, tableau, pagination). Réutilisée par la page unique. */
export function ListeDossiers({ scopeParDefaut = 'mine' }: { scopeParDefaut?: string } = {}) {
  const { org } = useAuth();
  const [sp, setSp] = useSearchParams();
  const scope = sp.get('scope') || scopeParDefaut; const q = sp.get('q') || ''; const statut = sp.get('statut') || '';
  const page = Math.max(1, Number(sp.get('page')) || 1); const LIMIT = 50;
  const list = useLoad(async () => (await api.get(orgPath(org!.id, '/actes'), { params: { scope, q: q || undefined, statut: statut || undefined, limit: LIMIT, offset: (page - 1) * LIMIT } })).data, [org!.id, scope, q, statut, page]);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k !== 'page') n.delete('page'); n.delete('nouveau'); n.delete('assiste'); setSp(n); };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div role="tablist" className="flex rounded bg-surface p-1 shadow-card">
          {[['mine', 'Mes dossiers'], ['following', 'Ceux que je suis'], ['all', 'Tous ceux que je peux voir']].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={scope === k} onClick={() => set('scope', k)} className={`rounded px-3 py-2 text-[13px] font-semibold ${scope === k ? 'bg-primary text-white' : 'text-slate-700'}`}>{l}</button>
          ))}
        </div>
        <label><span className="label">Statut</span><Select className="input" value={statut} onChange={(e) => set('statut', e.target.value)}><option value="">Tous</option>{Object.entries(STATUTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></label>
        <label className="grow"><span className="label">Recherche</span><input className="input" value={q} placeholder="Titre ou n° de suivi" onChange={(e) => set('q', e.target.value)} /></label>
      </div>
      <div className="card overflow-x-auto">
        {list.loading ? <Loading /> : list.error ? <div className="p-4"><ErrorBox msg={list.error} /></div> : !list.data?.items.length ? <Empty>Aucun dossier ne correspond.</Empty> : (
          <table className="w-full"><thead><tr><th>N°</th><th>Titre</th><th>Direction</th><th>Rédacteur</th><th>Séance visée</th><th>Statut</th><th>Modifié</th><th /></tr></thead><tbody>
            {list.data.items.map((a: any) => (
              <tr key={a.id} className="hover:bg-soft">
                <td className="font-mono text-[12px]">#{a.numeroSuivi}</td>
                <td><Link to={`/dossiers/${a.id}`} className="font-semibold text-head hover:underline">{a.titre}</Link>{a.custom?.assiste?.actif && <span title="Dossier assisté" className="ml-1 inline-flex align-middle text-action"><GraduationCap className="h-3.5 w-3.5" aria-label="Dossier assisté" /></span>}</td>
                <td className="text-mute">{a.direction?.label}</td><td><AgentName u={a.redacteur} /></td><td><SeanceVisee acte={a} /></td><td><StatutBadge statut={a.statut} /></td>
                <td className="text-mute">{a.statut === 'archive' ? '—' : dt(a.updatedAt, { dateStyle: 'short' })}</td>
                <td className="text-right"><Link to={`/mes-actes/${a.id}`} className="text-[12px] font-semibold text-action hover:underline">Trajet</Link></td>
              </tr>))}
          </tbody></table>
        )}
      </div>
      {list.data && <Pagination className="mt-2" total={list.data.total} limit={LIMIT} page={page} onPage={(p) => set('page', p > 1 ? String(p) : '')} itemLabel="dossier" />}
    </>
  );
}

export default function Dossiers() {
  const [sp, setSp] = useSearchParams();
  const [creating, setCreating] = useState(sp.get('nouveau') === '1');
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); n.delete('nouveau'); n.delete('assiste'); setSp(n); };
  return (
    <div>
      <PageTitle title="Actes & Dossiers" sub="Retrouvez, rédigez et suivez vos actes." actions={<button data-tour="nouveau-dossier" className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nouveau dossier</button>} />
      <ListeDossiers />
      {creating && <NewDossier assisterParDefaut={sp.get('assiste') === '1'} onClose={() => { setCreating(false); set('nouveau', ''); }} />}
    </div>
  );
}
