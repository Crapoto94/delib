import { useState } from 'react';
import { api, errMsg, org as orgPath } from './api';
import { useAuth } from './auth';
import { useLoad } from './ui';

export const VISIBILITE: Record<string, { label: string; aide: string }> = {
  redacteur: { label: 'Rédacteur uniquement', aide: 'Ses propres actes, ceux dont il est co-rédacteur ou participant.' },
  service: { label: 'Actes de son service', aide: 'Ses propres actes et ceux de son service.' },
  direction: { label: 'Actes de sa direction', aide: 'Ses propres actes et ceux de toute sa direction.' },
};

/** Réglage général de l'organisme : quels actes chacun voit en plus des siens (D72). La hiérarchie, le SCC et les administrateurs gardent leur périmètre. */
export function VisibiliteGenerale({ toast }: { toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const { org } = useAuth(); const o = org!.id;
  const g = useLoad(async () => (await api.get(orgPath(o, '/visibilite-actes'))).data, [o]);
  const [busy, setBusy] = useState(false);
  const set = async (v: string) => { setBusy(true); try { await api.put(orgPath(o, '/visibilite-actes'), { visibilite: v }); toast('Visibilité des actes enregistrée'); g.reload(); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); } };
  return (
    <section className="card p-5"><h3 className="mb-1">Visibilité des actes</h3>
      <p className="mb-3 text-[13px] text-mute">Les actes qu'un agent voit <b>en plus des siens</b>. Réglage général de l'outil, <b>modifiable pour chaque utilisateur</b> (Utilisateurs & rôles). La hiérarchie (directeur, chef de service, DGA), le SCC et les administrateurs gardent leur périmètre.</p>
      <div className="grid gap-2 md:grid-cols-3">{Object.entries(VISIBILITE).map(([k, v]) => (
        <label key={k} className={`flex cursor-pointer items-start gap-3 rounded border p-3 ${g.data?.valeur === k ? 'border-primary bg-primary/5' : 'border-line'}`}>
          <input type="radio" name="visibilite-generale" className="mt-1" disabled={busy || g.loading} checked={g.data?.valeur === k} onChange={() => set(k)} />
          <span><b>{v.label}</b>{g.data?.valeur === k && g.data?.source === 'defaut' && <span className="ml-1 text-[11px] text-mute">(par défaut)</span>}<br /><span className="text-[12px] text-mute">{v.aide}</span></span></label>))}</div>
    </section>
  );
}

/** Réglage d'un utilisateur : suit le réglage général, ou une valeur personnelle. */
export function VisibiliteUtilisateur({ username, data, onChanged, toast }: { username: string; data: { effective: string; override: string | null; general: string }; onChanged: () => void; toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const { org } = useAuth(); const o = org!.id; const [busy, setBusy] = useState(false);
  const set = async (v: string) => { setBusy(true); try { await api.put(orgPath(o, `/utilisateurs/${username}/visibilite-actes`), { visibilite: v === '' ? null : v }); toast('Visibilité enregistrée'); onChanged(); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); } };
  return (
    <section><h3 className="mb-1">Visibilité des actes</h3>
      <select className="input w-auto" aria-label="Visibilité des actes" disabled={busy} value={data.override ?? ''} onChange={(e) => set(e.target.value)}>
        <option value="">Réglage général ({VISIBILITE[data.general]?.label.toLowerCase()})</option>
        {Object.entries(VISIBILITE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      <p className="mt-1 text-[12px] text-mute">{data.override ? 'Réglage personnel : ' : 'Suit le réglage général : '}{VISIBILITE[data.effective]?.aide}</p></section>
  );
}
