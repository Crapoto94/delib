import { useEffect, useRef, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { api } from './api';

/**
 * Bandeau discret, jamais bloquant : l'espace élus permet de lire hors ligne les
 * documents déjà téléchargés (docs.ts), donc l'indisponibilité du backend ne doit
 * jamais empêcher l'accès à l'application, seulement le signaler.
 * Il faut DEUX échecs consécutifs avant d'afficher le bandeau : un simple aléa
 * réseau (timeout ponctuel, seconde de latence) ne doit pas déclencher une
 * fausse alerte « maintenance » alors que le reste de l'application fonctionne.
 */
export default function EtatBackend() {
  const [indisponible, setIndisponible] = useState(false);

  useEffect(() => {
    let annule = false;
    let echecsConsecutifs = 0;
    let derniere = 0;
    const verifier = async () => {
      const ceCoup = ++derniere;
      try {
        await api.get('/elus-auth/etat', { timeout: 5000 });
        if (annule || ceCoup !== derniere) return;
        echecsConsecutifs = 0;
        setIndisponible(false);
      } catch {
        if (annule || ceCoup !== derniere) return;
        echecsConsecutifs += 1;
        if (echecsConsecutifs >= 2) setIndisponible(true);
      }
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
