import { ReactNode, useEffect, useState } from 'react';

declare global { interface Window { Capacitor?: { isNativePlatform?: () => boolean } } }

/** Vrai dans l'APK (WebView Capacitor) : jamais de cadre, l'appareil est déjà une tablette. */
function estAppNative(): boolean {
  try { return window.Capacitor?.isNativePlatform?.() === true; } catch { return false; }
}

/**
 * Simulation d'une tablette (type Samsung Galaxy Tab A11+, écran 11" en 5:8) autour de
 * l'écran de connexion quand l'espace élus est ouvert dans un navigateur classique :
 * rappelle que l'accès prévu est l'appareil fourni, sans jamais gêner l'usage réel sur
 * un téléphone (pas de cadre si l'écran est trop étroit pour l'accueillir).
 */
export default function TabletFrame({ children }: { children: ReactNode }) {
  const [actif, setActif] = useState(false);

  useEffect(() => {
    if (estAppNative()) { setActif(false); return; }
    const mq = window.matchMedia('(min-width: 640px) and (min-height: 700px)');
    const maj = () => setActif(mq.matches);
    maj();
    mq.addEventListener('change', maj);
    return () => mq.removeEventListener('change', maj);
  }, []);

  if (!actif) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-nav-from to-nav-to p-6">
      <div className="relative w-[420px] rounded-[42px] bg-[#1b1d21] p-3 shadow-float" style={{ aspectRatio: '5 / 8' }}>
        <div className="absolute left-1/2 top-3 h-[6px] w-[6px] -translate-x-1/2 rounded-full bg-black/60 ring-2 ring-black/20" aria-hidden="true" />
        <div className="h-full w-full overflow-hidden rounded-[30px] bg-page">
          <div className="h-full w-full overflow-y-auto">{children}</div>
        </div>
        <div className="pointer-events-none absolute inset-3 rounded-[30px] ring-1 ring-white/10" aria-hidden="true" />
      </div>
    </div>
  );
}
