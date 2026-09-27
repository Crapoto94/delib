import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { api } from './api';

/**
 * Bandeau discret, jamais bloquant : l'espace élus permet de lire hors ligne les
 * documents déjà téléchargés (docs.ts), donc l'indisponibilité du backend ne doit
 * jamais empêcher l'accès à l'application, seulement le signaler.
 */
export default function EtatBackend() {
  const [indisponible, setIndisponible] = useState(false);

  useEffect(() => {
    let annule = false;
    const verifier = async () => {
      try { await api.get('/elus-auth/etat', { timeout: 5000 }); if (!annule) setIndisponible(false); }
      catch { if (!annule) setIndisponible(true); }
    };
    verifier();
    const id = setInterval(verifier, 20000);
    return () => { annule = true; clearInterval(id); };
  }, []);

  if (!indisponible) return null;
  return (
    <div role="status" className="mb-3 flex items-center gap-2 rounded border border-warn/30 bg-warn-bg px-3 py-2 text-[13px] text-warn">
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>Le système est actuellement en maintenance — la connexion n'est pas possible pour le moment. Les documents déjà téléchargés restent consultables.</span>
    </div>
  );
}
