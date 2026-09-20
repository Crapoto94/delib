import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { api, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { useLoad } from '../ui';

type Etape = { cle: string; label: string; lien: string; etat: 'fait' | 'en_cours' | 'a_venir'; date: string | null; retient: string[] };

/**
 * Workflow de la séance (SEA-13, D105) : Rédaction → Préparation → Convocation → Séance → Après la séance → Clôture.
 * Même présentation que la frise du circuit d'un dossier ; l'étape se déduit des faits (rien à cocher). Un clic ouvre l'écran concerné.
 * Réservé à l'administration et au SCC : pour les autres, la frise n'apparaît pas.
 */
export default function FriseSeance({ seanceId, rev = 0 }: { seanceId: number; rev?: number }) {
  const { org } = useAuth(); const o = org!.id; const nav = useNavigate();
  const d = useLoad(async () => { try { return (await api.get(orgPath(o, `/seances/${seanceId}/parcours`))).data; } catch { return null; } }, [o, seanceId, rev]);
  if (!d.data || d.data.annulee) return d.data?.annulee ? <p className="rounded bg-warn-bg px-3 py-2 text-[13px] text-warn">Séance annulée.</p> : null;
  const etapes: Etape[] = d.data.etapes;
  return (
    <div className="card p-4" data-tour="workflow-seance">
      <ol className="flex gap-2 overflow-x-auto pb-1" aria-label="Workflow de la séance">
        {etapes.map((e, i) => {
          const cur = e.etat === 'en_cours'; const fait = e.etat === 'fait';
          return (
            <li key={e.cle} className="min-w-[150px] flex-1">
              <button type="button" onClick={() => nav(`/seances/${seanceId}${e.lien}`)} aria-current={cur ? 'step' : undefined}
                className={`h-full w-full rounded-lg border p-3 text-left transition-colors ${cur ? 'border-primary bg-primary text-white' : fait ? 'border-ok/30 bg-surface hover:bg-soft' : 'border-line bg-surface/60 hover:bg-soft'}`}>
                <div className="flex items-center gap-2">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${fait ? 'bg-ok-solid text-white' : cur ? 'bg-action-solid text-white ring-4 ring-action/30' : 'bg-line text-slate-600'}`}>{fait ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
                  <span className="truncate text-[12px] font-bold">{e.label}</span>
                </div>
                <div className={`mt-1 text-[11px] ${cur ? 'text-white/80' : 'text-mute'}`}>
                  {fait ? (e.date ? dt(e.date, { dateStyle: 'short' }) : 'terminée') : cur ? (e.retient.length ? e.retient.map((r, k) => <div key={k} className="font-semibold">• {r}</div>) : 'en cours') : 'à venir'}
                </div>
              </button>
            </li>);
        })}
      </ol>
      {d.data.terminee && <p className="mt-2 text-[12px] font-semibold text-ok">La séance est terminée : tout est transmis et archivé.</p>}
    </div>
  );
}
