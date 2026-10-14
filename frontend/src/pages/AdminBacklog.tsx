import { useState } from 'react';
import { Check, CircleCheckBig, X } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { PiecesDemande } from '../PiecesBacklog';
import { Badge, ErrorBox, Field, Loading, Modal, Spinner, useLoad, useToast } from '../ui';

type Statut = 'demandee' | 'acceptee' | 'refusee' | 'realisee';
const ETAT: Record<Statut, { label: string; tone: 'ok' | 'blue' | 'gray' | 'warn' | 'ko' }> = {
  demandee: { label: 'Demandée', tone: 'warn' }, acceptee: { label: 'Acceptée', tone: 'blue' }, refusee: { label: 'Refusée', tone: 'ko' }, realisee: { label: 'Réalisée', tone: 'ok' },
};
const COURRIEL: Record<string, string> = { envoye: 'Le demandeur a été prévenu par courriel.', sans_adresse: 'Aucune adresse courriel connue pour le demandeur : il n’a pas été prévenu.', echec: 'L’envoi du courriel au demandeur a échoué.' };

function Refus({ demande, onClose, onDone }: { demande: any; onClose: () => void; onDone: (r: any) => void }) {
  const { org } = useAuth(); const [motif, setMotif] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const refuser = async () => {
    setBusy(true); setErr(null);
    try { onDone((await api.put(orgPath(org!.id, `/backlog/${demande.id}/etat`), { statut: 'refusee', motif: motif.trim() })).data); } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <Modal title={`Refuser la demande n° ${demande.id}`} onClose={onClose}>
      <div className="space-y-3">
        <ErrorBox msg={err} />
        <p className="text-mute">« {demande.titre} » — le motif sera transmis par courriel à {demande.demandeurNom || demande.demandeur}.</p>
        <Field label="Motif du refus *"><textarea className="input h-24" autoFocus maxLength={2000} value={motif} onChange={(e) => setMotif(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" disabled={busy || motif.trim().length < 3} onClick={refuser}>{busy && <Spinner />} Refuser</button></div>
      </div>
    </Modal>
  );
}

/** Backlog : bugs signalés et évolutions demandées ; le SCC et les administrateurs les acceptent, refusent (avec motif) ou déclarent réalisés. */
export default function AdminBacklog() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const [filtre, setFiltre] = useState<'' | Statut>('');
  const d = useLoad(async () => (await api.get(orgPath(o, '/backlog'))).data.items as any[], [o]);
  const [refus, setRefus] = useState<any | null>(null);
  const traite = (r: any) => { toast(`Demande n° ${r.id} : ${ETAT[r.statut as Statut].label.toLowerCase()}. ${COURRIEL[r.courriel] ?? ''}`, r.courriel === 'envoye' ? 'ok' : 'ko'); d.reload(); };
  const changer = async (x: any, statut: Statut) => { try { traite((await api.put(orgPath(o, `/backlog/${x.id}/etat`), { statut })).data); } catch (e) { toast(errMsg(e), 'ko'); } };
  if (d.loading && !d.data) return <Loading />;
  if (!d.data) return <ErrorBox msg={d.error} />;
  const lignes = d.data.filter((x) => !filtre || x.statut === filtre);
  const nb = (s: Statut) => d.data!.filter((x) => x.statut === s).length;
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-mute">Les bugs déclarés et les évolutions demandées par les utilisateurs depuis les Nouveautés. Chaque changement d'état est notifié <b>par courriel</b> au demandeur.</p>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrer par état">
        <button role="tab" aria-selected={filtre === ''} className={filtre === '' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFiltre('')}>Toutes ({d.data.length})</button>
        {(Object.keys(ETAT) as Statut[]).map((s) => <button key={s} role="tab" aria-selected={filtre === s} className={filtre === s ? 'btn-primary' : 'btn-secondary'} onClick={() => setFiltre(s)}>{ETAT[s].label} ({nb(s)})</button>)}
      </div>
      <div className="card overflow-x-auto">
        {!lignes.length ? <p className="p-8 text-center text-mute">Aucune demande.</p> : (
          <table className="w-full"><thead><tr><th>N°</th><th>Type</th><th>Demande</th><th>Demandeur</th><th>État</th><th /></tr></thead><tbody>
            {lignes.map((x) => (
              <tr key={x.id} className="align-top">
                <td className="font-mono">{x.id}</td>
                <td><Badge tone={x.type === 'bug' ? 'ko' : 'blue'}>{x.type === 'bug' ? 'Bug' : 'Évolution'}</Badge></td>
                <td className="max-w-lg"><div className="font-semibold">{x.titre}</div><div className="whitespace-pre-line text-[12px] text-slate-700">{x.description}</div><PiecesDemande orgId={o} demandeId={x.id} pieces={x.pieces ?? []} />{x.versionApp && <div className="text-[11px] text-mute">Version {x.versionApp}</div>}
                  {x.motif && <div className="mt-1 text-[12px]"><b>{x.statut === 'refusee' ? 'Motif' : 'Précision'} :</b> {x.motif}</div>}</td>
                <td className="whitespace-nowrap text-[12px]">{x.demandeurNom || x.demandeur}<br /><span className="text-mute">{dt(x.creeLe)}</span></td>
                <td className="whitespace-nowrap"><Badge tone={ETAT[x.statut as Statut].tone}>{ETAT[x.statut as Statut].label}</Badge>{x.traitePar && <div className="mt-1 text-[11px] text-mute">{x.traitePar}, {dt(x.traiteLe)}</div>}</td>
                <td className="whitespace-nowrap text-right">
                  {(x.statut === 'demandee' || x.statut === 'refusee') && <button className="rounded p-2 hover:bg-slate-100" title="Accepter" aria-label="Accepter" onClick={() => changer(x, 'acceptee')}><Check className="h-4 w-4 text-ok" /></button>}
                  {(x.statut === 'demandee' || x.statut === 'acceptee') && <button className="rounded p-2 hover:bg-slate-100" title="Refuser" aria-label="Refuser" onClick={() => setRefus(x)}><X className="h-4 w-4 text-ko" /></button>}
                  {x.statut === 'acceptee' && <button className="rounded p-2 hover:bg-slate-100" title="Déclarer réalisée" aria-label="Déclarer réalisée" onClick={() => changer(x, 'realisee')}><CircleCheckBig className="h-4 w-4 text-action" /></button>}
                </td>
              </tr>))}
          </tbody></table>)}
      </div>
      {refus && <Refus demande={refus} onClose={() => setRefus(null)} onDone={(r) => { setRefus(null); traite(r); }} />}
      {node}
    </div>
  );
}
