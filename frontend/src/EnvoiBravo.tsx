import { CSSProperties, useMemo } from 'react';
import { PartyPopper } from 'lucide-react';
import { AgentNames } from './AgentName';

const COULEURS = ['rgb(var(--c-action))', 'rgb(var(--c-ok))', 'rgb(var(--c-warn))', 'rgb(var(--c-ko))', 'rgb(var(--c-violet))', 'rgb(var(--c-azur))'];

/** Mini feu d'artifice (CSS pur) : quelques étincelles qui partent du centre et retombent. */
export function FeuArtifice({ nombre = 30 }: { nombre?: number }) {
  const parts = useMemo(() => Array.from({ length: nombre }, (_, i) => {
    const angle = (i / nombre) * Math.PI * 2 + (i % 3) * 0.18;
    const dist = 55 + ((i * 37) % 75);
    return { dx: Math.round(Math.cos(angle) * dist), dy: Math.round(Math.sin(angle) * dist) - 24, c: COULEURS[i % COULEURS.length], delay: (i % 5) * 0.05 };
  }), [nombre]);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-8 flex justify-center" aria-hidden="true">
      <div className="relative h-0 w-0">
        {parts.map((p, i) => (
          <span key={i} className="feu absolute left-0 top-0 h-1.5 w-1.5 rounded-full"
            style={{ background: p.c, animationDelay: `${p.delay}s`, '--dx': `${p.dx}px`, '--dy': `${p.dy}px` } as CSSProperties} />
        ))}
      </div>
    </div>
  );
}

/**
 * Félicitations après l'envoi d'un dossier au circuit : rappelle qu'il part en relecture auprès du prochain
 * valideur et poursuit son chemin. Un petit feu d'artifice marque l'événement (sans mouvement si l'utilisateur le refuse).
 */
export default function EnvoiBravo({ data, premier, onClose }: { data: any; premier: boolean; onClose: () => void }) {
  const etape = data?.path?.find((p: any) => p.state === 'current');
  const holders: string[] = (etape?.holders ?? []).filter(Boolean);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true" aria-labelledby="envoi-bravo">
      <div className="relative w-full max-w-md overflow-hidden rounded-lg bg-surface p-6 text-center shadow-float">
        <FeuArtifice />
        <PartyPopper className="mx-auto mt-2 h-10 w-10 text-ok" />
        <h2 id="envoi-bravo" className="mt-2 text-[20px]">Bravo !</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-slate-700">
          Vous avez envoyé <b>{premier ? 'votre premier dossier' : 'votre dossier'}</b>. Il est en relecture
          {holders.length ? <> auprès de <b><AgentNames list={holders} /></b></> : ' auprès du prochain valideur'}
          {etape?.label ? <> (étape « {etape.label} »)</> : null}, et poursuivra son chemin dans le circuit de validation.
        </p>
        <p className="mt-2 text-[12px] text-mute">Vous serez prévenu·e à chaque étape, et ramené·e ici si une modification est demandée.</p>
        <button className="btn-primary mt-5" autoFocus onClick={onClose}>Continuer</button>
      </div>
    </div>
  );
}
