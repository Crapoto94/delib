import { useState } from 'react';
import { ChevronDown, Users, X } from 'lucide-react';
import { api } from './api';

type Membre = { nom: string; delegation: string | null };

const partsOf = (d: string | null) => (d ? d.split(';').map((p) => p.trim()).filter(Boolean) : []);

/** « Mon groupe : xxx » dans l'en-tête ; au clic, liste les membres (soi-même + collègues du même groupe), nom et prénom
 * seulement, avec le nombre de délégations — le détail se déroule au clic plutôt que de s'afficher en permanence. */
export default function GroupePopover({ groupe, moi, delegation }: { groupe: string; moi: string; delegation: string | null }) {
  const [ouvert, setOuvert] = useState(false);
  const [membres, setMembres] = useState<Membre[] | null>(null);
  const [deroule, setDeroule] = useState<string | null>(null);

  const ouvrir = async () => {
    setOuvert(true);
    if (membres) return;
    try {
      const r = await api.get('/elus/collegues');
      const autres = (r.data.items as { nom: string; groupe: string | null; delegation: string | null }[]).filter((c) => c.groupe === groupe).map((c) => ({ nom: c.nom, delegation: c.delegation }));
      setMembres([{ nom: moi, delegation }, ...autres].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')));
    } catch { setMembres([]); }
  };

  return (
    <div className="relative min-w-0 shrink">
      <button onClick={() => (ouvert ? setOuvert(false) : ouvrir())} title={`Mon groupe : ${groupe}`}
        className="flex max-w-[38vw] items-center gap-1 truncate rounded px-2 py-1 text-[13px] text-white/80 hover:bg-white/10 hover:text-white sm:max-w-[220px]">
        <span className="shrink-0">Mon groupe :</span> <span className="truncate font-semibold">{groupe}</span>
      </button>
      {ouvert && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOuvert(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded-lg border border-line bg-surface p-3 text-ink shadow-float">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold"><Users className="h-4 w-4" /> {groupe}</span>
              <button onClick={() => setOuvert(false)} aria-label="Fermer" className="rounded p-0.5 text-mute hover:bg-soft"><X className="h-4 w-4" /></button>
            </div>
            {!membres ? <p className="text-[13px] text-mute">Chargement…</p>
              : membres.length === 0 ? <p className="text-[13px] text-mute">Aucun membre.</p>
              : (
                <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto text-[13px]">
                  {membres.map((m) => {
                    const parts = partsOf(m.delegation);
                    const estDeroule = deroule === m.nom;
                    return (
                      <li key={m.nom} className="border-b border-line/60 py-1 last:border-0">
                        <button
                          onClick={() => parts.length && setDeroule(estDeroule ? null : m.nom)}
                          disabled={!parts.length}
                          className="flex w-full items-center justify-between gap-2 py-0.5 text-left disabled:cursor-default"
                        >
                          <span className="font-semibold">{m.nom}</span>
                          {parts.length > 0 && (
                            <span className="flex shrink-0 items-center gap-1 text-[12px] text-mute">
                              {parts.length} délégation{parts.length > 1 ? 's' : ''}
                              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${estDeroule ? 'rotate-180' : ''}`} />
                            </span>
                          )}
                        </button>
                        {estDeroule && (
                          <ul className="mt-1 space-y-0.5 pl-2 text-[12px] text-mute">
                            {parts.map((p, i) => <li key={i}>{p}</li>)}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
          </div>
        </>
      )}
    </div>
  );
}
