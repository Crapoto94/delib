import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Eye, Printer } from 'lucide-react';
import { api, errMsg, openPdf, org as orgPath } from './api';
import { useAuth } from './auth';
import { dt } from './format';
import { Badge, Field, Loading, Modal, Spinner } from './ui';
import { Progress } from './AiStatus';
import { Select } from './Select';

type Build = {
  id: number; version: number; libelle: string; profil: string; options: { rectoVerso?: boolean; anomalies?: string }; statut: 'queued' | 'running' | 'done' | 'error';
  etape: string | null; progression: number; total: number; pages: number | null; anomalies: { message: string; gravite: string }[]; filigrane: boolean; erreur: string | null;
  creePar: string; imprimeLe: string | null; depuisImprime?: { ajoutes: string[]; retires: string[]; modifies: string[] }; referenceImprimee?: number;
};
const PROFILS: Record<string, string> = { scc: 'Secrétariat (complet)', presidence: 'Présidence', elus: 'Élus (annexes communicables)', public: 'Public (annexes communicables)' };
const POLITIQUES: Record<string, string> = { avertir: 'Avertir et générer quand même', exclure: 'Exclure les dossiers en anomalie', bloquer: 'Refuser la génération' };

/** Cahier de séance (D11) : génération en arrière plan, versions numérotées, ouverture dans la visionneuse PDF, marquage « imprimé ». */
export default function CahierModal({ seanceId, onClose }: { seanceId: number; onClose: () => void }) {
  const { org } = useAuth(); const o = org!.id; const root = orgPath(o, `/seances/${seanceId}/cahier`);
  const [builds, setBuilds] = useState<Build[] | null>(null); const [controles, setControles] = useState<{ message: string; gravite: string }[]>([]);
  const [f, setF] = useState({ profil: 'scc', rectoVerso: false, anomalies: 'avertir' }); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setBuilds((await api.get(`${root}/builds`)).data.items); } catch (e) { setErr(errMsg(e)); setBuilds([]); }
  }, [root]);
  useEffect(() => { load(); api.get(`${root}/controles`).then((r) => setControles(r.data.items)).catch(() => {}); }, [load, root]);
  const running = builds?.some((b) => b.statut === 'queued' || b.statut === 'running');
  useEffect(() => { if (!running) return; const t = setInterval(load, 2000); return () => clearInterval(t); }, [running, load]);

  const generate = async () => {
    setBusy(true); setErr(null);
    try { await api.post(root, f); await load(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const open = async (b: Build) => { const m = await openPdf(() => api.get(`${root}/builds/${b.version}/fichier`, { responseType: 'blob' }), `${b.libelle} — ${b.pages} pages`); if (m) setErr(m); };
  const printed = async (b: Build) => { try { await api.post(`${root}/builds/${b.version}/imprime`, {}); await load(); } catch (e) { setErr(errMsg(e)); } };

  return (
    <Modal title="Cahier de séance" onClose={onClose} wide>
      <div className="space-y-5">
        {err && <div role="alert" className="rounded border border-ko/30 bg-ko-bg px-3 py-2 text-ko">{err}</div>}
        <section className="rounded border border-line p-4">
          <h4 className="mb-3 flex items-center gap-2"><BookOpen className="h-4 w-4 text-action" /> Générer une nouvelle version</h4>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Profil"><Select className="input" value={f.profil} onChange={(e) => setF({ ...f, profil: e.target.value })}>{Object.entries(PROFILS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="En cas d'anomalie"><Select className="input" value={f.anomalies} onChange={(e) => setF({ ...f, anomalies: e.target.value })}>{Object.entries(POLITIQUES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          </div>
          <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={f.rectoVerso} onChange={(e) => setF({ ...f, rectoVerso: e.target.checked })} /> Impression recto-verso (chaque point commence sur une page impaire)</label>
          {controles.length > 0 && (
            <div className="mt-3 rounded bg-warn-bg px-3 py-2 text-[12px]"><b className="text-warn">{controles.length} anomalie(s) détectée(s)</b>
              <ul className="mt-1 list-disc pl-5">{controles.slice(0, 8).map((c, i) => <li key={i} className={c.gravite === 'bloquant' ? 'font-semibold text-ko' : ''}>{c.message}</li>)}{controles.length > 8 && <li>… et {controles.length - 8} autre(s)</li>}</ul></div>)}
          <div className="mt-4 flex items-center gap-3"><button className="btn-primary" disabled={busy || !!running} onClick={generate}>{(busy || running) && <Spinner />} Générer le cahier</button>
            <span className="text-[12px] text-mute">La génération se fait en arrière plan ; le filigrane « PROJET » disparaît quand l'ordre du jour est arrêté.</span></div>
        </section>

        <section>
          <h4 className="mb-2">Versions</h4>
          {builds === null ? <Loading /> : !builds.length ? <p className="text-mute">Aucune version générée.</p> : (
            <ul className="divide-y divide-line rounded border border-line">{builds.map((b) => (
              <li key={b.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{b.libelle}</b>
                  <Badge tone={b.statut === 'done' ? 'ok' : b.statut === 'error' ? 'ko' : 'blue'}>{b.statut === 'done' ? `${b.pages} pages` : b.statut === 'error' ? 'échec' : b.statut === 'queued' ? 'en attente' : 'en cours'}</Badge>
                  <Badge>{PROFILS[b.profil]?.split(' (')[0] ?? b.profil}</Badge>
                  {b.options.rectoVerso && <Badge>recto-verso</Badge>}
                  {b.filigrane && <Badge tone="warn">PROJET</Badge>}
                  {b.imprimeLe && <Badge tone="ok">imprimé le {dt(b.imprimeLe, { dateStyle: 'short' })}</Badge>}
                  <span className="ml-auto flex gap-2">
                    {b.statut === 'done' && <button className="btn-secondary !py-1" onClick={() => open(b)}><Eye className="h-3.5 w-3.5" /> Ouvrir</button>}
                    {b.statut === 'done' && !b.imprimeLe && <button className="btn-secondary !py-1" onClick={() => printed(b)}><Printer className="h-3.5 w-3.5" /> Marquer imprimé</button>}
                  </span>
                </div>
                {(b.statut === 'running' || b.statut === 'queued') && <div className="mt-2"><div className="text-[12px] text-mute">{b.etape ?? 'En attente…'}</div><Progress job={{ status: b.statut === 'queued' ? 'queued' : 'running', progress: b.progression, total: b.total } as any} /></div>}
                {b.erreur && <p className="mt-1 text-[12px] text-ko">{b.erreur}</p>}
                {b.anomalies.length > 0 && b.statut === 'done' && <p className="mt-1 text-[12px] text-warn">{b.anomalies.length} anomalie(s) au moment de la génération</p>}
                {b.depuisImprime && (b.depuisImprime.ajoutes.length + b.depuisImprime.retires.length + b.depuisImprime.modifies.length > 0) && (
                  <div className="mt-2 rounded bg-soft px-3 py-2 text-[12px]"><b>Depuis la version {b.referenceImprimee} imprimée :</b>
                    {b.depuisImprime.ajoutes.length > 0 && <div>Ajoutés : {b.depuisImprime.ajoutes.join(' ; ')}</div>}
                    {b.depuisImprime.retires.length > 0 && <div>Retirés : {b.depuisImprime.retires.join(' ; ')}</div>}
                    {b.depuisImprime.modifies.length > 0 && <div>Modifiés : {b.depuisImprime.modifies.join(' ; ')}</div>}</div>)}
              </li>))}</ul>)}
        </section>
      </div>
    </Modal>
  );
}
