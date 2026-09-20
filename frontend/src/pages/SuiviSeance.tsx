import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Eye, FileText, Lock, LockOpen, Play, RotateCcw, Square, Users } from 'lucide-react';
import { api, errMsg, openPdf, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { AgentName } from '../AgentName';
import { dt } from '../format';
import NotesEditor from '../NotesEditor';
import { Badge, ErrorBox, Field, Loading, Modal, useToast } from '../ui';

type Presence = 'en_salle' | 'sorti' | 'absent' | 'excuse';
type Choix = 'pour' | 'contre' | 'abstention' | 'nppv';

const PRESENCE: { v: Presence; label: string; on: string }[] = [
  { v: 'en_salle', label: 'En salle', on: 'bg-ok text-white border-ok' }, { v: 'sorti', label: 'Sorti', on: 'bg-warn text-white border-warn' },
  { v: 'absent', label: 'Absent', on: 'bg-slate-500 text-white border-slate-500' }, { v: 'excuse', label: 'Excusé', on: 'bg-slate-400 text-white border-slate-400' },
];
const VOTE: { v: Choix; label: string; on: string; row: string }[] = [
  { v: 'pour', label: 'Pour', on: 'bg-ok text-white border-ok', row: 'bg-ok-bg' }, { v: 'contre', label: 'Contre', on: 'bg-ko text-white border-ko', row: 'bg-ko-bg' },
  { v: 'abstention', label: 'Abst.', on: 'bg-warn text-white border-warn', row: 'bg-warn-bg' }, { v: 'nppv', label: 'NPPV', on: 'bg-slate-600 text-white border-slate-600', row: 'bg-slate-100' },
];
const RESULTAT: Record<string, { label: string; tone: 'ok' | 'ko' }> = {
  adopte_unanimite: { label: 'Adoptée à l’unanimité', tone: 'ok' }, adopte_majorite: { label: 'Adoptée à la majorité', tone: 'ok' }, adopte_preponderante: { label: 'Adoptée (voix prépondérante du président)', tone: 'ok' },
  rejete: { label: 'Rejetée', tone: 'ko' }, rejete_preponderante: { label: 'Rejetée (voix prépondérante du président)', tone: 'ko' },
};
const ETAT: Record<string, { label: string; tone?: 'ok' | 'ko' | 'warn' | 'blue' }> = {
  a_traiter: { label: 'À traiter' }, en_cours: { label: 'En cours', tone: 'blue' }, traite: { label: 'Voté', tone: 'ok' }, sans_vote: { label: 'Sans vote', tone: 'ok' }, retire: { label: 'Retiré', tone: 'warn' }, ajourne: { label: 'Ajourné', tone: 'warn' },
};
const JOURNAL: Record<string, string> = {
  ouverture: 'Ouverture de la séance', cloture: 'Clôture de la séance', deverrouillage: 'Déverrouillage', arrivee: 'Arrivée', sortie: 'Sortie de salle', retour: 'Retour en salle', absent: 'Marqué absent', excuse: 'Marqué excusé',
  pouvoir: 'Pouvoir donné', pouvoir_retire: 'Pouvoir retiré', point: 'Point en cours', point_clos: 'Point clos', point_rouvert: 'Point rouvert', bureau: 'Bureau de séance',
};
const nom = (e: { prenom?: string; nom: string }) => `${e.prenom ? `${e.prenom} ` : ''}${e.nom.toUpperCase()}`.trim();
const hour = (d: string) => dt(d, { timeStyle: 'medium' });

function Seg<T extends string>({ value, options, onChange, disabled, size = 'md' }: { value: T | null; options: { v: T; label: string; on: string }[]; onChange: (v: T) => void; disabled?: boolean; size?: 'sm' | 'md' }) {
  return (
    <span className="inline-flex overflow-hidden rounded border border-slate-300" role="group">
      {options.map((o) => (
        <button key={o.v} type="button" disabled={disabled} aria-pressed={value === o.v} onClick={() => onChange(o.v)}
          className={`border-r border-slate-300 last:border-r-0 ${size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[12px]'} font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${value === o.v ? o.on : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{o.label}</button>))}
    </span>
  );
}

/** Zone de notes enregistrée automatiquement (sans recharger les autres écrans). */
function Notes({ resetKey, initial, onSave, placeholder }: { resetKey: string | number; initial: string; onSave: (t: string) => Promise<unknown>; placeholder: string }) {
  const [txt, setTxt] = useState(initial); const [state, setState] = useState<'ok' | 'saving' | 'dirty'>('ok'); const last = useRef(initial);
  useEffect(() => { setTxt(initial); last.current = initial; setState('ok'); }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (txt === last.current) return;
    setState('dirty');
    const t = setTimeout(async () => { setState('saving'); try { await onSave(txt); last.current = txt; setState('ok'); } catch { setState('dirty'); } }, 800);
    return () => clearTimeout(t);
  }, [txt]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <NotesEditor label={placeholder} value={txt} onChange={setTxt} placeholder={placeholder} />
      <div className="mt-1 text-right text-[11px] text-mute">{state === 'saving' ? 'Enregistrement…' : state === 'dirty' ? 'Modifications non enregistrées' : 'Enregistré'}</div>
    </div>
  );
}

/** Suivi de la séance en direct (D78) : tous ceux qui affichent la page voient en même temps le point en cours, les présences et les votes. */
export default function SuiviSeance() {
  const { id } = useParams(); const { org } = useAuth(); const o = org!.id; const sid = Number(id);
  const root = orgPath(o, `/seances/${sid}/tenue`); const { toast, node } = useToast();
  const [s, setS] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false); const [motif, setMotif] = useState<null | { titre: string; ok: (m: string) => Promise<void> }>(null);
  const version = useRef(-1);

  const apply = useCallback((d: any) => { if (d?.tenue) { version.current = d.tenue.version; setS(d); } }, []);

  // attente longue : la requête ne revient que lorsqu'un changement est enregistré (ou après 20 s), puis on repart aussitôt
  useEffect(() => {
    let stop = false; const ctl = new AbortController(); version.current = -1;
    (async () => {
      while (!stop) {
        try {
          const first = version.current < 0;
          const r = await api.get(root, { params: first ? {} : { since: version.current, wait: 20 }, timeout: 40000, signal: ctl.signal });
          if (stop) break;
          setLive(true); setErr(null);
          if (!r.data.unchanged) apply(r.data); else version.current = Math.max(version.current, r.data.version);
        } catch (e: any) {
          if (stop || e?.code === 'ERR_CANCELED') break;
          if ([403, 404].includes(e?.response?.status)) { setErr(errMsg(e)); break; }
          setLive(false); await new Promise((res) => setTimeout(res, 3000));
        }
      }
    })();
    return () => { stop = true; ctl.abort(); };
  }, [root, apply]);

  /** Toute saisie : la réponse contient l'état complet, l'écran est mis à jour tout de suite (les autres le sont par l'attente longue). */
  const act = async (fn: () => Promise<{ data: any }>, ok?: string) => {
    setBusy(true);
    try { const r = await fn(); apply(r.data); if (ok) toast(ok); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); }
  };
  const put = (p: string, b: unknown, ok?: string) => act(() => api.put(`${root}${p}`, b), ok);
  const post = (p: string, b?: unknown, ok?: string) => act(() => api.post(`${root}${p}`, b ?? {}), ok);

  /** Pièces produites depuis la séance (procès-verbal, liste des délibérations, extrait du registre) : ouvertes dans la visionneuse. */
  const piece = async (path: string, titre: string) => {
    const m = await openPdf(() => api.get(orgPath(o, `/seances/${sid}${path}`), { responseType: 'blob' }), titre);
    if (m) toast(m, 'ko');
  };
  const elus = useMemo(() => (s?.groupes ?? []).flatMap((g: any) => g.elus) as any[], [s]);
  const byId = useMemo(() => new Map(elus.map((e) => [e.id, e])), [elus]);

  if (err) return <div className="p-6"><ErrorBox msg={err} /></div>;
  if (!s) return <Loading />;
  const t = s.tenue; const can: boolean = s.peutSaisir; const ouverte = t.statut === 'ouverte'; const close = t.statut === 'close'; const c = s.courant;
  const editable = can && ouverte && !busy;
  const enCours = c?.etat === 'en_cours';

  const bulkVote = (g: any, choix: Choix | null) => put(`/points/${c.id}/votes`, { votes: g.elus.filter((e: any) => e.droit !== 'aucun').map((e: any) => ({ eluId: e.id, choix })) });
  const bulkPresence = (g: any, etat: Presence) => put('/presences', { eluIds: g.elus.map((e: any) => e.id), etat });
  const total = (k: string) => (c?.decompteLive?.[k] ?? c?.decompte?.[k] ?? 0) as number;
  const voter = (c?.decompteLive?.votants ?? 0) + (c?.decompteLive?.nppv ?? 0) + (c?.decompteLive?.manquants ?? 0);

  return (
    <div className="space-y-4">
      {node}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[12px] text-mute"><Link to={`/seances/${sid}`} className="hover:underline">← Ordre du jour</Link></div>
          <h1 className="flex items-center gap-3">Suivi de séance<span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${live ? 'bg-ok-bg text-ok-text' : 'bg-ko-bg text-ko'}`} title={live ? 'Cette page se met à jour automatiquement' : 'Connexion perdue : nouvelle tentative…'}><span className={`h-2 w-2 rounded-full ${live ? 'animate-pulse bg-ok' : 'bg-ko'}`} />{live ? 'En direct' : 'Hors ligne'}</span></h1>
          <p className="text-mute">{s.seance.instance} · {dt(s.seance.dateSeance, { dateStyle: 'full', timeStyle: 'short' })}{s.seance.lieu ? ` · ${s.seance.lieu}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={s.quorum.atteint ? 'ok' : t.statut === 'non_ouverte' ? 'gray' : 'ko'}><Users className="mr-1 inline h-3.5 w-3.5" />Quorum : {s.quorum.enSalle} en salle / {s.quorum.requis} requis ({s.quorum.membres} membres){t.statut !== 'non_ouverte' && !s.quorum.atteint ? ' — non atteint' : ''}</Badge>
          {t.statut === 'non_ouverte' && <Badge>Séance non ouverte</Badge>}{ouverte && <Badge tone="blue">Séance en cours</Badge>}{close && <Badge tone="warn"><Lock className="mr-1 inline h-3.5 w-3.5" />Séance close</Badge>}
          {can && t.statut !== 'non_ouverte' && (
            <details className="relative">
              <summary className="btn-secondary cursor-pointer list-none"><FileText className="h-4 w-4" /> Pièces de séance</summary>
              <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-line bg-white p-1 shadow-lift">
                <button className="block w-full rounded px-3 py-2 text-left text-[13px] hover:bg-soft" onClick={() => piece('/proces-verbal', 'Procès-verbal de séance')}>Procès-verbal{!close && <span className="text-mute"> (projet)</span>}</button>
                <button className="block w-full rounded px-3 py-2 text-left text-[13px] hover:bg-soft" onClick={() => piece('/proces-verbal?notes=false', 'Procès-verbal (sans les observations)')}>Procès-verbal sans les observations du secrétariat</button>
                <button className="block w-full rounded px-3 py-2 text-left text-[13px] hover:bg-soft" onClick={() => piece('/liste-deliberations', 'Liste des délibérations')}>Liste des délibérations</button>
                <p className="px-3 py-1 text-[11px] text-mute">L’extrait du registre de chaque délibération votée se trouve sur le point lui-même.</p>
              </div>
            </details>)}
          {can && t.statut === 'non_ouverte' && <button className="btn-primary" disabled={busy} onClick={() => post('/ouverture', {}, 'Séance ouverte')}><Play className="h-4 w-4" /> Ouvrir la séance</button>}
          {can && ouverte && <button className="btn-secondary" disabled={busy} onClick={() => post('/cloture', {}, 'Séance close')}><Square className="h-4 w-4" /> Clore la séance</button>}
          {can && close && <button className="btn-secondary" onClick={() => setMotif({ titre: 'Déverrouiller la séance', ok: (m) => act(() => api.post(`${root}/deverrouillage`, { motif: m }), 'Séance déverrouillée') as Promise<void> })}><LockOpen className="h-4 w-4" /> Déverrouiller</button>}
        </div>
      </div>

      {t.statut === 'non_ouverte' ? (
        <div className="card p-8 text-center text-mute">{can ? 'Ouvrez la séance pour saisir les présences, les pouvoirs et les votes.' : 'La séance n’est pas encore ouverte. Cette page se mettra à jour dès son ouverture.'}</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* ------------------------------------------------------------------ ordre du jour */}
          <aside className="card order-2 self-start overflow-hidden lg:order-1">
            <h3 className="border-b border-line px-4 py-3">Ordre du jour</h3>
            <ol className="max-h-[40vh] overflow-y-auto lg:max-h-[70vh]">
              {s.points.map((p: any) => p.kind === 'chapitre' ? (
                <li key={p.id} className="bg-soft px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-mute">{p.titre}</li>
              ) : (
                <li key={p.id}>
                  <button type="button" disabled={!editable || p.statut === 'retire'} onClick={() => put('/courant', { itemId: p.id })}
                    className={`flex w-full items-start gap-2 border-t border-line/60 px-4 py-2 text-left text-[13px] ${c?.id === p.id ? 'bg-primary text-white' : 'hover:bg-soft disabled:hover:bg-transparent'} ${p.statut === 'retire' ? 'opacity-50 line-through' : ''}`}>
                    <span className="mt-0.5 w-10 shrink-0 font-mono text-[11px] opacity-80">{p.numero || '—'}</span>
                    <span className="min-w-0 flex-1"><span className="line-clamp-2">{p.titre}</span>
                      {p.etat !== 'a_traiter' && <span className={`mt-0.5 inline-block rounded px-1.5 text-[10px] font-bold ${c?.id === p.id ? 'bg-white/20' : 'bg-slate-100 text-slate-700'}`}>{p.resultat ? RESULTAT[p.resultat].label.split(' (')[0] : ETAT[p.etat].label}</span>}</span>
                  </button>
                </li>))}
            </ol>
          </aside>

          <div className="order-1 min-w-0 space-y-4 lg:order-2">
            {/* ------------------------------------------------------------------ point en cours : affiché pour tous en même temps */}
            <section className="card p-4 shadow-lift lg:sticky lg:top-2 lg:z-20">
              {!c ? <p className="text-mute">{can && ouverte ? 'Aucun point en cours : choisissez un point dans l’ordre du jour, ou passez au suivant.' : 'Aucun point en cours pour le moment.'}</p> : (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold uppercase tracking-wider text-mute">Point en cours{c.numero ? ` · n° ${c.numero}` : ''}</div>
                      <h2 className="mt-0.5 text-[20px] leading-snug">{c.titre}</h2>
                      {c.acte && <p className="mt-1 text-[13px] text-mute">Dossier #{c.acte.numeroSuivi} · {c.acte.direction}{c.acte.rapporteur ? ` · rapporteur : ${c.acte.rapporteur}` : ''}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={ETAT[c.etat].tone}>{ETAT[c.etat].label}</Badge>{c.resultat && <Badge tone={RESULTAT[c.resultat].tone}>{RESULTAT[c.resultat].label}</Badge>}
                      {c.acte && c.etat === 'traite' && can && <button className="btn-secondary" onClick={() => piece(`/points/${c.id}/extrait`, `Extrait du registre — ${c.titre}`)}><FileText className="h-4 w-4" /> Extrait du registre</button>}
                      {c.acte && <button className="btn-secondary" onClick={async () => { const m = await openPdf(() => api.post(orgPath(o, `/actes/${c.acte.id}/apercu`), { cible: 'dossier', mode: 'propre' }, { responseType: 'blob' }), `Dossier #${c.acte.numeroSuivi} — ${c.titre}`); if (m) toast(m, 'ko'); }}><Eye className="h-4 w-4" /> Voir le dossier</button>}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {([['Pour', 'pour', 'text-ok'], ['Contre', 'contre', 'text-ko'], ['Abstention', 'abstention', 'text-warn'], ['NPPV', 'nppv', 'text-slate-600'], ['Absents', 'absents', 'text-mute']] as const).map(([l, k, cl]) => (
                      <div key={k} className="rounded border border-line p-2 text-center"><div className={`text-[26px] font-bold leading-none ${cl}`}>{total(k)}</div><div className="mt-1 text-[11px] uppercase tracking-wider text-mute">{l}</div></div>))}
                  </div>
                  {can && enCours && (
                    <div className="mt-3 rounded-lg border border-line bg-soft p-2" aria-label="Votes par groupe">
                      <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-mute"><span>Vote de tout un groupe d’un coup</span><span className="font-normal normal-case">chaque élu reste modifiable ensuite</span></div>
                      <div className="grid gap-1.5 md:grid-cols-2">
                        {s.groupes.map((g: any) => {
                          const eligibles = g.elus.filter((e: any) => e.droit !== 'aucun').length; const pour = g.elus.filter((e: any) => e.vote === 'pour').length;
                          return (
                            <div key={g.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-line bg-white px-2 py-1">
                              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: g.couleur || '#94A3B8' }} />
                              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold" title={g.nom}>{g.nom} <span className="font-normal text-mute">({eligibles} votant{eligibles > 1 ? 's' : ''}{pour ? ` · ${pour} pour` : ''})</span></span>
                              <Seg size="sm" value={null} disabled={!editable || !eligibles} options={VOTE} onChange={(v) => bulkVote(g, v)} />
                              <button className="text-[11px] text-mute hover:text-ko disabled:opacity-40" disabled={!editable || !eligibles} onClick={() => bulkVote(g, null)}>Effacer</button>
                            </div>);
                        })}
                      </div>
                    </div>)}
                  {enCours && c.decompteLive?.manquants > 0 && <p className="mt-2 text-[12px] text-warn">{c.decompteLive.manquants} élu(s) en salle n’ont pas encore de vote saisi ({voter - c.decompteLive.manquants}/{voter}).</p>}

                  {can && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                      <button className="btn-secondary" disabled={!editable} onClick={() => put('/courant', { sens: 'precedent' })}><ArrowLeft className="h-4 w-4" /> Précédent</button>
                      <button className="btn-primary" disabled={!editable} onClick={() => put('/courant', { sens: 'suivant' })}>Point suivant <ArrowRight className="h-4 w-4" /></button>
                      <span className="mx-1 h-6 w-px bg-line" />
                      {enCours && <>
                        <select className="input !w-auto !py-1 !text-[12px]" value={c.scrutin} disabled={!editable} onChange={(e) => put(`/points/${c.id}/scrutin`, { scrutin: e.target.value })} aria-label="Mode de scrutin">
                          <option value="main_levee">À main levée</option><option value="public">Scrutin public</option><option value="secret">Scrutin secret</option><option value="unanimite">Unanimité</option>
                        </select>
                        <button className="btn-primary" disabled={!editable} onClick={() => post(`/points/${c.id}/cloture`, { issue: 'vote' }, 'Vote clôturé')}>Clôturer le vote</button>
                        <button className="btn-secondary" disabled={!editable} onClick={() => post(`/points/${c.id}/cloture`, { issue: 'sans_vote' }, 'Point clos sans vote')}>Sans vote</button>
                        <button className="btn-secondary" disabled={!editable} onClick={() => post(`/points/${c.id}/cloture`, { issue: 'retire' }, 'Point retiré')}>Retiré</button>
                        <button className="btn-secondary" disabled={!editable} onClick={() => post(`/points/${c.id}/cloture`, { issue: 'ajourne' }, 'Point ajourné')}>Ajourné</button>
                      </>}
                      {c.clos && ouverte && <button className="btn-secondary" disabled={busy} onClick={() => setMotif({ titre: 'Rouvrir le point', ok: (m) => act(() => api.post(`${root}/points/${c.id}/reouverture`, { motif: m }), 'Point rouvert') as Promise<void> })}><RotateCcw className="h-4 w-4" /> Rouvrir pour corriger</button>}
                    </div>)}
                </>)}
            </section>

            {/* ------------------------------------------------------------------ notes administratives (secrétariat seulement) : visibles dès l’ouverture, sans défiler */}
            {can && (
              <div className="grid gap-4 md:grid-cols-2">
                <section className="card p-4"><h3 className="mb-2">Notes administratives de la séance</h3>
                  <Notes resetKey={sid} initial={s.notes ?? ''} placeholder="Heure d’ouverture, incidents, remarques du secrétariat…" onSave={(x) => api.put(`${root}/notes`, { notes: x })} /></section>
                <section className="card p-4"><h3 className="mb-2">Notes du point en cours</h3>
                  {c ? <Notes resetKey={c.id} initial={c.notes ?? ''} placeholder="Intervenants, résumé du débat…" onSave={(x) => api.put(`${root}/points/${c.id}/notes`, { notes: x })} /> : <p className="text-mute">Choisissez un point pour y saisir des notes.</p>}</section>
              </div>)}
            {/* ------------------------------------------------------------------ élus par groupe : présence, pouvoir, vote */}
            <section className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                <h3>Élus, présences et votes</h3>
                {can && <div className="flex flex-wrap items-center gap-3 text-[12px]">
                  <label className="flex items-center gap-1">Président de séance <select className="input !w-auto !py-1 !text-[12px]" disabled={!editable} value={t.presidentId ?? ''} onChange={(e) => put('/bureau', { presidentId: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{elus.map((e) => <option key={e.id} value={e.id}>{nom(e)}</option>)}</select></label>
                  <label className="flex items-center gap-1">Secrétaire <select className="input !w-auto !py-1 !text-[12px]" disabled={!editable} value={t.secretaireId ?? ''} onChange={(e) => put('/bureau', { secretaireId: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{elus.map((e) => <option key={e.id} value={e.id}>{nom(e)}</option>)}</select></label>
                </div>}
                {!can && (t.presidentId || t.secretaireId) && <div className="text-[12px] text-mute">{t.presidentId && <>Président : {nom(byId.get(t.presidentId) || { nom: '' })} </>}{t.secretaireId && <>· Secrétaire : {nom(byId.get(t.secretaireId) || { nom: '' })}</>}</div>}
              </div>
              {s.groupes.map((g: any) => {
                const present = g.elus.filter((e: any) => e.presence === 'en_salle').length; const eligibles = g.elus.filter((e: any) => e.droit !== 'aucun').length;
                return (
                  <div key={g.id} className="border-b border-line last:border-b-0">
                    <div className="flex flex-wrap items-center gap-3 bg-soft px-4 py-2">
                      <span className="h-3 w-3 rounded-full" style={{ background: g.couleur || '#94A3B8' }} />
                      <b className="text-[13px]">{g.nom}</b><span className="text-[12px] text-mute">{present} en salle / {g.elus.length}</span>
                      {can && (
                        <span className="ml-auto flex flex-wrap items-center gap-3">
                          <span className="flex items-center gap-1 text-[11px] text-mute">Présence du groupe
                            <button className="btn-secondary !px-2 !py-0.5 !text-[11px]" disabled={!editable} onClick={() => bulkPresence(g, 'en_salle')}>Tous en salle</button>
                            <button className="btn-secondary !px-2 !py-0.5 !text-[11px]" disabled={!editable} onClick={() => bulkPresence(g, 'absent')}>Tous absents</button></span>
                        </span>)}
                    </div>
                    <ul>
                      {g.elus.map((e: any) => {
                        const v = VOTE.find((x) => x.v === e.vote);
                        const mandant = e.pouvoirDe ? byId.get(e.pouvoirDe) : null; const mandataire = e.pouvoirA ? byId.get(e.pouvoirA) : null;
                        return (
                          <li key={e.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/60 px-4 py-1.5 ${enCours && v ? v.row : ''}`}>
                            <div className="w-56 min-w-0">
                              <div className="truncate text-[13px] font-semibold">{nom(e)}</div>
                              {e.role && <div className="truncate text-[11px] text-mute">{e.role}</div>}
                            </div>
                            <div className="flex items-center gap-2">
                              {can ? <Seg value={e.presence} options={PRESENCE} disabled={!editable} onChange={(p) => put('/presences', { eluIds: [e.id], etat: p })} />
                                : <Badge tone={e.presence === 'en_salle' ? 'ok' : e.presence === 'sorti' ? 'warn' : 'gray'}>{PRESENCE.find((x) => x.v === e.presence)?.label}</Badge>}
                            </div>
                            <div className="min-w-[170px] text-[12px]">
                              {mandant && <span className="text-mute">porte le pouvoir de <b>{nom(mandant)}</b></span>}
                              {mandataire && <span className="text-mute">pouvoir donné à <b>{nom(mandataire)}</b>{can && editable && <button className="ml-1 text-ko" onClick={() => act(() => api.delete(`${root}/procurations/${e.id}`))} aria-label="Retirer le pouvoir">✕</button>}</span>}
                              {!mandant && !mandataire && can && ouverte && e.presence !== 'en_salle' && (
                                <select className="input !w-auto !py-0.5 !text-[11px]" value="" disabled={!editable} onChange={(ev) => ev.target.value && put('/procurations', { mandantId: e.id, mandataireId: Number(ev.target.value) })} aria-label={`Pouvoir de ${nom(e)}`}>
                                  <option value="">Donner pouvoir à…</option>{elus.filter((x) => x.id !== e.id && !x.pouvoirA && !x.pouvoirDe).map((x) => <option key={x.id} value={x.id}>{nom(x)}</option>)}
                                </select>)}
                            </div>
                            <div className="ml-auto flex items-center gap-2">
                              {e.droit === 'pouvoir' && <span className="text-[11px] text-mute">vote par pouvoir</span>}
                              {enCours || c?.clos ? (
                                e.droit === 'aucun' ? <span className="text-[11px] italic text-mute">ne prend pas part au vote</span>
                                  : can && enCours ? <Seg value={e.vote} options={VOTE} disabled={!editable} onChange={(x) => put(`/points/${c.id}/votes`, { votes: [{ eluId: e.id, choix: e.vote === x ? null : x }] })} />
                                    : e.vote ? <Badge tone={e.vote === 'pour' ? 'ok' : e.vote === 'contre' ? 'ko' : e.vote === 'abstention' ? 'warn' : 'gray'}>{e.vote === 'absent' ? 'Absent' : VOTE.find((x) => x.v === e.vote)?.label}</Badge> : <span className="text-[11px] text-mute">—</span>
                              ) : null}
                            </div>
                          </li>);
                      })}
                    </ul>
                  </div>);
              })}
              {!s.groupes.length && <p className="p-4 text-mute">Aucun élu n’est enregistré pour cette instance.</p>}
            </section>

            {/* ------------------------------------------------------------------ journal (secrétariat seulement) */}
            {can && s.journal?.length > 0 && (
              <details className="card p-4">
                <summary className="cursor-pointer text-[14px] font-semibold">Journal de la séance ({s.journal.length} derniers évènements)</summary>
                <ul className="mt-2 divide-y divide-line text-[12px]">
                  {s.journal.map((j: any) => (
                    <li key={j.id} className="flex flex-wrap gap-x-3 py-1"><span className="w-20 shrink-0 font-mono text-mute">{hour(j.at)}</span><b>{JOURNAL[j.type] ?? j.type}</b>
                      {j.eluId && byId.get(j.eluId) && <span>{nom(byId.get(j.eluId))}</span>}
                      {j.detail?.motif && <span className="text-mute">— {j.detail.motif}</span>}<span className="ml-auto text-mute"><AgentName u={j.actor} /></span></li>))}
                </ul>
              </details>)}
          </div>
        </div>)}

      {motif && <MotifModal titre={motif.titre} onClose={() => setMotif(null)} onOk={async (m) => { await motif.ok(m); setMotif(null); }} />}
    </div>
  );
}

function MotifModal({ titre, onClose, onOk }: { titre: string; onClose: () => void; onOk: (m: string) => Promise<void> }): ReactNode {
  const [m, setM] = useState('');
  return (
    <Modal title={titre} onClose={onClose}>
      <Field label="Motif (obligatoire, conservé dans le journal)"><textarea className="input min-h-[80px]" autoFocus value={m} onChange={(e) => setM(e.target.value)} /></Field>
      <div className="mt-4 flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={m.trim().length < 3} onClick={() => onOk(m.trim())}>Valider</button></div>
    </Modal>
  );
}
