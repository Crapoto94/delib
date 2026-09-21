import { useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { Badge, Empty, Field, Loading, Modal, PageTitle, Spinner, useLoad, useToast } from '../ui';
import { Select } from '../Select';

const SOURCE: Record<string, { label: string; tone: 'gray' | 'blue' | 'warn' }> = {
  hub: { label: 'Hub DSI', tone: 'gray' }, local: { label: 'Ajout local', tone: 'blue' }, mixte: { label: 'Corrigé', tone: 'warn' },
};

type Form = { type: 'direction' | 'service'; code: string; label: string; parentCode: string };
/** Surcharge à poser : renommer ou masquer une direction/service (même une entité du Hub, via une surcharge locale). */
type Surcharge = { type: 'direction' | 'service'; code: string; label: string; parentCode?: string; actif: boolean };

/** Organisation : organigramme du Hub DSI (directions + services), complété, renommé ou masqué localement. */
export default function AdminOrganisation() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const d = useLoad(async () => (await api.get(orgPath(o, '/organigramme'))).data, [o]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [rename, setRename] = useState<Surcharge | null>(null);
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok); d.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  const maj = async () => { setBusy(true); try { await api.post(orgPath(o, '/organigramme/rafraichir')); toast('Organigramme mis à jour depuis le Hub DSI'); d.reload(); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); } };
  const save = async () => { if (!form) return; try { await api.post(orgPath(o, '/organigramme/entites'), { type: form.type, code: form.code, label: form.label, parentCode: form.type === 'service' ? form.parentCode : undefined }); toast('Enregistré'); setForm(null); d.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  /** Pose une surcharge : renomme (label) ou masque / réaffiche (actif). */
  const poser = (s: Surcharge, ok: string) => act(() => api.post(orgPath(o, '/organigramme/entites'), { type: s.type, code: s.code, label: s.label, parentCode: s.type === 'service' ? s.parentCode : undefined, actif: s.actif }), ok);
  const saveRename = async () => { if (!rename) return; try { await api.post(orgPath(o, '/organigramme/entites'), { type: rename.type, code: rename.code, label: rename.label, parentCode: rename.type === 'service' ? rename.parentCode : undefined, actif: rename.actif }); toast('Enregistré'); setRename(null); d.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  if (d.loading || !d.data) return <Loading />;
  const r = d.data.resume; const dirs = d.data.items as any[];

  const actionsDir = (dir: any) => (
    <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button className="rounded p-1 hover:bg-slate-100" aria-label="Renommer" title="Renommer" onClick={() => setRename({ type: 'direction', code: dir.code, label: dir.label, actif: dir.actif })}><Pencil className="h-3.5 w-3.5" /></button>
      <button className="rounded p-1 hover:bg-slate-100" aria-label={dir.actif ? 'Masquer' : 'Afficher'} title={dir.actif ? 'Ne plus afficher' : 'Afficher'} onClick={() => poser({ type: 'direction', code: dir.code, label: dir.label, actif: !dir.actif }, dir.actif ? 'Direction masquée' : 'Direction affichée')}>{dir.actif ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>
      {dir.id && <button className="rounded p-1 text-ko hover:bg-ko-bg" aria-label="Retirer la surcharge" title="Revenir à l'organigramme du Hub" onClick={() => act(() => api.delete(orgPath(o, `/organigramme/entites/${dir.id}`)), 'Surcharge retirée')}><Trash2 className="h-3.5 w-3.5" /></button>}
    </span>
  );
  const actionsService = (dir: any, sv: any) => (
    <span className="flex items-center gap-1">
      <button className="rounded p-1 hover:bg-slate-100" aria-label="Renommer" title="Renommer" onClick={() => setRename({ type: 'service', code: sv.code, label: sv.label, parentCode: dir.code, actif: sv.actif })}><Pencil className="h-3.5 w-3.5" /></button>
      <button className="rounded p-1 hover:bg-slate-100" aria-label={sv.actif ? 'Masquer' : 'Afficher'} title={sv.actif ? 'Ne plus afficher' : 'Afficher'} onClick={() => poser({ type: 'service', code: sv.code, label: sv.label, parentCode: dir.code, actif: !sv.actif }, sv.actif ? 'Service masqué' : 'Service affiché')}>{sv.actif ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>
      {sv.id && <button className="rounded p-1 text-ko hover:bg-ko-bg" aria-label="Retirer la surcharge" title="Revenir à l'organigramme du Hub" onClick={() => act(() => api.delete(orgPath(o, `/organigramme/entites/${sv.id}`)), 'Surcharge retirée')}><Trash2 className="h-3.5 w-3.5" /></button>}
    </span>
  );

  return (
    <div className="space-y-5">
      <PageTitle title="Organisation" sub="Directions et services (organigramme du Hub DSI), complétés, renommés ou masqués localement." actions={
        <button className="btn-secondary" disabled={busy} onClick={maj}>{busy ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Mettre à jour depuis le Hub DSI</button>} />
      <div className="flex flex-wrap gap-2"><Badge>{r.directions} directions</Badge><Badge>{r.services} services</Badge>{r.locales > 0 && <Badge tone="blue">{r.locales} surcharge(s) locale(s)</Badge>}{r.masquees > 0 && <Badge tone="warn">{r.masquees} masquée(s)</Badge>}</div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => setForm({ type: 'direction', code: '', label: '', parentCode: '' })}><Plus className="h-4 w-4" /> Ajouter une direction</button>
        <button className="btn-secondary" disabled={!dirs.length} onClick={() => setForm({ type: 'service', code: '', label: '', parentCode: dirs[0]?.code || '' })}><Plus className="h-4 w-4" /> Ajouter un service</button>
      </div>
      {!dirs.length ? <Empty>Aucune direction dans l'organigramme.</Empty> : <div className="space-y-3">{dirs.map((dir) => {
        const isOpen = open.has(dir.code);
        const src = SOURCE[dir.source] ?? SOURCE.hub;
        return (
          <section key={dir.code} className={`card overflow-hidden ${dir.actif ? '' : 'opacity-60'}`}>
            <div className="flex w-full flex-wrap items-center gap-2 px-4 py-3">
              <button className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(dir.code)) n.delete(dir.code); else n.add(dir.code); return n; })} aria-expanded={isOpen}>
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}<b className="text-[14px]">{dir.label}</b>
                <span className="font-mono text-[11px] text-mute">{dir.code}</span>
                <Badge tone={src.tone}>{src.label}</Badge>{!dir.actif && <Badge tone="warn">Masquée</Badge>}
              </button>
              {actionsDir(dir)}
              <span className="text-[12px] text-mute">{dir.services.length} service(s)</span>
            </div>
            {isOpen && dir.services.length > 0 && <ul className="divide-y divide-line border-t border-line">{dir.services.map((sv: any) => {
              const ss = SOURCE[sv.source] ?? SOURCE.hub;
              return (
                <li key={sv.code} className={`flex flex-wrap items-center gap-2 px-4 py-2 text-[13px] ${sv.actif ? '' : 'opacity-60'}`}>
                  <span className="flex-1">{sv.label} <span className="font-mono text-[11px] text-mute">{sv.code}</span></span>
                  <Badge tone={ss.tone}>{ss.label}</Badge>{!sv.actif && <Badge tone="warn">Masqué</Badge>}
                  {actionsService(dir, sv)}
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

      {rename && <Modal title={rename.type === 'direction' ? 'Renommer la direction' : 'Renommer le service'} onClose={() => setRename(null)}>
        <div className="space-y-4">
          <Field label="Libellé" hint={`Code « ${rename.code} » — le libellé du Hub DSI est remplacé localement.`}><input className="input" autoFocus value={rename.label} onChange={(e) => setRename({ ...rename, label: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setRename(null)}>Annuler</button><button className="btn-primary" disabled={!rename.label.trim()} onClick={saveRename}>Enregistrer</button></div>
        </div>
      </Modal>}
      {node}
    </div>
  );
}
