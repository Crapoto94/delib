import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Video } from 'lucide-react';
import { api, errMsg, org as orgPath } from './api';
import { useAuth } from './auth';
import { dt } from './format';
import { Badge, ErrorBox, Field, Loading, Modal, Spinner, useLoad, useToast } from './ui';

/** Choix de la visioconférence Teams d'une séance ou d'une réunion : création automatique, lien collé, ou aucune. */
export function TeamsForm({ seance, onClose, onDone }: { seance: any; onClose: () => void; onDone: () => void }) {
  const { org } = useAuth(); const o = org!.id;
  const [mode, setMode] = useState<'auto' | 'lien' | 'aucun'>(seance.teams ? 'lien' : 'auto'); const [joinUrl, setJoinUrl] = useState(seance.teams?.joinUrl ?? '');
  const [inviter, setInviter] = useState(false); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.put(orgPath(o, `/seances/${seance.id}/teams`), { mode, joinUrl: mode === 'lien' ? joinUrl : undefined, inviter: mode === 'auto' ? inviter : false }); onDone(); onClose(); } catch (x) { setErr(errMsg(x)); setBusy(false); }
  };
  return (
    <Modal title="Réunion Microsoft Teams" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3"><ErrorBox msg={err} />
        <label className="flex items-start gap-3 rounded border border-line p-3"><input type="radio" className="mt-1" checked={mode === 'auto'} onChange={() => setMode('auto')} /><span><b>Créer la réunion Teams automatiquement</b><br /><span className="text-[12px] text-mute">Le lien est généré et communiqué aux membres. Nécessite la configuration Microsoft Graph du serveur.</span></span></label>
        {mode === 'auto' && <label className="ml-8 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={inviter} onChange={(e) => setInviter(e.target.checked)} /> Envoyer aussi les invitations Teams aux membres et secrétaires</label>}
        <label className="flex items-start gap-3 rounded border border-line p-3"><input type="radio" className="mt-1" checked={mode === 'lien'} onChange={() => setMode('lien')} /><span><b>J'ai déjà un lien Teams</b><br /><span className="text-[12px] text-mute">Collez le lien de la réunion (https://teams.microsoft.com/…).</span></span></label>
        {mode === 'lien' && <div className="ml-8"><input className="input" required placeholder="https://teams.microsoft.com/l/meetup-join/…" value={joinUrl} onChange={(e) => setJoinUrl(e.target.value)} /></div>}
        {seance.teams && <label className="flex items-start gap-3 rounded border border-line p-3"><input type="radio" className="mt-1" checked={mode === 'aucun'} onChange={() => setMode('aucun')} /><span><b>Retirer la visioconférence</b></span></label>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />} Enregistrer</button></div>
      </form>
    </Modal>
  );
}

export const TeamsLink = ({ teams }: { teams: { joinUrl: string } | null }) => (teams
  ? <a href={teams.joinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded bg-indigo2-bg px-2 py-0.5 text-[12px] font-semibold text-indigo2 hover:underline"><Video className="h-3.5 w-3.5" /> Rejoindre sur Teams</a>
  : null);

/** Réunions d'une commission : planification (date, lieu, Teams), projets présentés, accès à l'ordre du jour de la réunion. */
export function ReunionsSection({ commissionId, canEdit }: { commissionId: number; canEdit: boolean }) {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const list = useLoad(async () => (await api.get(orgPath(o, `/commissions/${commissionId}/reunions`))).data.items as any[], [commissionId]);
  const [creating, setCreating] = useState(false); const [teamsFor, setTeamsFor] = useState<any>(null);
  const [f, setF] = useState({ date: '', duree: 90, lieu: '', teams: 'lien-plus-tard' as 'auto' | 'lien' | 'aucun' | 'lien-plus-tard', joinUrl: '', inviter: false });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const now = Date.now();
  const create = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const teams = f.teams === 'auto' ? { mode: 'auto', inviter: f.inviter } : f.teams === 'lien' ? { mode: 'lien', joinUrl: f.joinUrl } : undefined;
      await api.post(orgPath(o, `/commissions/${commissionId}/reunions`), { dateSeance: new Date(f.date).toISOString(), dureeMinutes: Number(f.duree), lieu: f.lieu || undefined, teams });
      toast('Réunion planifiée : les membres sont prévenus'); setCreating(false); list.reload();
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <section>
      <div className="mb-2 flex items-center justify-between"><h3 className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-action" /> Réunions</h3>
        {canEdit && <button className="btn-primary !py-1" onClick={() => setCreating(true)}>Planifier une réunion</button>}</div>
      {list.loading ? <Loading /> : !list.data?.length ? <p className="text-mute">Aucune réunion planifiée.</p> : (
        <ul className="divide-y divide-line rounded border border-line">{list.data.map((r) => {
          const past = new Date(r.dateSeance).getTime() < now;
          return (
            <li key={r.id} className={`flex flex-wrap items-center gap-3 px-3 py-2 ${past ? 'opacity-70' : ''}`}>
              <div className="min-w-[210px]"><div className="font-semibold">{dt(r.dateSeance, { dateStyle: 'full', timeStyle: 'short' })}</div><div className="text-[12px] text-mute">{r.lieu || 'Lieu à définir'}{r.dureeMinutes ? ` · ${r.dureeMinutes} min` : ''}</div></div>
              <Badge tone={r.statut === 'annulee' ? 'ko' : past ? 'gray' : 'blue'}>{r.statut === 'annulee' ? 'annulée' : past ? 'passée' : 'à venir'}</Badge>
              <Badge tone={r.projets ? 'ok' : 'gray'}>{r.projets} projet(s) présenté(s)</Badge>
              <TeamsLink teams={r.teams} />
              <span className="ml-auto flex gap-2">
                {canEdit && r.statut !== 'annulee' && <button className="btn-secondary !py-1" onClick={() => setTeamsFor(r)}><Video className="h-3.5 w-3.5" /> Teams</button>}
                {canEdit && r.statut !== 'annulee' && <Link className="btn-secondary !py-1" to={`/seances/${r.id}/convocation`}>Convocation</Link>}
                <Link className="btn-secondary !py-1" to={`/seances/${r.id}`}>Ordre du jour →</Link></span>
            </li>);
        })}</ul>)}
      {creating && (
        <Modal title="Planifier une réunion de commission" onClose={() => setCreating(false)}>
          <form onSubmit={create} className="space-y-4"><ErrorBox msg={err} />
            <div className="grid gap-4 md:grid-cols-2"><Field label="Date et heure"><input className="input" type="datetime-local" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
              <Field label="Durée (minutes)"><input className="input" type="number" min={15} max={720} value={f.duree} onChange={(e) => setF({ ...f, duree: Number(e.target.value) })} /></Field></div>
            <Field label="Lieu"><input className="input" value={f.lieu} onChange={(e) => setF({ ...f, lieu: e.target.value })} placeholder="Salle Robespierre" /></Field>
            <fieldset className="space-y-2 rounded border border-line p-3"><legend className="px-1 text-[12px] font-semibold text-slate-600">Visioconférence Teams</legend>
              {([['lien-plus-tard', 'Aucune pour l\'instant'], ['auto', 'Créer la réunion Teams automatiquement'], ['lien', 'J\'ai déjà un lien Teams']] as const).map(([k, l]) => (
                <label key={k} className="flex items-center gap-2"><input type="radio" checked={f.teams === k} onChange={() => setF({ ...f, teams: k })} /> {l}</label>))}
              {f.teams === 'auto' && <label className="ml-6 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.inviter} onChange={(e) => setF({ ...f, inviter: e.target.checked })} /> Envoyer les invitations Teams aux membres</label>}
              {f.teams === 'lien' && <input className="input" required placeholder="https://teams.microsoft.com/l/meetup-join/…" value={f.joinUrl} onChange={(e) => setF({ ...f, joinUrl: e.target.value })} />}
            </fieldset>
            <p className="text-[12px] text-mute">Les membres et les secrétaires reçoivent un mail avec la date, le lieu et le lien Teams ; un rappel part 2 jours ouvrés avant.</p>
            <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setCreating(false)}>Annuler</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />} Planifier</button></div>
          </form>
        </Modal>)}
      {teamsFor && <TeamsForm seance={teamsFor} onClose={() => setTeamsFor(null)} onDone={() => { toast('Visioconférence enregistrée'); list.reload(); }} />}
      {node}
    </section>
  );
}
