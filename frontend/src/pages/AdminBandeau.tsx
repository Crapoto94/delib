import { useState } from 'react';
import { Pencil, Plus, Siren, Trash2 } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, ErrorBox, Field, Loading, Modal, Spinner, useLoad, useToast } from '../ui';

const ETAT: Record<string, { label: string; tone: 'ok' | 'blue' | 'gray' | 'warn' }> = {
  en_cours: { label: 'Affiché', tone: 'ok' }, programme: { label: 'Programmé', tone: 'blue' }, termine: { label: 'Terminé', tone: 'gray' }, desactive: { label: 'Désactivé', tone: 'warn' },
};
/** ISO → valeur d'un champ datetime-local (heure locale). */
const local = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

function Formulaire({ b, onClose, onSaved }: { b: any | null; onClose: () => void; onSaved: () => void }) {
  const { org } = useAuth(); const o = org!.id;
  const [f, setF] = useState({ message: b?.message ?? '', debut: b ? local(b.debut) : local(new Date().toISOString()), fin: b ? local(b.fin) : local(new Date(Date.now() + 24 * 3600 * 1000).toISOString()), actif: b?.actif ?? true });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const valide = f.message.trim().length >= 3 && f.message.length <= 500 && !!f.debut && !!f.fin && new Date(f.fin) > new Date(f.debut);
  const enregistrer = async () => {
    setBusy(true); setErr(null);
    const corps = { message: f.message.trim(), debut: new Date(f.debut).toISOString(), fin: new Date(f.fin).toISOString(), actif: f.actif };
    try { if (b) await api.put(orgPath(o, `/bandeaux/${b.id}`), corps); else await api.post(orgPath(o, '/bandeaux'), corps); onSaved(); } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <Modal title={b ? 'Modifier le message' : 'Nouveau message'} onClose={onClose}>
      <div className="space-y-3">
        <ErrorBox msg={err} />
        <Field label="Message *" hint={`${f.message.length} / 500 caractères — affiché en défilement, sur une seule ligne.`}>
          <textarea className="input h-24" autoFocus maxLength={500} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder="Ex. Maintenance de l'application ce soir à 20 h : enregistrez votre travail avant 19 h 45." />
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Début de l'affichage *"><input className="input" type="datetime-local" value={f.debut} onChange={(e) => setF({ ...f, debut: e.target.value })} /></Field>
          <Field label="Fin de l'affichage *" hint="Le message disparaît tout seul à cette date."><input className="input" type="datetime-local" min={f.debut} value={f.fin} onChange={(e) => setF({ ...f, fin: e.target.value })} /></Field>
        </div>
        {f.fin && f.debut && new Date(f.fin) <= new Date(f.debut) && <p role="alert" className="text-[12px] text-ko">La fin doit être postérieure au début.</p>}
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.actif} onChange={(e) => setF({ ...f, actif: e.target.checked })} /> Actif (décochez pour le masquer sans le supprimer)</label>
        <div>
          <span className="label">Aperçu</span>
          <div className="mt-1 flex items-stretch overflow-hidden rounded border-b-4 border-[#7f1d1d] bg-[#dc2626] text-white">
            <span className="flex shrink-0 items-center gap-2 bg-[#7f1d1d] px-3 text-[12px] font-extrabold uppercase tracking-widest"><Siren className="h-5 w-5" /> Information</span>
            <span className="min-w-0 truncate px-3 py-2 text-[15px] font-bold">{f.message.trim() || 'Votre message apparaîtra ici…'}</span>
          </div>
        </div>
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy || !valide} onClick={enregistrer}>{busy && <Spinner />} Enregistrer</button></div>
      </div>
    </Modal>
  );
}

/** Bandeau d'information : messages défilants, rouges, affichés à tous (agents et élus) entre deux dates — SCC et administrateurs. */
export default function AdminBandeau() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const d = useLoad(async () => (await api.get(orgPath(o, '/bandeaux'))).data.items as any[], [o]);
  const [edit, setEdit] = useState<any | 'nouveau' | null>(null);
  const agir = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok); d.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  if (d.loading && !d.data) return <Loading />;
  if (!d.data) return <ErrorBox msg={d.error} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-mute">Un message affiché en <b>bandeau rouge défilant</b> en haut de l'écran, pour <b>tous les utilisateurs</b> (agents et élus), entre une date de début et une date de fin : maintenance, panne, consigne importante. Plusieurs messages en même temps défilent à la suite.</p>
        <button className="btn-primary" onClick={() => setEdit('nouveau')}><Plus className="h-4 w-4" /> Nouveau message</button>
      </div>
      <div className="card overflow-x-auto">
        {!d.data.length ? <p className="p-8 text-center text-mute">Aucun message.</p> : (
          <table className="w-full"><thead><tr><th>Message</th><th>Affichage</th><th>État</th><th>Créé par</th><th /></tr></thead><tbody>
            {d.data.map((b) => (
              <tr key={b.id} className={b.etat === 'termine' || b.etat === 'desactive' ? 'opacity-60' : ''}>
                <td className="max-w-md font-semibold">{b.message}</td>
                <td className="whitespace-nowrap text-[12px]">du {dt(b.debut)}<br />au {dt(b.fin)}</td>
                <td><Badge tone={ETAT[b.etat].tone}>{ETAT[b.etat].label}</Badge></td>
                <td className="text-[12px]">{b.creePar}</td>
                <td className="whitespace-nowrap text-right">
                  <button className="rounded p-2 hover:bg-slate-100" title="Modifier" aria-label="Modifier" onClick={() => setEdit(b)}><Pencil className="h-4 w-4" /></button>
                  <button className="rounded p-2 text-ko hover:bg-slate-100" title="Supprimer" aria-label="Supprimer" onClick={() => window.confirm('Supprimer ce message ?') && agir(() => api.delete(orgPath(o, `/bandeaux/${b.id}`)), 'Message supprimé')}><Trash2 className="h-4 w-4" /></button>
                </td>
              </tr>))}
          </tbody></table>)}
      </div>
      {edit && <Formulaire b={edit === 'nouveau' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); d.reload(); toast('Message enregistré'); }} />}
      {node}
    </div>
  );
}
