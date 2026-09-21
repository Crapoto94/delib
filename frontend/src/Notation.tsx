import { useState } from 'react';
import { Star } from 'lucide-react';
import { api, errMsg, org as orgPath } from './api';
import { useAuth } from './auth';
import { Spinner } from './ui';

/**
 * Notation d'une réponse de l'assistant IA : « Ma réponse vous a-t-elle convenu ? »
 * 1 à 4 étoiles et commentaire facultatif. Enregistrée dans le journal de l'aide IA.
 */
export function NotationReponse({ journalId }: { journalId: number }) {
  const { org } = useAuth(); const o = org!.id;
  const [note, setNote] = useState(0); const [commentaire, setCommentaire] = useState('');
  const [busy, setBusy] = useState(false); const [fait, setFait] = useState(false); const [erreur, setErreur] = useState<string | null>(null);
  const LIBELLE: Record<number, string> = { 1: 'Pas du tout', 2: 'Peu', 3: 'Bien', 4: 'Très bien' };
  const envoyer = async () => {
    if (!note) return; setBusy(true); setErreur(null);
    try { await api.post(orgPath(o, `/ia/delia/${journalId}/note`), { note, commentaire: commentaire.trim() || null }); setFait(true); }
    catch (e) { setErreur(errMsg(e)); } finally { setBusy(false); }
  };
  if (fait) return <p className="mt-2 text-[12px] font-semibold text-ok-text">Merci, votre avis a été enregistré.</p>;
  return (
    <div className="mt-2 border-t border-line pt-2">
      <p className="text-[12px] font-semibold">Ma réponse vous a-t-elle convenu ?</p>
      <div className="mt-1 flex items-center gap-1" role="radiogroup" aria-label="Note de la réponse">
        {[1, 2, 3, 4].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={note === n} aria-label={`${n} étoile${n > 1 ? 's' : ''}`} onClick={() => setNote(n)}>
            <Star className={`h-5 w-5 ${n <= note ? 'fill-warn text-warn' : 'text-mute'}`} />
          </button>
        ))}
        <span className="ml-1 text-[11px] text-mute">{note ? LIBELLE[note] : '1 à 4 étoiles'}</span>
      </div>
      {note > 0 && (
        <div className="mt-2 space-y-2">
          <textarea className="input !text-[12px]" rows={2} placeholder="Commentaire (facultatif)…" value={commentaire} onChange={(e) => setCommentaire(e.target.value)} />
          <button type="button" className="btn-primary !py-1 !text-[12px]" disabled={busy} onClick={envoyer}>{busy && <Spinner />} Envoyer mon avis</button>
        </div>
      )}
      {erreur && <p role="alert" className="mt-1 text-[12px] text-ko">{erreur}</p>}
    </div>
  );
}
