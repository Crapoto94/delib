import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

/**
 * Thème clair / sombre / automatique (UI-04, D99). Le choix est mémorisé sur l'appareil ; « auto » suit le réglage du système.
 * Le même script d'initialisation est en tête de index.html et elus.html pour éviter tout clignotement au chargement.
 */
export type ThemeChoice = 'auto' | 'light' | 'dark';
const KEY = 'vd-theme';
const ORDRE: ThemeChoice[] = ['auto', 'light', 'dark'];
const LIB: Record<ThemeChoice, string> = { auto: 'Automatique (suit l’appareil)', light: 'Clair', dark: 'Sombre' };

export function themeChoisi(): ThemeChoice {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark') return v; } catch { /* stockage indisponible */ }
  return 'auto';
}

export function appliquerTheme(c: ThemeChoice) {
  const el = document.documentElement;
  if (c === 'auto') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', c);
  const sombre = c === 'dark' || (c === 'auto' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', sombre ? '#0B1220' : '#0F2942');
}

export function useTheme() {
  const [choix, setChoix] = useState<ThemeChoice>(themeChoisi);
  useEffect(() => {
    const h = (e: StorageEvent) => { if (e.key === KEY) { const c = themeChoisi(); setChoix(c); appliquerTheme(c); } };
    window.addEventListener('storage', h); return () => window.removeEventListener('storage', h);
  }, []);
  const regler = (c: ThemeChoice) => {
    try { if (c === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, c); } catch { /* le réglage vaut pour cette session */ }
    setChoix(c); appliquerTheme(c);
  };
  return { choix, regler, suivant: () => regler(ORDRE[(ORDRE.indexOf(choix) + 1) % ORDRE.length]) };
}

const ICONE = { auto: Monitor, light: Sun, dark: Moon } as const;

/** Bouton d'en-tête : fait défiler Automatique → Clair → Sombre. */
export function ThemeToggle({ className = 'text-mute hover:bg-slate-100' }: { className?: string }) {
  const { choix, suivant } = useTheme(); const I = ICONE[choix];
  return <button type="button" className={`rounded p-2 ${className}`} onClick={suivant} title={`Thème : ${LIB[choix]} (cliquer pour changer)`} aria-label={`Thème : ${LIB[choix]}. Changer de thème`}><I className="h-5 w-5" /></button>;
}

/** Choix explicite en trois boutons (menu utilisateur). */
export function ThemeSwitch() {
  const { choix, regler } = useTheme();
  return (
    <div role="radiogroup" aria-label="Thème" className="flex gap-1 rounded bg-slate-100 p-1">
      {ORDRE.map((c) => { const I = ICONE[c]; return (
        <button key={c} type="button" role="radio" aria-checked={choix === c} title={LIB[c]} onClick={() => regler(c)}
          className={`flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-[12px] font-semibold ${choix === c ? 'bg-surface text-head shadow-card' : 'text-mute hover:text-ink'}`}>
          <I className="h-3.5 w-3.5" />{c === 'auto' ? 'Auto' : c === 'light' ? 'Clair' : 'Sombre'}
        </button>); })}
    </div>
  );
}
