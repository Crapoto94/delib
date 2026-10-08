import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileUp, Plus, Trash2 } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, ErrorBox, Field, Spinner } from '../ui';

const aujourdhui = () => new Date().toISOString().slice(0, 10);

/** Choix à la création d'un arrêté : il suit un parcours (circuit puis signature), ou il est déjà signé. */
export function ChoixParcours({ valeur, onChange }: { valeur: 'parcours' | 'signe'; onChange: (v: 'parcours' | 'signe') => void }) {
  const carte = (v: 'parcours' | 'signe', titre: string, texte: string) => (
    <label className={`flex cursor-pointer items-start gap-3 rounded border p-3 ${valeur === v ? 'border-action bg-action/5 ring-1 ring-action/30' : 'border-line'}`}>
      <input type="radio" name="parcours-arrete" className="mt-1" checked={valeur === v} onChange={() => onChange(v)} />
      <span><b className="text-head">{titre}</b><span className="block text-[12px] text-mute">{texte}</span></span>
    </label>
  );
  return (
    <fieldset className="grid gap-2 md:grid-cols-2"><legend className="label mb-1">Cet arrêté…</legend>
      {carte('parcours', 'suit un parcours', 'Rédaction, circuit de validation, puis signature du maire ou de l’adjoint·e.')}
      {carte('signe', 'est déjà signé', 'Vous déposez l’arrêté signé et ses annexes : il est directement dans la bibliothèque, sans circuit ni exposé des motifs.')}
    </fieldset>
  );
}

/** Saisie d'un arrêté DÉJÀ SIGNÉ : éléments nécessaires, arrêté (PDF), annexes éventuelles et contrôle de légalité (à transmettre ou déjà envoyé). */
export default function ArreteSigne({ onClose }: { onClose: () => void }) {
  const { org, me } = useAuth(); const o = org!.id; const nav = useNavigate();
  const [f, setF] = useState({ titre: '', dateSignature: aujourdhui(), signataire: '', numeroArrete: '', serviceLabel: '', confidentialite: 'normale' });
  const [arrete, setArrete] = useState<File | null>(null);
  const [annexes, setAnnexes] = useState<{ titre: string; file: File }[]>([]);
  const [cl, setCl] = useState<{ etat: 'a_transmettre' | 'deja_envoye'; dateEnvoi: string; dateAr: string; numeroAr: string }>({ etat: 'a_transmettre', dateEnvoi: '', dateAr: '', numeroAr: '' });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const maj = (k: string, v: string) => setF({ ...f, [k]: v });
  const pret = f.titre.trim().length >= 3 && !!f.dateSignature && !!arrete && (cl.etat === 'a_transmettre' || !!cl.dateEnvoi);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!arrete) return; setBusy(true); setErr(null);
    const fd = new FormData();
    fd.append('titre', f.titre.trim()); fd.append('dateSignature', f.dateSignature); fd.append('confidentialite', f.confidentialite);
    if (f.signataire.trim()) fd.append('signataire', f.signataire.trim()); if (f.numeroArrete.trim()) fd.append('numeroArrete', f.numeroArrete.trim()); if (f.serviceLabel.trim()) fd.append('serviceLabel', f.serviceLabel.trim());
    fd.append('controleLegalite', JSON.stringify(cl.etat === 'a_transmettre' ? { etat: 'a_transmettre' } : { etat: 'deja_envoye', dateEnvoi: cl.dateEnvoi, ...(cl.dateAr ? { dateAr: cl.dateAr } : {}), ...(cl.numeroAr.trim() ? { numeroAr: cl.numeroAr.trim() } : {}) }));
    fd.append('annexesTitres', JSON.stringify(annexes.map((a) => a.titre.trim() || a.file.name)));
    fd.append('arrete', arrete); annexes.forEach((a) => fd.append('annexes', a.file));
    try { const r = await api.post(orgPath(o, '/actes/arrete-signe'), fd); nav(`/dossiers/${r.data.id}`); } catch (x) { setErr(errMsg(x)); setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorBox msg={err} />
      <Field label="Objet de l'arrêté *" hint="Titre tel qu'il apparaîtra dans la bibliothèque et sur la page publique."><input className="input" required minLength={3} maxLength={500} value={f.titre} onChange={(e) => maj('titre', e.target.value)} /></Field>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Date de signature *"><input className="input" type="date" required max={aujourdhui()} value={f.dateSignature} onChange={(e) => maj('dateSignature', e.target.value)} /></Field>
        <Field label="N° de l'arrêté" hint="Ex. AR202609_41."><input className="input" maxLength={60} value={f.numeroArrete} onChange={(e) => maj('numeroArrete', e.target.value)} /></Field>
        <Field label="Signataire" hint="Le maire ou l'adjoint·e."><input className="input" maxLength={120} value={f.signataire} onChange={(e) => maj('signataire', e.target.value)} placeholder="Le Maire" /></Field>
      </div>
      <p className="text-[12px] text-mute">Direction porteuse : <b>{me?.agent?.direction?.label ?? 'à préciser'}</b> (déduite de votre fiche RH).</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Service / bureau" hint="Facultatif."><input className="input" maxLength={120} value={f.serviceLabel} onChange={(e) => maj('serviceLabel', e.target.value)} /></Field>
        <Field label="Confidentialité" hint="Un arrêté confidentiel n'est jamais publié."><select className="input" value={f.confidentialite} onChange={(e) => maj('confidentialite', e.target.value)}><option value="normale">Normale (publiable)</option><option value="confidentiel">Confidentiel</option></select></Field>
      </div>

      <div className="rounded border border-line p-3">
        <span className="label">Arrêté signé (PDF) *</span>
        <label className="mt-1 flex cursor-pointer items-center gap-2 text-[13px]"><FileUp className="h-4 w-4 text-action" />
          <input type="file" accept="application/pdf,.pdf" className="text-[13px]" onChange={(e) => setArrete(e.target.files?.[0] ?? null)} />
          {arrete && <Badge tone="ok">{arrete.name}</Badge>}</label>
      </div>

      <div className="rounded border border-line p-3">
        <div className="flex items-center justify-between"><span className="label">Annexes (facultatif)</span>
          <label className="btn-secondary !py-1 cursor-pointer"><Plus className="h-4 w-4" /> Ajouter une annexe<input type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.odt,.ods,.ppt,.pptx" multiple onChange={(e) => { const l = [...(e.target.files ?? [])].map((file) => ({ titre: file.name.replace(/\.[^.]+$/, ''), file })); setAnnexes([...annexes, ...l].slice(0, 20)); e.target.value = ''; }} /></label></div>
        {annexes.length === 0 ? <p className="mt-1 text-[12px] text-mute">Aucune annexe.</p> : (
          <ul className="mt-2 space-y-2">{annexes.map((a, i) => (
            <li key={i} className="flex items-center gap-2"><input className="input" aria-label={`Titre de l'annexe ${i + 1}`} value={a.titre} maxLength={300} onChange={(e) => setAnnexes(annexes.map((x, j) => (j === i ? { ...x, titre: e.target.value } : x)))} />
              <span className="shrink-0 text-[12px] text-mute">{a.file.name}</span>
              <button type="button" className="rounded p-1.5 text-ko hover:bg-ko-bg" aria-label={`Retirer l'annexe ${i + 1}`} onClick={() => setAnnexes(annexes.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></li>))}</ul>)}
      </div>

      <fieldset className="space-y-2 rounded border border-line p-3"><legend className="px-1 text-[12px] font-semibold uppercase text-mute">Contrôle de légalité</legend>
        <label className="flex items-start gap-2"><input type="radio" name="cl" className="mt-1" checked={cl.etat === 'a_transmettre'} onChange={() => setCl({ ...cl, etat: 'a_transmettre' })} /><span><b>À transmettre</b> — l'arrêté est proposé dans la télétransmission (<Link className="text-action underline" to="/controle-legalite" target="_blank">contrôle de légalité</Link>).</span></label>
        <label className="flex items-start gap-2"><input type="radio" name="cl" className="mt-1" checked={cl.etat === 'deja_envoye'} onChange={() => setCl({ ...cl, etat: 'deja_envoye' })} /><span><b>Déjà envoyé</b> au contrôle de légalité.</span></label>
        {cl.etat === 'deja_envoye' && (
          <div className="grid gap-3 pl-6 md:grid-cols-3">
            <Field label="Date d'envoi *"><input className="input" type="date" required max={aujourdhui()} value={cl.dateEnvoi} onChange={(e) => setCl({ ...cl, dateEnvoi: e.target.value })} /></Field>
            <Field label="Accusé de réception reçu le"><input className="input" type="date" min={cl.dateEnvoi || undefined} max={aujourdhui()} value={cl.dateAr} onChange={(e) => setCl({ ...cl, dateAr: e.target.value })} /></Field>
            <Field label="N° d'accusé de réception"><input className="input" maxLength={80} value={cl.numeroAr} onChange={(e) => setCl({ ...cl, numeroAr: e.target.value })} /></Field>
          </div>)}
      </fieldset>

      <p className="text-[12px] text-mute">Pas de circuit, pas d'exposé des motifs : l'arrêté est enregistré comme <b>signé</b> le {f.dateSignature ? dt(`${f.dateSignature}T12:00:00`, { dateStyle: 'long' }) : '…'} et consultable dans la <b>bibliothèque</b>.</p>
      <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy || !pret}>{busy && <Spinner />} Enregistrer l'arrêté signé</button></div>
    </form>
  );
}
