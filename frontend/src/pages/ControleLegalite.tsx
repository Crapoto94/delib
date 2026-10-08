import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { d } from '../format';
import { Badge, ErrorBox, Field, Spinner } from '../ui';

const aujourdhui = () => new Date().toISOString().slice(0, 10);

/** Contrôle de légalité d'un arrêté signé : à transmettre (proposé dans la télétransmission) ou déjà envoyé (date, accusé de réception). */
export default function ControleLegalite({ acte, onChanged, toast }: { acte: any; onChanged: () => void; toast: (m: string, t?: 'ok' | 'ko') => void }) {
  const { org, me } = useAuth(); const o = org!.id;
  const cl = acte.custom?.controleLegalite as { etat: string; dateEnvoi?: string; dateAr?: string; numeroAr?: string };
  const peut = !!acte.droits?.administrer || acte.redacteur === me?.username;
  const [ouvert, setOuvert] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ dateEnvoi: '', dateAr: '', numeroAr: '' });
  const envoyer = async (corps: object, ok: string) => {
    setBusy(true); setErr(null);
    try { await api.put(orgPath(o, `/actes/${acte.id}/controle-legalite`), corps); toast(ok); setOuvert(false); onChanged(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <section className="card space-y-2 p-5"><div className="flex flex-wrap items-center gap-2"><h3>Contrôle de légalité</h3>
      {cl.etat === 'deja_envoye' ? <Badge tone="ok">Déjà envoyé</Badge> : <Badge tone="warn">À transmettre</Badge>}</div>
      {cl.etat === 'deja_envoye' ? (
        <p className="text-[13px] text-mute">Envoyé le <b>{d(cl.dateEnvoi)}</b>{cl.dateAr ? <> · accusé de réception du <b>{d(cl.dateAr)}</b></> : ' · accusé de réception non renseigné'}{cl.numeroAr ? <> · <code>{cl.numeroAr}</code></> : ''}.</p>
      ) : (
        <p className="text-[13px] text-mute">Cet arrêté est <b>proposé dans la télétransmission</b> : ouvrez le <Link className="text-action underline" to="/controle-legalite">contrôle de légalité</Link> pour le préparer et l'envoyer. S'il a déjà été envoyé par ailleurs, indiquez-le.</p>
      )}
      {peut && !ouvert && (cl.etat === 'deja_envoye'
        ? <button className="btn-secondary" disabled={busy} onClick={() => window.confirm('Remettre cet arrêté « à transmettre » ?') && envoyer({ etat: 'a_transmettre' }, 'Arrêté à transmettre')}>Remettre « à transmettre »</button>
        : <button className="btn-secondary" onClick={() => setOuvert(true)}>Il a déjà été envoyé…</button>)}
      {peut && ouvert && (
        <div className="space-y-3 rounded border border-line p-3"><ErrorBox msg={err} />
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Date d'envoi *"><input className="input" type="date" max={aujourdhui()} value={f.dateEnvoi} onChange={(e) => setF({ ...f, dateEnvoi: e.target.value })} /></Field>
            <Field label="Accusé de réception reçu le"><input className="input" type="date" min={f.dateEnvoi || undefined} max={aujourdhui()} value={f.dateAr} onChange={(e) => setF({ ...f, dateAr: e.target.value })} /></Field>
            <Field label="N° d'accusé de réception"><input className="input" maxLength={80} value={f.numeroAr} onChange={(e) => setF({ ...f, numeroAr: e.target.value })} /></Field>
          </div>
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setOuvert(false)}>Annuler</button>
            <button className="btn-primary" disabled={busy || !f.dateEnvoi} onClick={() => envoyer({ etat: 'deja_envoye', dateEnvoi: f.dateEnvoi, ...(f.dateAr ? { dateAr: f.dateAr } : {}), ...(f.numeroAr.trim() ? { numeroAr: f.numeroAr.trim() } : {}) }, 'Envoi enregistré')}>{busy && <Spinner />} Enregistrer</button></div>
        </div>)}
    </section>
  );
}
