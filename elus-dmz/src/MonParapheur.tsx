import { useState } from 'react';
import { FileSignature, Loader2 } from 'lucide-react';
import { api, errMsg } from './api';

/** « Mon parapheur » : ouvre le Hub DSI, déjà authentifié, sur la boîte de signature propre à l'élu. */
export default function MonParapheur() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ouvrir = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post('/elus/parapheur/acces');
      const w = window.open(r.data.url, '_blank', 'noopener,noreferrer');
      if (!w) setErr('Le navigateur a bloqué l’ouverture de l’onglet : autorisez les pop-up pour ce site.');
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="relative shrink-0">
      <button onClick={ouvrir} disabled={busy} className="rounded p-2 text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-60" aria-label="Mon parapheur" title="Mon parapheur">
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileSignature className="h-5 w-5" />}
      </button>
      {err && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-ko/30 bg-surface p-3 text-[13px] text-ko shadow-float">
          {err}
        </div>
      )}
    </div>
  );
}
