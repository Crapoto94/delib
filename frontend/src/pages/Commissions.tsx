import { FormEvent, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { ReunionsSection } from '../Reunions';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageTitle, useLoad } from '../ui';

function Detail({ id, onClose }: { id: number; onClose: () => void }) {
  const { org, isScc } = useAuth();
  const c = useLoad(async () => (await api.get(orgPath(org!.id, `/commissions/${id}`))).data, [id]);
  const setType = async (t: 'actes' | 'autre') => { await api.put(orgPath(org!.id, `/commissions/${id}`), { type: t }); c.reload(); };
  return (
    <Modal title={c.data?.nom ?? 'Commission'} onClose={onClose} wide>
      {c.loading || !c.data ? <Loading /> : (
        <div className="space-y-4">
          {isScc ? <TypeChoix value={c.data.type ?? 'actes'} onChange={setType} /> : <p><Badge tone={c.data.type === 'autre' ? 'warn' : 'blue'}>{c.data.type === 'autre' ? 'Commission autre (sans lien avec les actes)' : 'Associée à la rédaction des actes'}</Badge></p>}
          {c.data.sieges && <p><Badge tone="blue">{c.data.sieges} sièges</Badge> {c.data.siegesOpposition ? <Badge tone="warn">dont {c.data.siegesOpposition} de l'opposition</Badge> : null}</p>}
          {c.data.thematiques?.length > 0 && <div><h3 className="mb-1">Thématiques</h3><ul className="flex flex-wrap gap-1">{c.data.thematiques.map((t: string) => <li key={t} className="rounded bg-soft px-2 py-0.5 text-[12px]">{t}</li>)}</ul></div>}
          <div><h3 className="mb-1">Membres ({c.data.membres.length})</h3>
            {c.data.membres.length === 0 ? <p className="text-mute">Aucun membre.</p> : <ul className="grid gap-1 md:grid-cols-2">{c.data.membres.map((m: any) => <li key={m.eluId} className="rounded bg-soft px-3 py-2">{m.prenom} {m.nom} {m.fonction !== 'membre' && <Badge tone="blue">{m.fonction.replace('_', '-')}</Badge>} <span className="text-mute">{m.groupe}</span></li>)}</ul>}</div>
          <ReunionsSection commissionId={id} canEdit={isScc} />
          <div><h3 className="mb-1">Secrétaires</h3>{c.data.secretaires.length ? c.data.secretaires.join(', ') : <span className="text-mute">Aucun</span>}</div>
        </div>)}
    </Modal>
  );
}

export default function Commissions() {
  const { org, isScc } = useAuth(); const o = org!.id;
  const list = useLoad(async () => (await api.get(orgPath(o, '/commissions'))).data.items as any[], [o]);
  const [creating, setCreating] = useState(false); const [nom, setNom] = useState(''); const [type, setType] = useState<'actes' | 'autre'>('actes'); const [err, setErr] = useState<string | null>(null); const [open, setOpen] = useState<number | null>(null);
  const create = async (e: FormEvent) => { e.preventDefault(); try { await api.post(orgPath(o, '/commissions'), { nom, type }); setCreating(false); setNom(''); setType('actes'); list.reload(); } catch (x) { setErr(errMsg(x)); } };
  return (
    <div>
      <PageTitle title="Commissions" sub="Une commission est associée à la rédaction des actes (elle rend des avis) ou autre (elle a ses propres dossiers) ; un acte peut aussi être « hors commission »." actions={isScc && <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nouvelle commission</button>} />
      {list.loading ? <Loading /> : !list.data?.length ? <div className="card"><Empty>Aucune commission. Créez-en une pour pouvoir la rattacher aux actes.</Empty></div> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{list.data.map((c) => (
          <button key={c.id} onClick={() => setOpen(c.id)} className="card p-5 text-left hover:shadow-lift"><h3>{c.nom}</h3><p className="mt-1 line-clamp-3 text-mute">{c.description || '—'}</p><p className="mt-3"><Badge tone="blue">{c.nbMembres}{c.sieges ? ` / ${c.sieges}` : ''} membre(s)</Badge> {c.type === 'autre' && <Badge tone="warn">autre (sans lien avec les actes)</Badge>} {!c.actif && <Badge>inactive</Badge>}</p></button>))}</div>)}
      {creating && <Modal title="Nouvelle commission" onClose={() => setCreating(false)}><form onSubmit={create} className="space-y-4"><ErrorBox msg={err} /><Field label="Nom"><input className="input" autoFocus required value={nom} onChange={(e) => setNom(e.target.value)} /></Field><TypeChoix value={type} onChange={setType} /><div className="flex justify-end"><button className="btn-primary">Créer</button></div></form></Modal>}
      {open && <Detail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Type de commission : associée à la rédaction des actes (avis sur les projets) ou autre (dossiers simples, sans lien avec les actes). */
function TypeChoix({ value, onChange }: { value: 'actes' | 'autre'; onChange: (v: 'actes' | 'autre') => void }) {
  const opts = [['actes', 'Associée à la rédaction des actes', 'Elle rend des avis sur les projets d’actes.'], ['autre', 'Autre', 'Sans lien avec la rédaction des actes : ses réunions ont leurs propres dossiers (nom, description, pièces jointes).']] as const;
  return (
    <fieldset className="grid gap-2 md:grid-cols-2"><legend className="mb-1 text-[12px] font-semibold text-slate-600">Type de commission</legend>{opts.map(([k, l, h]) => (
      <label key={k} className={`flex cursor-pointer items-start gap-3 rounded border p-3 ${value === k ? 'border-primary bg-primary/5' : 'border-line'}`}><input type="radio" className="mt-1" checked={value === k} onChange={() => onChange(k)} /><span><b>{l}</b><br /><span className="text-[12px] text-mute">{h}</span></span></label>))}</fieldset>
  );
}
