import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api, org as orgPath } from './api';
import { useAuth } from './auth';

export type AiJob = { id: number; acteId: number | null; kind: string; status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'; progress: number; total: number; stepLabel: string | null; position: number | null; error: string | null; finishedAt: string | null };
export const isActive = (j: AiJob) => j.status === 'queued' || j.status === 'running';

/**
 * Mes tâches IA (arrière plan, D52). Interroge la file toutes les 2 s tant qu'une tâche est active, toutes les 20 s sinon ;
 * `onFinished` est appelé quand une tâche vient de se terminer (pour recharger les propositions).
 */
export function useAiJobs(onFinished?: (j: AiJob) => void, acteId?: number) {
  const { org } = useAuth(); const o = org?.id;
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const seen = useRef<Map<number, string>>(new Map()); const first = useRef(true); const cb = useRef(onFinished);
  cb.current = onFinished;
  useEffect(() => {
    if (!o) return;
    let live = true; let timer: any;
    const load = async () => {
      let active = false;
      try {
        const items: AiJob[] = (await api.get(orgPath(o, '/ia/taches'), { params: { acteId } })).data.items;
        if (!live) return;
        for (const j of items) {
          const prev = seen.current.get(j.id);
          if (!first.current && prev && prev !== j.status && !isActive(j)) cb.current?.(j);
          seen.current.set(j.id, j.status);
        }
        first.current = false; setJobs(items); active = items.some(isActive);
      } catch { /* non bloquant */ }
      if (live) timer = setTimeout(load, active ? 2000 : 20000);
    };
    load();
    return () => { live = false; clearTimeout(timer); };
  }, [o, acteId]);
  const reload = async () => { if (o) { try { setJobs((await api.get(orgPath(o, '/ia/taches'), { params: { acteId } })).data.items); } catch { /* */ } } };
  return { jobs, active: jobs.filter(isActive), reload };
}

/** Pastille « IA au travail » de l'en-tête : visible tant qu'une de mes demandes est en attente ou en cours. */
export function AiChip() {
  const { active } = useAiJobs();
  const [open, setOpen] = useState(false);
  if (!active.length) return null;
  const running = active.filter((j) => j.status === 'running').length;
  return (
    <div className="relative">
      <button className="flex items-center gap-2 rounded-full bg-action/10 px-3 py-1.5 text-[12px] font-semibold text-action" onClick={() => setOpen(!open)} aria-label={`IA en cours : ${active.length} demande(s)`}>
        <Sparkles className="h-4 w-4 animate-pulse" /> IA {running ? 'au travail' : 'en attente'} <span className="rounded-full bg-action-solid px-1.5 text-white">{active.length}</span>
      </button>
      {open && (
        <div className="card absolute right-0 z-40 mt-2 w-80 p-3 shadow-float">
          <h3 className="mb-2 text-[14px]">Mes demandes à l'IA</h3>
          <ul className="space-y-3">{active.map((j) => (
            <li key={j.id}><div className="flex justify-between text-[12px]"><b>{j.kind === 'analyse' ? 'Analyse' : 'Adaptation'} du dossier #{j.acteId}</b><span className="text-mute">{j.status === 'queued' ? `file : n° ${j.position}` : j.stepLabel}</span></div>
              <Progress job={j} /></li>))}</ul>
          <p className="mt-2 text-[11px] text-mute">L'IA travaille en arrière plan : vous pouvez continuer à utiliser l'application. Vous serez prévenu(e) à la fin.</p>
        </div>)}
    </div>
  );
}

export function Progress({ job }: { job: AiJob }) {
  const pct = job.status === 'queued' ? 0 : job.total ? Math.round((job.progress / job.total) * 100) : 10;
  return (
    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full bg-action-solid transition-all ${job.status === 'running' && !job.total ? 'animate-pulse' : ''}`} style={{ width: `${Math.max(pct, job.status === 'running' ? 8 : 0)}%` }} />
    </div>
  );
}
