import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2, UserCheck, UserX, Wand2 } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import AgentPicker from '../AgentPicker';
import { AgentName, AgentNames } from '../AgentName';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, Spinner, useLoad, useToast } from '../ui';

type Role = { fonction: string; statut: 'personne' | 'vacant' | 'implicite' | 'direct_dgs' | 'non_defini' | 'non_renseigne'; holders: string[]; via: string | null; poste: string | null; titulaires: { id: number; username: string | null; suppleant: string | null; vacant: boolean }[]; rh: { responsable: string | null; poste: string | null; vacant: boolean } | null };
const LABEL: Record<string, string> = { directeur: 'Directeur', chef_service: 'Chef de service', dga: 'DGA', dgs: 'DGS' };

/**
 * Organisation des responsables (D66 à D70) : on part de l'organisation — DGS, postes de DGA, directions, services — et on voit,
 * rôle par rôle, qui valide. Un rôle est tenu par quelqu'un, VACANT (le circuit le contourne), implicite, ou À RENSEIGNER (le circuit serait bloqué).
 */
export default function Organisation() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const v = useLoad(async () => (await api.get(orgPath(o, '/organisation'))).data, [o]);
  const [q, setQ] = useState(''); const [seulementManques, setSeulementManques] = useState(false); const [open, setOpen] = useState<Set<string>>(new Set());
  const [designer, setDesigner] = useState<null | { fonction: string; directionCode: string; serviceCode?: string; titre: string }>(null);
  const [poste, setPoste] = useState<null | { id?: number; libelle: string; username: string; suppleant: string; vacant: boolean }>(null);
  const reload = () => v.reload();
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok); reload(); } catch (e) { toast(errMsg(e), 'ko'); } };

  const dirs = useMemo(() => (v.data?.directions ?? []).filter((d: any) => (!q || d.label.toLowerCase().includes(q.toLowerCase())) && (!seulementManques || d.manques > 0 || !d.rattachement)), [v.data, q, seulementManques]);
  if (v.loading || !v.data) return <Loading />;
  const d = v.data; const r = d.resume;

  const RoleLine = ({ role, directionCode, serviceCode, titre }: { role: Role; directionCode: string; serviceCode?: string; titre: string }) => {
    const fonction = role.fonction; const manuel = role.titulaires;
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-line/60 px-4 py-2 text-[13px]">
        <span className="w-44 shrink-0 font-semibold">{titre}</span>
        <span className="flex min-w-[220px] flex-1 flex-wrap items-center gap-2">
          {role.statut === 'personne' && <span><AgentNames list={role.holders.slice(0, 1)} />{role.holders[1] && <span className="text-mute"> (suppl. <AgentName u={role.holders[1]} />)</span>}{role.poste && <span className="text-[11px] text-mute"> · {role.poste}</span>}</span>}
          {role.statut === 'implicite' && <span><Badge tone="blue">Le directeur</Badge> <span className="text-mute">service de même nom que la direction : </span><AgentNames list={role.holders.slice(0, 1)} /></span>}
          {role.statut === 'vacant' && <span><Badge tone="warn">Vacant</Badge> <span className="text-[12px] text-mute">{role.via === 'rh' ? 'vacant d’après les RH' : 'déclaré vacant'} — l’étape est contournée</span></span>}
          {role.statut === 'direct_dgs' && <Badge tone="blue">Directement rattachée à la DGS — pas de DGA</Badge>}
          {role.statut === 'non_defini' && <Badge tone="ko">Rattachement à définir</Badge>}
          {role.statut === 'non_renseigne' && <span><Badge tone="ko">À renseigner</Badge> <span className="text-[12px] text-ko">le circuit serait bloqué</span></span>}
          {role.rh?.responsable && role.statut !== 'personne' && role.statut !== 'implicite' && !role.rh.vacant && (
            <span className="rounded bg-soft px-2 py-0.5 text-[12px]">RH : <b>{role.rh.responsable}</b>{role.rh.poste ? ` — ${role.rh.poste.toLowerCase()}` : ''}
              {fonction !== 'dga' && <button className="ml-2 font-semibold text-action" onClick={() => act(() => api.post(orgPath(o, '/organisation/adopter'), { fonction, directionCode, serviceCode }), 'Responsable désigné')}>Désigner</button>}</span>)}
        </span>
        {fonction !== 'dga' && fonction !== 'dgs' && (
          <span className="flex shrink-0 items-center gap-1">
            {role.statut !== 'implicite' && <button className="btn-secondary !py-0.5 !text-[12px]" onClick={() => setDesigner({ fonction, directionCode, serviceCode, titre })}><UserCheck className="h-3.5 w-3.5" /> Désigner…</button>}
            {role.statut !== 'implicite' && !manuel.some((x) => x.vacant) && <button className="btn-secondary !py-0.5 !text-[12px]" onClick={() => act(() => api.post(orgPath(o, '/titulaires'), { fonction, vacant: true, directionCode, serviceCode }), 'Poste déclaré vacant')}><UserX className="h-3.5 w-3.5" /> Vacant</button>}
            {manuel.map((x) => <button key={x.id} className="rounded p-1 text-ko hover:bg-ko-bg" title={x.vacant ? 'Retirer la déclaration de vacance' : `Retirer ${x.username}`} aria-label="Retirer" onClick={() => act(() => api.delete(orgPath(o, `/titulaires/${x.id}`)), 'Titulaire retiré')}><Trash2 className="h-3.5 w-3.5" /></button>)}
          </span>)}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <p className="max-w-4xl text-mute">On part de l'<b>organisation</b> : pour chaque rôle de validation, l'outil vérifie qu'il y a quelqu'un, ou que le poste est déclaré <b>vacant</b> (l'étape est alors contournée et signalée dans le circuit). Un <b>DGA encadre plusieurs directions</b> et répond toujours à la DGS ; une direction peut aussi être rattachée directement à la DGS. Un service qui porte le nom de sa direction a pour responsable le directeur.</p>
      <div className="flex flex-wrap gap-2" role="status">
        <Badge tone={r.manques ? 'ko' : 'ok'}>{r.manques} poste(s) à renseigner</Badge><Badge tone={r.vacants ? 'warn' : undefined}>{r.vacants} vacant(s)</Badge>
        <Badge tone={r.sansRattachement ? 'ko' : 'ok'}>{r.sansRattachement} direction(s) sans rattachement</Badge><Badge>{r.directions} directions · {r.services} services</Badge>
      </div>

      <section className="card overflow-hidden"><h3 className="px-4 py-3">Direction générale</h3>
        <RoleLine role={d.dgs} directionCode="" titre="DGS" />
        <div className="border-t border-line px-4 py-3">
          <div className="mb-2 flex items-center justify-between"><h4>Postes de DGA <span className="text-[12px] font-normal text-mute">— chacun encadre plusieurs directions et répond à la DGS</span></h4>
            <button className="btn-secondary !py-1" onClick={() => setPoste({ libelle: '', username: '', suppleant: '', vacant: false })}><Plus className="h-3.5 w-3.5" /> Nouveau poste de DGA</button></div>
          {!d.postesDga.length ? <p className="text-mute">Aucun poste de DGA : toutes les directions relèvent directement de la DGS, ou du DGA défini dans la saisie avancée.</p> : (
            <ul className="divide-y divide-line rounded border border-line">{d.postesDga.map((p: any) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <b className="w-44 shrink-0">{p.libelle}</b>
                <span className="w-56 shrink-0">{p.vacant ? <Badge tone="warn">Vacant</Badge> : <><AgentName u={p.username} />{p.suppleant && <span className="text-mute"> (suppl. <AgentName u={p.suppleant} />)</span>}</>}</span>
                <span className="flex flex-1 flex-wrap gap-1">{p.directions.length ? p.directions.map((c: string) => <Badge key={c} tone="blue">{d.directions.find((x: any) => x.code === c)?.label ?? c}</Badge>) : <span className="text-[12px] text-mute">aucune direction</span>}</span>
                <button className="rounded p-1 hover:bg-slate-100" aria-label="Modifier" onClick={() => setPoste({ id: p.id, libelle: p.libelle, username: p.username ?? '', suppleant: p.suppleant ?? '', vacant: p.vacant })}><Pencil className="h-4 w-4" /></button>
                <button className="rounded p-1 text-ko hover:bg-ko-bg" aria-label="Supprimer" onClick={() => act(() => api.delete(orgPath(o, `/organisation/postes-dga/${p.id}`)), 'Poste supprimé')}><Trash2 className="h-4 w-4" /></button>
              </li>))}</ul>)}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <input className="input max-w-xs" placeholder="Filtrer les directions…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={seulementManques} onChange={(e) => setSeulementManques(e.target.checked)} /> Seulement ce qui reste à renseigner</label>
        <button className="ml-auto text-[12px] font-semibold text-action" onClick={() => setOpen(open.size ? new Set() : new Set(dirs.map((x: any) => x.code)))}>{open.size ? 'Tout replier' : 'Tout déplier'}</button>
      </div>

      <div className="space-y-3">{dirs.map((dir: any) => {
        const isOpen = open.has(dir.code);
        return (
          <section key={dir.code} className="card overflow-hidden">
            <button className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(dir.code)) n.delete(dir.code); else n.add(dir.code); return n; })} aria-expanded={isOpen}>
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}<b className="text-[14px]">{dir.label}</b>
              {dir.rattachement?.type === 'dga' && <Badge tone="blue">{dir.rattachement.poste}</Badge>}{dir.rattachement?.type === 'dgs' && <Badge tone="blue">DGS</Badge>}{!dir.rattachement && <Badge tone="ko">sans rattachement</Badge>}
              {dir.manques > 0 && <Badge tone="ko">{dir.manques} à renseigner</Badge>}<span className="ml-auto text-[12px] text-mute">{dir.services.length} service(s)</span>
            </button>
            {isOpen && (
              <div>
                <div className="flex flex-wrap items-center gap-2 border-t border-line/60 px-4 py-2 text-[13px]">
                  <span className="w-44 shrink-0 font-semibold">Rattachement (DGA)</span>
                  <select className="input w-auto" aria-label={`Rattachement de ${dir.label}`} value={dir.rattachement ? (dir.rattachement.type === 'dgs' ? 'dgs' : `p${dir.rattachement.posteId}`) : ''}
                    onChange={(e) => { const x = e.target.value; act(() => api.put(orgPath(o, `/organisation/directions/${dir.code}/rattachement`), x === '' ? { rattachement: null } : x === 'dgs' ? { rattachement: 'dgs' } : { rattachement: 'dga', dgaPosteId: Number(x.slice(1)) }), 'Rattachement enregistré'); }}>
                    <option value="">— à définir —</option><option value="dgs">Directement rattachée à la DGS (pas de DGA)</option>{d.postesDga.map((p: any) => <option key={p.id} value={`p${p.id}`}>{p.libelle}{p.vacant ? ' (vacant)' : ''}</option>)}
                  </select>
                  {dir.dga.statut === 'personne' && <span className="text-mute">→ <AgentNames list={dir.dga.holders.slice(0, 1)} /></span>}{dir.dga.statut === 'vacant' && <Badge tone="warn">DGA vacant — étape contournée</Badge>}
                </div>
                <RoleLine role={dir.directeur} directionCode={dir.code} titre="Directeur" />
                {dir.services.map((sv: any) => <RoleLine key={sv.code} role={sv.chef} directionCode={dir.code} serviceCode={sv.code} titre={`Chef — ${sv.label}`} />)}
              </div>)}
          </section>);
      })}{!dirs.length && <Empty>Aucune direction ne correspond.</Empty>}</div>

      {designer && <Designer o={o} cfg={designer} onClose={() => setDesigner(null)} onDone={() => { toast('Titulaire enregistré'); reload(); }} />}
      {poste && <PosteForm o={o} p={poste} onClose={() => setPoste(null)} onDone={() => { toast('Poste de DGA enregistré'); reload(); }} />}
      {node}
    </div>
  );
}

function Designer({ o, cfg, onClose, onDone }: { o: number; cfg: { fonction: string; directionCode: string; serviceCode?: string; titre: string }; onClose: () => void; onDone: () => void }) {
  const [u, setU] = useState(''); const [sup, setSup] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api.post(orgPath(o, '/titulaires'), { fonction: cfg.fonction, username: u.trim().toLowerCase(), suppleant: sup.trim().toLowerCase() || undefined, directionCode: cfg.directionCode, serviceCode: cfg.serviceCode }); onDone(); onClose(); } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <Modal title={`Désigner — ${cfg.titre}`} onClose={onClose}>
      <div className="space-y-4"><ErrorBox msg={err} />
        <AgentPicker label={LABEL[cfg.fonction] ?? cfg.fonction} value={u} onChange={setU} required autoFocus />
        <AgentPicker label="Suppléant (facultatif)" value={sup} onChange={setSup} />
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy || !u} onClick={save}>{busy && <Spinner />} Désigner</button></div></div>
    </Modal>
  );
}

function PosteForm({ o, p, onClose, onDone }: { o: number; p: { id?: number; libelle: string; username: string; suppleant: string; vacant: boolean }; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState(p); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    const body = { libelle: f.libelle, vacant: f.vacant, username: f.vacant ? undefined : f.username.trim().toLowerCase(), suppleant: f.vacant || !f.suppleant ? undefined : f.suppleant.trim().toLowerCase() };
    try { if (f.id) await api.put(orgPath(o, `/organisation/postes-dga/${f.id}`), body); else await api.post(orgPath(o, '/organisation/postes-dga'), body); onDone(); onClose(); } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <Modal title={f.id ? 'Poste de DGA' : 'Nouveau poste de DGA'} onClose={onClose}>
      <div className="space-y-4"><ErrorBox msg={err} />
        <Field label="Libellé du poste"><input className="input" autoFocus value={f.libelle} onChange={(e) => setF({ ...f, libelle: e.target.value })} placeholder="DGA Ressources" /></Field>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.vacant} onChange={(e) => setF({ ...f, vacant: e.target.checked })} /> Poste vacant (l'étape DGA des directions rattachées est contournée)</label>
        {!f.vacant && <><AgentPicker label="DGA" value={f.username} onChange={(u) => setF({ ...f, username: u })} required /><AgentPicker label="Suppléant (facultatif)" value={f.suppleant} onChange={(u) => setF({ ...f, suppleant: u })} /></>}
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy || f.libelle.trim().length < 2 || (!f.vacant && !f.username)} onClick={save}>{busy && <Spinner />} Enregistrer</button></div></div>
    </Modal>
  );
}
