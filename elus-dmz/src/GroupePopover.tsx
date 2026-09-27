import { useState } from 'react';
import { Users, X } from 'lucide-react';
import { api } from './api';

/** « Mon groupe : xxx » dans l'en-tête ; au clic, liste les membres (soi-même + collègues du même groupe). */
export default function GroupePopover({ groupe, moi }: { groupe: string; moi: string }) {
  const [ouvert, setOuvert] = useState(false);
  const [membres, setMembres] = useState<string[] | null>(null);

  const ouvrir = async () => {
    setOuvert(true);
    if (membres) return;
    try {
      const r = await api.get('/elus/collegues');
      const autres = (r.data.items as { nom: string; groupe: string | null }[]).filter((c) => c.groupe === groupe).map((c) => c.nom);
      setMembres([moi, ...autres].sort((a, b) => a.localeCompare(b, 'fr')));
    } catch { setMembres([]); }
  };

  return (
    <div className="relative">
      <button onClick={() => (ouvert ? setOuvert(false) : ouvrir())} className="rounded px-2 py-1 text-[13px] text-white/80 hover:bg-white/10 hover:text-white">
        Mon groupe : <span className="font-semibold">{groupe}</span>
      </button>
      {ouvert && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOuvert(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-line bg-surface p-3 text-ink shadow-float">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold"><Users className="h-4 w-4" /> {groupe}</span>
              <button onClick={() => setOuvert(false)} aria-label="Fermer" className="rounded p-0.5 text-mute hover:bg-soft"><X className="h-4 w-4" /></button>
            </div>
            {!membres ? <p className="text-[13px] text-mute">Chargement…</p>
              : membres.length === 0 ? <p className="text-[13px] text-mute">Aucun membre.</p>
              : <ul className="space-y-1 text-[13px]">{membres.map((n) => <li key={n}>{n}</li>)}</ul>}
          </div>
        </>
      )}
    </div>
  );
}
