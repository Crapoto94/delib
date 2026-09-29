import { useEffect, useState } from 'react';
import { Download, Loader2, RefreshCw, X } from 'lucide-react';
import { apiBase, isNativeApp } from './api';

/**
 * Mise à jour de l'APK : l'application installée compare son identifiant de build à celui publié sur l'instance
 * (`/apk/latest.json`, écrit au moment où l'on publie l'APK). Si la tablette est en retard :
 *  - l'APK est téléchargée en arrière-plan dès la détection (plugin natif `AppUpdater`) ;
 *  - un seul geste reste à faire : le bouton ouvre l'écran d'installation du système, puis l'application se relance.
 * Android n'autorise pas l'installation totalement muette hors Play Store / MDM ; c'est le plus transparent possible.
 */
type Manifeste = { version?: string; buildTime?: string; url?: string; notes?: string };
type Etat = 'detectee' | 'telechargee' | 'ouverture' | 'permission' | 'erreur';

type PluginUpdater = { download: (o: { url: string }) => Promise<unknown>; install: (o: { url: string }) => Promise<{ status?: string }> };

/** Plugin natif exposé par le pont Capacitor (voir AppUpdaterPlugin.java). Absent dans un navigateur. */
const pluginUpdater = (): PluginUpdater | null => {
  try { const c = (window as any).Capacitor; return isNativeApp() && c?.Plugins?.AppUpdater ? (c.Plugins.AppUpdater as PluginUpdater) : null; } catch { return null; }
};

const adresseManifeste = () => { try { return new URL('/apk/latest.json', new URL(apiBase, location.origin)).toString(); } catch { return '/apk/latest.json'; } };
const adresseApk = (m: Manifeste) => { try { return new URL(m.url || '/apk/vibedelib-elus.apk', new URL(apiBase, location.origin)).toString(); } catch { return m.url || '/apk/vibedelib-elus.apk'; } };
const quand = (iso?: string) => { try { return iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : ''; } catch { return ''; } };

export default function MiseAJour() {
  const [dispo, setDispo] = useState<Manifeste | null>(null);
  const [ignore, setIgnore] = useState<string | null>(null);
  const [etat, setEtat] = useState<Etat>('detectee');
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    if (!isNativeApp()) return; // jamais de relance de mise à jour dans le navigateur
    let live = true;
    const verifier = async () => {
      try {
        const r = await fetch(adresseManifeste(), { cache: 'no-store' });
        if (!r.ok) return;
        const m = await r.json() as Manifeste;
        if (!live || !m.buildTime || m.buildTime <= __BUILD_TIME__) return;
        setDispo(m);
        // Téléchargement en arrière-plan : le bouton n'aura plus qu'à ouvrir l'installateur.
        void pluginUpdater()?.download({ url: adresseApk(m) }).catch(() => undefined);
      } catch { /* hors ligne : nouvel essai au prochain retour au premier plan */ }
    };
    void verifier();
    const auRetour = () => { if (document.visibilityState === 'visible') void verifier(); };
    document.addEventListener('visibilitychange', auRetour);
    return () => { live = false; document.removeEventListener('visibilitychange', auRetour); };
  }, []);

  if (!dispo || ignore === dispo.buildTime) return null;
  const url = adresseApk(dispo);

  const lancer = async () => {
    setDetail(null);
    const p = pluginUpdater();
    if (!p) { window.open(url, '_blank', 'noopener,noreferrer'); setEtat('ouverture'); return; } // navigateur : repli
    setEtat('ouverture');
    try {
      const r = await p.install({ url });
      if (r?.status === 'permission') { setEtat('permission'); return; }
      setEtat('telechargee'); // l'écran d'installation du système est ouvert
    } catch (e: any) { setEtat('erreur'); setDetail(e?.message || 'Mise à jour impossible'); }
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-3 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[420px]">
      <div role="alertdialog" aria-label="Mise à jour disponible" className="rounded-xl border border-action/40 border-t-4 border-t-action-solid bg-surface p-4 shadow-float">
        <div className="flex items-start gap-3">
          <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-action" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] leading-snug text-head">Mise à jour disponible</h2>
            <p className="mt-1 text-[13px] text-mute">
              Une nouvelle version de l’espace élus est disponible{dispo.buildTime ? ` (build du ${quand(dispo.buildTime)})` : ''}. Elle est téléchargée automatiquement ; il ne reste qu’à confirmer l’installation.
            </p>
            {dispo.notes && <p className="mt-1 text-[13px] text-ink">{dispo.notes}</p>}
            {etat === 'permission' && <p className="mt-2 rounded bg-warn-bg px-2 py-1.5 text-[13px] text-warn">Autorisez « VibeDélib Élus » à installer des applications, puis touchez de nouveau le bouton.</p>}
            {etat === 'telechargee' && <p className="mt-2 rounded bg-ok-bg px-2 py-1.5 text-[13px] text-ok-text">Suivez l’écran d’installation d’Android. L’application se relancera ensuite.</p>}
            {etat === 'erreur' && <p className="mt-2 rounded bg-ko-bg px-2 py-1.5 text-[13px] text-ko">{detail}</p>}
          </div>
          <button onClick={() => setIgnore(dispo.buildTime!)} aria-label="Plus tard" className="rounded p-1 text-mute hover:bg-soft"><X className="h-4 w-4" /></button>
        </div>
        <button onClick={lancer} className="btn-primary mt-3 w-full !py-3 !text-[15px]">
          {etat === 'ouverture' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Installer la mise à jour
        </button>
      </div>
    </div>
  );
}
