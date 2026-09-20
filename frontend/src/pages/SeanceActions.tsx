import { FormEvent, useState } from 'react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, ErrorBox, Field, Loading, Modal, useLoad } from '../ui';

/** ISO -> valeur d'un <input type="datetime-local"> (heure locale). */
const toLocalInput = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
/** ISO -> valeur d'un <input type="date"> (jour à Paris). */
const toDay = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }) : '');
const TYPES: Record<string, string> = { ordinaire: 'Ordinaire', extraordinaire: 'Extraordinaire', budgetaire: 'Budgétaire', autre: 'Autre' };

/** Modifier une séance : date, lieu, durée, type et dates clés (un changement de date limite recalcule les rappels). */
export function EditSeanceModal({ seance, onClose, onDone }: { seance: any; onClose: () => void; onDone: () => void }) {
  const { org } = useAuth(); const o = org!.id;
  const [date, setDate] = useState(toLocalInput(seance.dateSeance)); const [lieu, setLieu] = useState<string>(seance.lieu ?? '');
  const [duree, setDuree] = useState<string>(seance.dureeMinutes ? String(seance.dureeMinutes) : ''); const [type, setType] = useState<string>(seance.type ?? 'ordinaire');
  const [lim, setLim] = useState({ redaction: toDay(seance.dateLimiteRedaction), dgs: toDay(seance.dateLimiteDgs), mad: toDay(seance.dateLimiteMadCommissions), convocation: toDay(seance.dateEnvoiConvocation) });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const commission = seance.kind === 'commission';
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const body: Record<string, unknown> = { dateSeance: new Date(date).toISOString(), lieu: lieu.trim() || undefined, type, dureeMinutes: duree ? Number(duree) : undefined };
    if (!commission) Object.assign(body, { dateLimiteRedaction: lim.redaction || null, dateLimiteDgs: lim.dgs || null, dateLimiteMadCommissions: lim.mad || null, dateEnvoiConvocation: lim.convocation || null });
    try { await api.put(orgPath(o, `/seances/${seance.id}`), body); onDone(); onClose(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Modifier la séance" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4"><ErrorBox msg={err} />
        <p className="text-[13px] text-mute">{seance.instance}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date et heure"><input className="input" type="datetime-local" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Durée prévue (minutes)"><input className="input" type="number" min={15} max={720} step={15} value={duree} onChange={(e) => setDuree(e.target.value)} placeholder="120" /></Field>
          <Field label="Lieu"><input className="input" value={lieu} onChange={(e) => setLieu(e.target.value)} placeholder="Salle du conseil, Hôtel de ville" /></Field>
          <Field label="Type de séance"><select className="input" value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        </div>
        {!commission && (
          <fieldset className="rounded border border-line p-3"><legend className="px-1 text-[12px] font-semibold text-mute">Dates clés (fin de journée)</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Limite de rédaction"><input className="input" type="date" value={lim.redaction} onChange={(e) => setLim({ ...lim, redaction: e.target.value })} /></Field>
              <Field label="Limite de validation DGS"><input className="input" type="date" value={lim.dgs} onChange={(e) => setLim({ ...lim, dgs: e.target.value })} /></Field>
              <Field label="Mise à disposition des commissions"><input className="input" type="date" value={lim.mad} onChange={(e) => setLim({ ...lim, mad: e.target.value })} /></Field>
              <Field label="Envoi de la convocation"><input className="input" type="date" value={lim.convocation} onChange={(e) => setLim({ ...lim, convocation: e.target.value })} /></Field>
            </div>
            <p className="mt-2 text-[12px] text-mute">Une date limite modifiée recalcule d’elle-même les rappels des dossiers qui visent la séance.</p>
          </fieldset>)}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy}>Enregistrer</button></div>
      </form>
    </Modal>
  );
}

/** Supprimer une séance : les actes qui la visent ou sont à son ordre du jour ne sont jamais perdus (séance suivante, ou sans affectation). */
export function DeleteSeanceModal({ seance, onClose, onDone }: { seance: any; onClose: () => void; onDone: () => void }) {
  const { org } = useAuth(); const o = org!.id;
  const imp = useLoad(async () => (await api.get(orgPath(o, `/seances/${seance.id}/suppression`))).data, [o, seance.id]);
  const [dest, setDest] = useState<'prochaine' | 'aucune' | ''>(''); const [motif, setMotif] = useState(''); const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const d = imp.data; const nActes: number = d?.actes?.length ?? 0;
  const destination = nActes ? (dest || (d?.suivante ? 'prochaine' : 'aucune')) : undefined;
  const submit = async () => {
    setBusy(true); setErr(null);
    try { await api.delete(orgPath(o, `/seances/${seance.id}`), { params: { destination, motif: motif.trim() || undefined, forcer: d.convocations > 0 ? true : undefined } }); onDone(); onClose(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Supprimer la séance" onClose={onClose} wide>
      {imp.loading || !d ? <Loading /> : (
        <div className="space-y-4"><ErrorBox msg={err || imp.error} />
          <p><b>{d.seance.instance}</b> du {dt(d.seance.dateSeance, { dateStyle: 'full', timeStyle: 'short' })}</p>
          {!d.supprimable ? <p className="rounded border border-warn/40 bg-warn-bg p-3 text-warn">{d.raison}</p> : (
            <>
              {nActes > 0 ? (
                <>
                  <div className="rounded border border-line">
                    <div className="border-b border-line bg-soft px-3 py-2 text-[13px] font-semibold">{nActes} dossier(s) visent cette séance ou sont à son ordre du jour</div>
                    <ul className="max-h-48 divide-y divide-line overflow-y-auto text-[13px]">{d.actes.map((a: any) => (
                      <li key={a.id} className="flex items-center gap-2 px-3 py-1.5"><span className="font-mono text-[11px] text-mute">#{a.numeroSuivi}</span><span className="min-w-0 flex-1 truncate">{a.titre}</span>{a.alOrdreDuJour && <Badge tone="blue">à l’ordre du jour</Badge>}</li>))}</ul>
                  </div>
                  <fieldset className="space-y-2"><legend className="mb-1 text-[13px] font-semibold">Que deviennent ces dossiers ?</legend>
                    <label className={`flex items-start gap-2 rounded border p-3 ${destination === 'prochaine' ? 'border-action bg-action/5' : 'border-line'} ${!d.suivante ? 'opacity-50' : ''}`}>
                      <input type="radio" className="mt-1" name="dest" disabled={!d.suivante} checked={destination === 'prochaine'} onChange={() => setDest('prochaine')} />
                      <span><b>Les reporter sur la prochaine séance</b><br /><span className="text-[12px] text-mute">{d.suivante ? <>Ils visent la séance du {dt(d.suivante.dateSeance, { dateStyle: 'full', timeStyle: 'short' })} ; le SCC les affectera à son ordre du jour.</> : 'Aucune séance suivante n’est planifiée pour cette instance : créez-la d’abord.'}</span></span></label>
                    <label className={`flex items-start gap-2 rounded border p-3 ${destination === 'aucune' ? 'border-action bg-action/5' : 'border-line'}`}>
                      <input type="radio" className="mt-1" name="dest" checked={destination === 'aucune'} onChange={() => setDest('aucune')} />
                      <span><b>Les laisser sans affectation</b><br /><span className="text-[12px] text-mute">Ils reviennent « en attente d’affectation » et pourront être rattachés à n’importe quelle séance plus tard.</span></span></label>
                  </fieldset>
                </>) : <p className="text-mute">Aucun dossier ne vise cette séance.</p>}
              {d.convocations > 0 && <label className="flex items-start gap-2 rounded border border-warn/40 bg-warn-bg p-3 text-[13px]"><input type="checkbox" className="mt-1" checked={ok} onChange={(e) => setOk(e.target.checked)} /><span><b>{d.convocations} convocation(s) ont déjà été envoyées.</b> Leur suivi (qui a lu quoi) sera effacé avec la séance. Je confirme la suppression.</span></label>}
              <Field label="Motif (facultatif, conservé dans l’historique des dossiers)"><input className="input" value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Séance annulée, remplacée par…" /></Field>
            </>)}
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Annuler</button>
            {d.supprimable && <button className="btn-primary !bg-ko-solid" disabled={busy || (d.convocations > 0 && !ok) || (nActes > 0 && destination === 'prochaine' && !d.suivante)} onClick={submit}>Supprimer la séance</button>}</div>
        </div>)}
    </Modal>
  );
}
