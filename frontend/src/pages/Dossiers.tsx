import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, GraduationCap, PenLine, Plus } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { SeanceVisee } from '../SeanceVisee';
import { dt, STATUTS } from '../format';
import { Empty, ErrorBox, Field, Loading, Modal, Pagination, PageTitle, Spinner, StatutBadge, TypeBadge, Badge, useLoad } from '../ui';
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

/**
 * Bouton « Nouveau dossier » : la flèche fait partie du bouton et ouvre le choix entre un dossier ordinaire
 * et un dossier assisté (Del-IA guide la rédaction). Remplace le bouton « Dossier assisté » placé à côté.
 */
export function BoutonNouveauDossier({ onNouveau, onAssiste }: { onNouveau: () => void; onAssiste: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const choisir = (fn: () => void) => { setOpen(false); fn(); };
  return (
    <div className="relative flex" ref={ref}>
      <button type="button" data-tour="nouveau-dossier" className="btn-primary rounded-r-none" onClick={() => choisir(onNouveau)}><PenLine className="h-4 w-4" /> Nouveau dossier</button>
      <button type="button" className="btn-primary rounded-l-none border-l border-white/30 !px-2" aria-haspopup="menu" aria-expanded={open} aria-label="Options de création" onClick={() => setOpen(!open)}><ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} /></button>
      {open && (
        <div role="menu" className="card absolute right-0 top-full z-40 mt-1 w-80 p-1 shadow-float">
          <button role="menuitem" type="button" className="flex w-full items-start gap-2 rounded px-3 py-2 text-left hover:bg-soft" onClick={() => choisir(onNouveau)}>
            <PenLine className="mt-0.5 h-4 w-4 shrink-0 text-action" /><span><span className="block text-[13px] font-semibold">Nouveau dossier</span><span className="block text-[12px] text-mute">Un brouillon ordinaire : vous rédigez seul.</span></span>
          </button>
          <button role="menuitem" type="button" className="flex w-full items-start gap-2 rounded px-3 py-2 text-left hover:bg-soft" onClick={() => choisir(onAssiste)}>
            <Mascotte className="mt-0.5 h-4 w-4 shrink-0" humeur="content" /><span><span className="block text-[13px] font-semibold">Nouveau dossier assisté</span><span className="block text-[12px] text-mute">{AVATAR_NOM} vous guide pas à pas dans la rédaction.</span></span>
          </button>
        </div>
      )}
    </div>
  );
}

export function NewDossier({ onClose, assisterParDefaut = false }: { onClose: () => void; assisterParDefaut?: boolean }) {
  const { org, me } = useAuth();
  const nav = useNavigate();
  const types = useLoad(async () => (await api.get(orgPath(org!.id, '/referentiels/type_acte'))).data.items as any[], [org!.id]);
  const [typeId, setTypeId] = useState<number | ''>(''); const [titre, setTitre] = useState('');
  const sel = types.data?.find((x) => x.id === typeId);
  const [serviceLibre, setServiceLibre] = useState('');
  const [mots, setMots] = useState(''); const [props, setProps] = useState<any[]>([]);
  const [assister] = useState(assisterParDefaut);
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
    p.dateSeance ? `Séance du : ${dt(p.dateSeance, { dateStyle: 'long' })}` : (p.annee ? `Année : ${p.annee}` : null),
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
        <details className="rounded border border-line bg-soft p-3 text-[13px]" open>
          <summary className="cursor-pointer font-semibold text-head">Quel type d'acte choisir ?</summary>
          <ul className="mt-2 space-y-2">
            {types.data?.filter((x) => ['deliberation', 'decision', 'arrete'].includes(x.code)).map((x) => (
              <li key={x.code} className="flex gap-2">
                <TypeBadge acte={{ typeCode: x.code, typeLibelle: x.libelle }} pastille={x.meta?.pastille} />
                <span className="min-w-0 text-mute"><b className="text-slate-700">{x.libelle}</b> — {x.meta?.aide}</span>
              </li>))}
          </ul>
          <p className="mt-2 text-[12px] text-mute">Le type conditionne la fin du parcours : une <b>délibération</b> (et un <b>vœu</b>) est inscrite à l'ordre du jour d'un conseil ; une <b>décision</b> et un <b>arrêté</b> sont signés par le maire à la fin du circuit.</p>
        </details>
        {sel && (
          <div className="rounded border border-line p-3 text-[13px]" role="note">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <TypeBadge acte={{ typeCode: sel.code, typeLibelle: sel.libelle }} pastille={sel.meta?.pastille} />
              {sel.meta?.signature && <Badge tone="warn">Signature du maire à la fin</Badge>}
              {sel.meta?.autorisations && <span className="badge bg-violet-bg text-violet border-violet/30">Lier les délibérations d'autorisation</span>}
            </div>
            <p className="text-mute">{sel.meta?.aide}</p>
          </div>
        )}
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
                    <span className="block truncate text-[12px] text-mute">#{p.numeroSuivi}{p.dateSeance ? ` · séance du ${dt(p.dateSeance, { dateStyle: 'short' })}` : p.annee ? ` · ${p.annee}` : ''}{p.numero ? ` · ${p.numero}` : ''}{p.direction ? ` · ${p.direction}` : ''}{p.correspondances ? ` · ${p.correspondances} mot(s)-clé(s)` : ''}</span>
                  </span>
                  <button type="button" className="btn-secondary shrink-0" disabled={busyModele !== null} onClick={() => prendreModele(p)}>{busyModele === p.acteId && <Spinner />} Utiliser comme modèle</button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-mute">Le nouveau dossier reprend tout du modèle (titre, textes, annexes) ; la direction reste la vôtre.</p>
          </div>
        )}
        <Similaires titre={titre} />
        {assister && (
          <p className="flex items-center gap-2 rounded border border-action bg-action/5 p-3 text-[12px] text-mute">
            <Mascotte className="h-6 w-6 shrink-0" humeur="content" /> <span>Dossier assisté — <b>{AVATAR_NOM}</b> vous accompagne pas à pas ; vous pouvez couper l'aide à tout moment.</span>
          </p>
        )}
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
  const scope = sp.get('scope') || scopeParDefaut; const q = sp.get('q') || ''; const statut = sp.get('statut') || ''; const typeId = sp.get('typeId') || '';
  const page = Math.max(1, Number(sp.get('page')) || 1); const LIMIT = 50;
  const types = useLoad(async () => (await api.get(orgPath(org!.id, '/referentiels/type_acte'))).data.items as any[], [org!.id]);
  const list = useLoad(async () => (await api.get(orgPath(org!.id, '/actes'), { params: { scope, q: q || undefined, statut: statut || undefined, typeId: typeId || undefined, limit: LIMIT, offset: (page - 1) * LIMIT } })).data, [org!.id, scope, q, statut, typeId, page]);
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
        <label><span className="label">Type d'acte</span><Select className="input" value={typeId} onChange={(e) => set('typeId', e.target.value)}><option value="">Tous</option>{types.data?.map((t) => <option key={t.id} value={t.id}>{t.libelle}</option>)}</Select></label>
        <label className="grow"><span className="label">Recherche</span><input className="input" value={q} placeholder="Titre ou n° de suivi" onChange={(e) => set('q', e.target.value)} /></label>
      </div>
      <div className="card overflow-x-auto">
        {list.loading ? <Loading /> : list.error ? <div className="p-4"><ErrorBox msg={list.error} /></div> : !list.data?.items.length ? <Empty>Aucun dossier ne correspond.</Empty> : (
          <table className="w-full"><thead><tr><th>N°</th><th>Type</th><th>Titre</th><th>Direction</th><th>Rédacteur</th><th>Séance visée</th><th>Statut</th><th>Modifié</th><th /></tr></thead><tbody>
            {list.data.items.map((a: any) => (
              <tr key={a.id} className="hover:bg-soft">
                <td className="font-mono text-[12px]">#{a.numeroSuivi}</td>
                <td><TypeBadge acte={a} /></td>
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
