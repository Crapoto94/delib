import { useIa } from './useIa';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCheck, HelpCircle, Languages, ScrollText, Sparkles, Wand2, XCircle } from 'lucide-react';
import { api, errMsg, org as orgPath } from './api';
import { useAuth } from './auth';
import { AiJob, Progress, useAiJobs } from './AiStatus';
import { Badge, Loading, Spinner } from './ui';

type Suggestion = { id: number; textId: number | null; kind: 'remplacement' | 'alerte'; categorie: string | null; gravite: 'bloquant' | 'a_revoir' | 'info' | null; analyse: string | null; find: string | null; replacement: string | null; reason: string; status: string };
type Toast = (m: string, k?: 'ok' | 'ko') => void;

const OUTILS = [
  { type: 'orthographe', label: "Vérifier l'orthographe", hint: 'Orthographe, grammaire, accords, typographie française', icon: Languages, scope: 'texte' },
  { type: 'style', label: 'Améliorer le style', hint: 'Clarté, concision, registre administratif', icon: Wand2, scope: 'texte' },
  { type: 'visas', label: 'Contrôler les visas et considérants', hint: 'Ordre, formulation, références à vérifier, cohérence', icon: ScrollText, scope: 'texte' },
  { type: 'complet', label: 'Contrôle complet du dossier', hint: 'Les trois passes + montants, annexes, incidence financière', icon: ClipboardCheck, scope: 'dossier' },
] as const;
const CAT: Record<string, string> = { orthographe: 'Orthographe', typographie: 'Typographie', style: 'Style', visa: 'Visas', coherence: 'Cohérence', completude: 'Complétude', copie: 'Copie' };
const GRAVITE: Record<string, { label: string; tone: 'ko' | 'warn' | 'gray' }> = { bloquant: { label: 'Bloquant', tone: 'ko' }, a_revoir: { label: 'À revoir', tone: 'warn' }, info: { label: 'Information', tone: 'gray' } };

/**
 * Panneau « Assistant » de l'éditeur (IA-60) : l'IA propose, l'agent valide (IA-01, IA-09). Les analyses tournent en arrière
 * plan (D52) ; chaque suggestion est une carte [Accepter] [Ignorer] [Pourquoi ?] ; accepter écrit une modification suivie (IA-62).
 */
export default function AssistantPanel({ acte, t, canEdit, beforeApply, afterApply, toast }: {
  acte: any; t: { id: number; kind: string }; canEdit: boolean; beforeApply: () => Promise<void>; afterApply: () => Promise<void>; toast: Toast;
}) {
  const { org } = useAuth(); const o = org!.id; const ia = useIa();
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null); const [why, setWhy] = useState<number | null>(null);

  const load = useCallback(async () => {
    try { setItems((await api.get(orgPath(o, `/actes/${acte.id}/ia/propositions`), { params: { statut: 'pending' } })).data.items); } catch { setItems([]); }
  }, [o, acte.id]);
  useEffect(() => { load(); }, [load, t.id]);

  const onFinished = useCallback((j: AiJob) => {
    if (j.kind !== 'analyse' && j.kind !== 'adaptation') return;
    if (j.status === 'done') { toast('Analyse terminée : les suggestions sont dans le panneau Assistant'); load(); }
    else if (j.status === 'error') toast(`L'analyse a échoué : ${j.error ?? 'IA indisponible'}`, 'ko');
  }, [load, toast]);
  const { active } = useAiJobs(onFinished, acte.id);
  const running = active.filter((j) => j.kind === 'analyse' || j.kind === 'adaptation');

  const run = async (o2: typeof OUTILS[number]) => {
    setBusy(o2.type);
    try {
      await beforeApply();
      await api.post(orgPath(o, `/actes/${acte.id}/ia/analyse`), { type: o2.type, textId: o2.scope === 'texte' ? t.id : undefined });
      toast("Demande envoyée à l'IA : elle travaille en arrière plan, vous pouvez continuer");
    } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(null); }
  };
  const decide = async (s: Suggestion, decision: 'accept' | 'reject') => {
    setBusy(`s${s.id}`);
    try {
      if (decision === 'accept') await beforeApply();
      await api.post(orgPath(o, `/actes/${acte.id}/ia/propositions/${s.id}/decision`), { decision });
      if (decision === 'accept') { await afterApply(); toast('Modification appliquée (suivie à votre nom)'); }
      await load();
    } catch (e) { toast(errMsg(e), 'ko'); await load(); } finally { setBusy(null); }
  };
  const acceptSpelling = async () => {
    setBusy('tout');
    try {
      await beforeApply();
      const r = (await api.post(orgPath(o, `/actes/${acte.id}/ia/propositions/accepter-orthographe`), { textId: t.id })).data;
      await afterApply(); toast(`${r.accepted} correction(s) appliquée(s)${r.skipped ? `, ${r.skipped} devenue(s) sans objet` : ''}`); await load();
    } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(null); }
  };

  const mine = (items ?? []).filter((s) => s.textId === t.id || s.textId === null);
  const spelling = mine.filter((s) => s.kind === 'remplacement' && (s.categorie === 'orthographe' || s.categorie === 'typographie')).length;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      <div className="border-b border-line px-4 py-3">
        <h3 className="flex items-center gap-2 text-[14px]"><Sparkles className="h-4 w-4 text-action" /> Assistant</h3>
        <p className="mt-1 rounded bg-warn-bg px-2 py-1 text-[11px] text-warn">Suggestion générée par IA — à vérifier. La responsabilité du contenu reste celle de l'agent.</p>
      </div>
      {canEdit ? (
        <div className="grid grid-cols-2 gap-2 border-b border-line p-3">
          {OUTILS.filter((x) => ia[x.type]).map((x) => (
            <button key={x.type} title={x.hint + (x.scope === 'texte' ? ' — sur ce texte' : '')} className="flex items-start gap-2 rounded border border-line bg-surface p-2 text-left hover:border-action hover:bg-soft disabled:opacity-60" disabled={!!busy} onClick={() => run(x)}>
              <x.icon className="mt-0.5 h-4 w-4 shrink-0 text-action" />
              <span className="min-w-0"><span className="block text-[12px] font-semibold leading-4">{busy === x.type && <Spinner />} {x.label}</span><span className="block text-[10px] text-mute">{x.scope === 'texte' ? 'ce texte' : 'tout le dossier'}</span></span>
            </button>))}
        </div>) : <p className="border-b border-line p-4 text-[12px] text-mute">Les outils de l'assistant sont disponibles pour celui qui a la main sur le texte.</p>}
      {running.length > 0 && (
        <ul className="space-y-2 border-b border-line bg-action/5 px-4 py-3" aria-label="Analyses en cours">{running.map((j) => (
          <li key={j.id}><div className="flex justify-between text-[12px]"><b className="flex items-center gap-1"><Sparkles className="h-3.5 w-3.5 animate-pulse text-action" /> IA au travail</b><span className="text-mute">{j.status === 'queued' ? `file : n° ${j.position}` : j.stepLabel}</span></div><Progress job={j} /></li>))}</ul>)}

      <div className="shrink-0">
        {items === null ? <Loading /> : !mine.length ? <p className="p-4 text-[12px] text-mute">Aucune suggestion en attente sur ce texte. Lancez un outil ci-dessus.</p> : (
          <>
            <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-[12px]"><b>{mine.length}</b> suggestion(s) en attente
              {canEdit && spelling > 0 && <button className="btn-ok ml-auto !py-1 !text-[11px]" disabled={!!busy} onClick={acceptSpelling}>{busy === 'tout' && <Spinner />} Tout accepter (orthographe seule : {spelling})</button>}</div>
            <ul>{mine.map((s) => {
              const g = s.gravite ? GRAVITE[s.gravite] : null;
              return (
                <li key={s.id} className="border-b border-line px-4 py-3">
                  <div className="mb-1 flex flex-wrap items-center gap-1"><Badge tone="blue">{CAT[s.categorie ?? ''] ?? s.categorie ?? 'Suggestion'}</Badge>{g && <Badge tone={g.tone}>{g.label}</Badge>}{s.textId === null && <Badge>Dossier</Badge>}</div>
                  {s.kind === 'remplacement' ? (
                    <div className="text-[13px] leading-5"><del className="mr-1 text-ko">{s.find}</del><ins className="text-ok-text no-underline">{s.replacement}</ins></div>
                  ) : <p className="text-[13px] leading-5">{s.reason}</p>}
                  {s.kind === 'remplacement' && why === s.id && <p className="mt-1 rounded bg-soft px-2 py-1 text-[12px] text-slate-700">{s.reason || 'Aucune explication fournie.'}</p>}
                  {canEdit && (
                    <div className="mt-2 flex flex-wrap gap-3">
                      {s.kind === 'remplacement' && <button className="flex items-center gap-1 text-[12px] font-semibold text-ok" disabled={!!busy} onClick={() => decide(s, 'accept')}><CheckCircle2 className="h-4 w-4" /> Accepter</button>}
                      <button className="flex items-center gap-1 text-[12px] font-semibold text-ko" disabled={!!busy} onClick={() => decide(s, 'reject')}><XCircle className="h-4 w-4" /> {s.kind === 'alerte' ? 'Écarter' : 'Ignorer'}</button>
                      {s.kind === 'remplacement' && <button className="flex items-center gap-1 text-[12px] font-semibold text-action" onClick={() => setWhy(why === s.id ? null : s.id)}><HelpCircle className="h-4 w-4" /> Pourquoi ?</button>}
                    </div>)}
                </li>);
            })}</ul>
          </>)}
      </div>
    </div>
  );
}
