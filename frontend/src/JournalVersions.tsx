import { useEffect, useRef, useState } from 'react';
import { Bug, Lightbulb, Paperclip, Sparkles } from 'lucide-react';
import { api, errMsg, org as orgPath } from './api';
import { useAuth } from './auth';
import { d } from './format';
import { Badge, ErrorBox, Field, Modal, Spinner, useToast } from './ui';
import { VERSION, VERSIONS } from './nouveautes';
import { ACCEPT, MAX_OCTETS, MAX_PIECES, VignetteLocale, extOk, nomCapture } from './PiecesBacklog';

/** Journal des versions : toutes les versions sur une seule vue, la plus récente en premier, chacune avec sa date. */
export function JournalVersions() {
  return (
    <ol className="space-y-3">
      {VERSIONS.map((v) => (
        <li key={v.version} className="rounded-lg border border-line bg-surface p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[15px] font-bold text-head">{v.version}</span>
            <Badge tone={v.type === 'minor' ? 'blue' : 'gray'}>{v.type === 'minor' ? 'Nouveauté' : 'Correctif'}</Badge>
            <span className="font-semibold text-ink">{v.titre}</span>
            <span className="ml-auto flex items-center gap-2 text-[12px] text-mute">
              {v.version === VERSION && <span className="inline-flex items-center gap-1 font-semibold text-ok"><Sparkles className="h-3.5 w-3.5" /> Actuelle</span>}
              <time dateTime={v.date}>{d(v.date)}</time>
            </span>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-slate-700">{v.items.map((it, i) => <li key={i}>{it}</li>)}</ul>
        </li>
      ))}
    </ol>
  );
}

const LIBELLE = { bug: { titre: 'Déclarer un bug', placeholder: 'Que s’est-il passé ? Sur quel écran ? Que deviez-vous obtenir ?' }, evolution: { titre: 'Demander une évolution', placeholder: 'Que souhaitez-vous pouvoir faire ? Pourquoi ?' } };

function Formulaire({ type, onClose, onSent }: { type: 'bug' | 'evolution'; onClose: () => void; onSent: () => void }) {
  const { org } = useAuth();
  const [titre, setTitre] = useState(''); const [description, setDescription] = useState('');
  const [fichiers, setFichiers] = useState<File[]>([]); const [survol, setSurvol] = useState(false);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const choisir = useRef<HTMLInputElement>(null);
  const ajouter = (liste: File[]) => {
    const refus: string[] = [];
    setFichiers((cur) => {
      const out = [...cur];
      liste.forEach((f, i) => {
        const g = f.name === 'image.png' || /^image\.[a-z]+$/.test(f.name) ? new File([f], nomCapture(f, cur.length + i), { type: f.type }) : f; // image collée : nom lisible
        if (!extOk(g.name)) refus.push(`${g.name} : type non accepté`);
        else if (g.size > MAX_OCTETS) refus.push(`${g.name} : plus de 10 Mo`);
        else if (out.length >= MAX_PIECES) refus.push(`${g.name} : ${MAX_PIECES} pièces jointes au plus`);
        else out.push(g);
      });
      return out;
    });
    setErr(refus.length ? refus.join(' ; ') : null);
  };
  // Ctrl+V : les images du presse-papier deviennent des pièces jointes (le texte collé reste collé dans le champ)
  useEffect(() => {
    const h = (e: ClipboardEvent) => { const fs = Array.from(e.clipboardData?.files ?? []); if (fs.length) { e.preventDefault(); ajouter(fs); } };
    document.addEventListener('paste', h); return () => document.removeEventListener('paste', h);
  }, []);
  const envoyer = async () => {
    setBusy(true); setErr(null);
    const corps = new FormData(); corps.append('type', type); corps.append('titre', titre.trim()); corps.append('description', description.trim()); corps.append('versionApp', VERSION);
    fichiers.forEach((f) => corps.append('fichiers', f, f.name));
    try { await api.post(orgPath(org!.id, '/backlog'), corps); onSent(); } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <Modal title={LIBELLE[type].titre} onClose={onClose}>
      <div className="space-y-3">
        <ErrorBox msg={err} />
        <Field label="Titre *"><input className="input" autoFocus maxLength={200} value={titre} onChange={(e) => setTitre(e.target.value)} /></Field>
        <Field label="Description *" hint={`Version ${VERSION}. Vous serez prévenu par courriel de la suite donnée.`}>
          <textarea className="input h-32" maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={LIBELLE[type].placeholder} />
        </Field>
        <div className={`rounded border border-dashed p-3 ${survol ? 'border-action bg-action/5' : 'border-line'}`}
          onDragOver={(e) => { e.preventDefault(); setSurvol(true); }} onDragLeave={() => setSurvol(false)} onDrop={(e) => { e.preventDefault(); setSurvol(false); ajouter(Array.from(e.dataTransfer.files)); }}>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-mute">
            <button type="button" className="btn-secondary" onClick={() => choisir.current?.click()}><Paperclip className="h-4 w-4" /> Joindre des fichiers</button>
            <span>ou glissez-les ici, ou collez une image (Ctrl+V). {MAX_PIECES} fichiers au plus, 10 Mo chacun.</span>
          </div>
          <input ref={choisir} type="file" multiple hidden accept={ACCEPT} onChange={(e) => { ajouter(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
          {fichiers.length > 0 && <ul className="mt-3 flex flex-wrap gap-3">{fichiers.map((f, i) => <VignetteLocale key={f.name + i} f={f} onRetirer={() => setFichiers(fichiers.filter((_, k) => k !== i))} />)}</ul>}
        </div>
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" disabled={busy || titre.trim().length < 3 || description.trim().length < 3} onClick={envoyer}>{busy && <Spinner />} Envoyer</button></div>
      </div>
    </Modal>
  );
}

/** Deux boutons : déclarer un bug, demander une évolution (alimentent le backlog du SCC et des administrateurs). */
export function BoutonsDemande() {
  const [type, setType] = useState<'bug' | 'evolution' | null>(null); const { toast, node } = useToast();
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" onClick={() => setType('bug')}><Bug className="h-4 w-4" /> Déclarer un bug</button>
        <button className="btn-secondary" onClick={() => setType('evolution')}><Lightbulb className="h-4 w-4" /> Demander une évolution</button>
      </div>
      {type && <Formulaire type={type} onClose={() => setType(null)} onSent={() => { setType(null); toast('Demande envoyée, merci'); }} />}
      {node}
    </>
  );
}
