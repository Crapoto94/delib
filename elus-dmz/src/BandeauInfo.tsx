import { useEffect, useState } from 'react';
import { Siren } from 'lucide-react';
import { api } from './api';

/**
 * Bandeau d'information : message défilant, rouge vif, défini par le SCC ou l'administrateur et affiché aux élus comme aux agents entre deux dates.
 * Défilement en pause au survol ; avec « réduire les animations » activé dans le système, le texte est fixe et passe à la ligne.
 */
export default function BandeauInfo() {
  const [messages, setMessages] = useState<string[]>([]);
  useEffect(() => {
    let vivant = true;
    const charger = () => { api.get('/elus/bandeaux').then((r) => { if (vivant) setMessages((r.data.items as { message: string }[]).map((x) => x.message)); }).catch(() => { /* le bandeau n'est jamais bloquant */ }); };
    charger();
    const t = setInterval(charger, 5 * 60 * 1000);
    const f = () => { if (document.visibilityState === 'visible') charger(); };
    document.addEventListener('visibilitychange', f);
    return () => { vivant = false; clearInterval(t); document.removeEventListener('visibilitychange', f); };
  }, []);
  if (!messages.length) return null;
  const texte = messages.join('   ●   ');
  return (
    <div role="status" aria-live="polite" className="vd-bandeau flex items-stretch border-b-4 border-[#7f1d1d] bg-[#dc2626] text-white shadow-lg">
      <span className="flex shrink-0 items-center gap-2 bg-[#7f1d1d] px-3 text-[12px] font-extrabold uppercase tracking-widest"><Siren className="h-5 w-5 animate-pulse" aria-hidden="true" /> Information</span>
      <div className="min-w-0 flex-1 overflow-hidden py-2">
        <span className="vd-bandeau-piste text-[15px] font-bold" style={{ ['--vd-duree' as string]: `${Math.max(18, Math.round(texte.length * 0.28 + 12))}s` }}>{texte}</span>
      </div>
    </div>
  );
}
