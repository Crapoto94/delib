import { useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { Badge, Empty, Field, Loading, Modal, PageTitle, Spinner, useLoad, useToast } from '../ui';
import { Select } from '../Select';

const SOURCE: Record<string, { label: string; tone: 'gray' | 'blue' | 'warn' }> = {
  hub: { label: 'Hub DSI', tone: 'gray' }, local: { label: 'Ajout local', tone: 'blue' }, mixte: { label: 'Corrigé', tone: 'warn' },
};

type Form = { type: 'direction' | 'service'; code: string; label: string; parentCode: string };

/** Organisation : organigramme du Hub DSI (directions + services), complété ou corrigé localement. */
export default function AdminOrganisation() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const d = useLoad(async () => (await api.get(orgPath(o, '/organigramme'))).data, [o]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [edit, setEdit] = useState<null | { id: number; label: string; actif: boolean }>(null);
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok); d.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  const maj = async () => { setBusy(true); try { await api.post(orgPath(o, '/organigramme/rafraichir')); toast('Organigramme mis à jour depuis le Hub DSI'); d.reload(); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); } };
  const save = async () => { if (!form) return; try { await api.post(orgPath(o, '/organigramme/entites'), { type: form.type, code: form.code, label: form.label, parentCode: form.type === 'service' ? form.parentCode : undefined }); toast('Enregistré'); setForm(null); d.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  const saveEdit = async () => { if (!edit) return; try { await api.put(orgPath(o, `/organigramme/entites/${edit.id}`), { label: edit.label, actif: edit.actif }); toast('Enregistré'); setEdit(null); d.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  if (d.loading || !d.data) return <Loading />;
  const r = d.data.resume; const dirs = d.data.items as any[];

  return (
    <div className="space-y-5">
      <PageTitle title="Organisation" sub="Directions et services (organigramme du Hub DSI), complétés ou corrigés localement." actions={
        <button className="btn-secondary" disabled={busy} onClick={maj}>{busy ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Mettre à jour depuis le Hub DSI</button>} />
      <div className="flex flex-wrap gap-2"><Badge>{r.directions} directions</Badge><Badge>{r.services} services</Badge>{r.locales > 0 && <Badge tone="blue">{r.locales} surcharge(s) locale(s)</Badge>}</div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => setForm({ type: 'direction', code: '', label: '', parentCode: '' })}><Plus className="h-4 w-4" /> Ajouter une direction</button>
        <button className="btn-secondary" disabled={!dirs.length} onClick={() => setForm({ type: 'service', code: '', label: '', parentCode: dirs[0]?.code || '' })}><Plus className="h-4 w-4" /> Ajouter un service</button>
      </div>
      {!dirs.length ? <Empty>Aucune direction dans l'organigramme.</Empty> : <div className="space-y-3">{dirs.map((dir) => {
        const isOpen = open.has(dir.code);
        const src = SOURCE[dir.source] ?? SOURCE.hub;
        return (
          <section key={dir.code} className="card overflow-hidden">
            <button className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(dir.code)) n.delete(dir.code); else n.add(dir.code); return n; })} aria-expanded={isOpen}>
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}<b className="text-[14px]">{dir.label}</b>
              <span className="font-mono text-[11px] text-mute">{dir.code}</span>
              <Badge tone={src.tone}>{src.label}</Badge>
              {dir.id && <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <button className="rounded p-1 hover:bg-slate-100" aria-label="Corriger le libellé" onClick={() => setEdit({ id: dir.id, label: dir.label, actif: true })}><Pencil className="h-3.5 w-3.5" /></button>
                <button className="rounded p-1 text-ko hover:bg-ko-bg" aria-label="Retirer la surcharge" onClick={() => act(() => api.delete(orgPath(o, `/organigramme/entites/${dir.id}`)), 'Surcharge retirée')}><Trash2 className="h-3.5 w-3.5" /></button>
              </span>}
              <span className="ml-auto text-[12px] text-mute">{dir.services.length} service(s)</span>
            </button>
            {isOpen && dir.services.length > 0 && <ul className="divide-y divide-line border-t border-line">{dir.services.map((sv: any) => {
              const ss = SOURCE[sv.source] ?? SOURCE.hub;
              return (
                <li key={sv.code} className="flex flex-wrap items-center gap-2 px-4 py-2 text-[13px]">
                  <span className="flex-1">{sv.label} <span className="font-mono text-[11px] text-mute">{sv.code}</span></span>
                  <Badge tone={ss.tone}>{ss.label}</Badge>
                  {sv.id && <span className="flex items-center gap-1">
                    <button className="rounded p-1 hover:bg-slate-100" aria-label="Corriger le libellé" onClick={() => setEdit({ id: sv.id, label: sv.label, actif: true })}><Pencil className="h-3.5 w-3.5" /></button>
                    <button className="rounded p-1 text-ko hover:bg-ko-bg" aria-label="Retirer la surcharge" onClick={() => act(() => api.delete(orgPath(o, `/organigramme/entites/${sv.id}`)), 'Surcharge retirée')}><Trash2 className="h-3.5 w-3.5" /></button>
                  </span>}
                </li>);
            })}</ul>}
          </section>);
      })}</div>}

      {form && <Modal title={form.type === 'direction' ? 'Nouvelle direction' : 'Nouveau service'} onClose={() => setForm(null)}>
        <div className="space-y-4">
          <Field label="Code *" hint="Code court, en capitales (ex. BF, BF1)."><input className="input" autoFocus value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder={form.type === 'direction' ? 'BF' : 'BF1'} /></Field>
          <Field label="Libellé *"><input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Direction des finances" /></Field>
          {form.type === 'service' && <Field label="Direction de rattachement *"><Select className="input" value={form.parentCode} onChange={(e) => setForm({ ...form, parentCode: e.target.value })}>{dirs.map((x: any) => <option key={x.code} value={x.code}>{x.label}</option>)}</Select></Field>}
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setForm(null)}>Annuler</button><button className="btn-primary" disabled={!form.code.trim() || !form.label.trim() || (form.type === 'service' && !form.parentCode)} onClick={save}>Enregistrer</button></div>
        </div>
      </Modal>}

      {edit && <Modal title="Corriger le libellé" onClose={() => setEdit(null)}>
        <div className="space-y-4">
          <Field label="Libellé"><input className="input" autoFocus value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></Field>
          <label className="flex items-center gap-2"><input type="checkbox" checked={edit.actif} onChange={(e) => setEdit({ ...edit, actif: e.target.checked })} /> Actif</label>
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setEdit(null)}>Annuler</button><button className="btn-primary" disabled={!edit.label.trim()} onClick={saveEdit}>Enregistrer</button></div>
        </div>
      </Modal>}
      {node}
    </div>
  );
}
