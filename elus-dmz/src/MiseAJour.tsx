import { useEffect, useState } from 'react';
import { Download, Loader2, RefreshCw, X } from 'lucide-react';
import { apiBase, isNativeApp } from './api';

/**
 * Mise à jour de l'APK : l'application installée compare son identifiant de build à celui publié sur l'instance
 * (`/apk/latest.json`, écrit au moment où l'on publie l'APK). Si la tablette est en retard, on propose de
 * télécharger la nouvelle version ; Android enchaîne sur l'installation.
 *
 * Pas de mise à jour silencieuse possible pour une APK installée hors magasin : Android l'interdit. On s'en
 * approche au plus près — détection automatique au lancement et au retour au premier plan, et un seul geste à
 * faire (télécharger, installer).
 */
type Manifeste = { version?: string; buildTime?: string; url?: string; notes?: string };

const adresseManifeste = () => { try { return new URL('/apk/latest.json', new URL(apiBase, location.origin)).toString(); } catch { return '/apk/latest.json'; } };
const adresseApk = (m: Manifeste) => { try { return new URL(m.url || '/apk/vibedelib-elus.apk', new URL(apiBase, location.origin)).toString(); } catch { return m.url || '/apk/vibedelib-elus.apk'; } };

const quand = (iso?: string) => { try { return iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : ''; } catch { return ''; } };

export default function MiseAJour() {
  const [dispo, setDispo] = useState<Manifeste | null>(null);
  const [ignore, setIgnore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isNativeApp()) return; // jamais de relance de mise à jour dans le navigateur
    let live = true;
    const verifier = async () => {
      try {
        const r = await fetch(adresseManifeste(), { cache: 'no-store' });
        if (!r.ok) return;
        const m = await r.json() as Manifeste;
        if (live && m.buildTime && m.buildTime > __BUILD_TIME__) setDispo(m);
      } catch { /* hors ligne : nouvel essai au prochain retour au premier plan */ }
    };
    void verifier();
    const auRetour = () => { if (document.visibilityState === 'visible') void verifier(); };
    document.addEventListener('visibilitychange', auRetour);
    return () => { live = false; document.removeEventListener('visibilitychange', auRetour); };
  }, []);

  if (!dispo || ignore === dispo.buildTime) return null;
  const url = adresseApk(dispo);

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-3 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[420px]">
      <div role="alertdialog" aria-label="Mise à jour disponible" className="rounded-xl border border-action/40 border-t-4 border-t-action-solid bg-surface p-4 shadow-float">
        <div className="flex items-start gap-3">
          <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-action" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] leading-snug text-head">Mise à jour disponible</h2>
            <p className="mt-1 text-[13px] text-mute">
              Une nouvelle version de l’espace élus est disponible{dispo.version ? ` (${dispo.version}` : ''}{dispo.buildTime ? `${dispo.version ? ', ' : ' ('}build du ${quand(dispo.buildTime)})` : ''}. Installez-la pour bénéficier des dernières corrections.
            </p>
            {dispo.notes && <p className="mt-1 text-[13px] text-ink">{dispo.notes}</p>}
          </div>
          <button onClick={() => setIgnore(dispo.buildTime!)} aria-label="Plus tard" className="rounded p-1 text-mute hover:bg-soft"><X className="h-4 w-4" /></button>
        </div>
        <a className="btn-primary mt-3 w-full !py-3 !text-[15px]" href={url} target="_blank" rel="noopener noreferrer" onClick={() => setBusy(true)}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Télécharger la mise à jour
        </a>
        <p className="mt-2 text-center text-[12px] text-mute">Le téléchargement s’ouvre dans le navigateur ; touchez le fichier pour installer.</p>
      </div>
    </div>
  );
}
