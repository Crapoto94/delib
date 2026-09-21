import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, Field, Loading, PageTitle, Spinner, useLoad, useToast } from '../ui';

type Etape = { code: string; label: string; jours: number };

/** Rétroplanning : étapes clés d'une séance, chacune à J-x jours ouvrés de la suivante (la dernière = le conseil). */
export default function AdminRetroplanning() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const d = useLoad(async () => (await api.get(orgPath(o, '/seances/retroplanning'))).data as { etapes: Etape[]; defaut: boolean }, [o]);
  const [etapes, setEtapes] = useState<Etape[] | null>(null);
  const [date, setDate] = useState(''); const [prop, setProp] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (d.data) setEtapes(d.data.etapes.map((e) => ({ ...e }))); }, [d.data]);
  const setE = (i: number, patch: Partial<Etape>) => setEtapes((x) => x!.map((e, k) => (k === i ? { ...e, ...patch } : e)));
  const move = (i: number, dir: number) => setEtapes((x) => { const n = [...x!]; const j = i + dir; if (j < 0 || j >= n.length) return n; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const add = () => setEtapes((x) => [...(x ?? []), { code: `etape${(x?.length ?? 0) + 1}`, label: 'Nouvelle étape', jours: 3 }]);
  const save = async () => { setBusy(true); try { await api.put(orgPath(o, '/settings/seances.retroplanning'), { value: { etapes }, scope: 'organisme' }); toast('Rétroplanning enregistré'); d.reload(); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); } };
  const proposer = async () => { if (!date) return; try { setProp((await api.get(orgPath(o, '/seances/dates-proposees'), { params: { dateSeance: new Date(date).toISOString() } })).data.jalons); } catch (e) { toast(errMsg(e), 'ko'); } };
  if (d.loading || !etapes) return <Loading />;
  return (
    <div className="space-y-5">
      <PageTitle title="Rétroplanning" sub="Étapes clés d'une séance : chacune est à J-x jours ouvrés de la suivante ; la dernière est le jour du conseil." />
      <section className="card p-5">
        <ul className="space-y-2">
          {etapes.map((e, i) => (
            <li key={i} className="grid items-center gap-2 rounded border border-line p-2 md:grid-cols-[1fr_130px_auto]">
              <input className="input" value={e.label} onChange={(ev) => setE(i, { label: ev.target.value })} aria-label="Libellé de l'étape" />
              <div className="flex items-center gap-1"><input className="input" type="number" min={0} max={180} value={e.jours} onChange={(ev) => setE(i, { jours: Number(ev.target.value) })} aria-label="Jours avant l'étape suivante" /><span className="text-[12px] text-mute">j</span></div>
              <div className="flex gap-1">
                <button type="button" className="rounded p-1 hover:bg-slate-100" aria-label="Monter" onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></button>
                <button type="button" className="rounded p-1 hover:bg-slate-100" aria-label="Descendre" onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></button>
                <button type="button" className="rounded p-1 text-ko hover:bg-ko-bg" aria-label="Supprimer" onClick={() => setEtapes((x) => x!.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></button>
              </div>
            </li>))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" className="btn-secondary" onClick={add}><Plus className="h-4 w-4" /> Ajouter une étape</button>
          <button type="button" className="btn-primary ml-auto" disabled={busy} onClick={save}>{busy && <Spinner />} <Save className="h-4 w-4" /> Enregistrer</button></div>
        <p className="mt-2 text-[12px] text-mute">Codes reconnus (alimentent les champs de la séance) : <code>soumissions</code> (date limite de rédaction), <code>dgs</code>, <code>commissions</code>, <code>convocation</code>. Les autres deviennent des jalons complémentaires. {d.data?.defaut && <Badge tone="warn">valeurs par défaut</Badge>}</p>
      </section>
      <section className="card p-5"><h3 className="mb-2">Simuler</h3>
        <div className="flex flex-wrap items-end gap-2"><Field label="Date du conseil"><input className="input !w-auto" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field><button type="button" className="btn-secondary" disabled={!date} onClick={proposer}>Proposer les dates</button></div>
        {prop && <ul className="mt-3 space-y-1 text-[13px]">{prop.map((j, i) => <li key={i} className="flex flex-wrap items-center gap-2"><Badge tone="blue">{j.label}</Badge><span>{dt(j.date, { dateStyle: 'full' })}</span>{j.jours ? <span className="text-mute">J-{j.jours}</span> : null}</li>)}</ul>}
      </section>
      {node}
    </div>
  );
}
