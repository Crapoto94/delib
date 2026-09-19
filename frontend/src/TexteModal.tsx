import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Eye, X, XCircle } from 'lucide-react';
import { api, errMsg, openPdf, org as orgPath } from './api';
import { useAuth } from './auth';
import { dt } from './format';
import { Loading } from './ui';
import RichEditor, { EditorMode } from './RichEditor';

export const KIND_LABEL: Record<string, string> = { expose: 'Exposé des motifs', visas: 'Vu et considérant', dispositif: 'Délibéré' };
const PLACEHOLDER: Record<string, string> = {
  expose: "Résumez l'intérêt communal en quelques paragraphes simples, sans jargon juridique…",
  visas: 'Vu le code général des collectivités territoriales…\n\nConsidérant que…',
  dispositif: 'Article 1 : …',
};

export function SpanView({ spans }: { spans: any[] }) {
  return <div className="whitespace-pre-wrap text-[16px] leading-[26px]">{spans.map((s, i) => s.type === 'insert'
    ? <ins key={i} style={{ color: s.color, background: `${s.color}1A`, textDecoration: 'none', fontWeight: 600 }} title={`${s.name || s.author}`}>{s.text}</ins>
    : s.type === 'delete' ? <del key={i} style={{ color: s.color, opacity: 0.8 }} title={`${s.name || s.author}`}>{s.text}</del> : <span key={i}>{s.text}</span>)}</div>;
}

type Toast = (m: string, k?: 'ok' | 'ko') => void;

/** Un texte dans la modale : chargement, enregistrement automatique avec contrôle de version, modifications suivies. */
function Pane({ acte, t, editable, onChanged, toast, registerFlush }: { acte: any; t: any; editable: boolean; onChanged: () => void; toast: Toast; registerFlush: (fn: (() => Promise<void>) | null) => void }) {
  const { org } = useAuth(); const o = org!.id;
  const base = orgPath(o, `/actes/${acte.id}/textes/${t.id}`);
  const [view, setView] = useState<any>(null);
  const [mode, setMode] = useState<'edition' | 'suivi' | 'propre'>('edition');
  const [text, setText] = useState('');
  const [state, setState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [conflict, setConflict] = useState(false);
  const timer = useRef<any>(null); const latest = useRef({ text: '', version: 1, dirty: false });

  const load = useCallback(async () => {
    const r = (await api.get(base, { params: { mode: mode === 'propre' ? 'propre' : 'suivi' } })).data;
    setView(r);
    if (!latest.current.dirty) { setText(r.markdown); latest.current.text = r.markdown; }
    latest.current.version = r.version; setState(latest.current.dirty ? 'dirty' : 'saved');
  }, [base, mode]);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const commit = useCallback(async () => {
    clearTimeout(timer.current);
    if (!latest.current.dirty) return;
    setState('saving');
    try {
      const r = (await api.put(base, { markdown: latest.current.text, baseVersion: latest.current.version })).data;
      latest.current.version = r.version; latest.current.dirty = false; setConflict(false); setState('saved');
      if (r.changed) { await load(); onChanged(); }
    } catch (e: any) {
      if (e.response?.status === 409 && e.response.data?.details?.currentVersion) setConflict(true); else toast(errMsg(e), 'ko');
      setState('error');
    }
  }, [base, load, onChanged, toast]);
  useEffect(() => { registerFlush(commit); return () => registerFlush(null); }, [commit, registerFlush]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const change = (md: string) => { setText(md); latest.current.text = md; latest.current.dirty = true; setState('dirty'); clearTimeout(timer.current); timer.current = setTimeout(commit, 1200); };
  const resolve = async (decision: 'accept' | 'reject', cid?: string) => {
    try { await commit(); await api.post(`${base}/modifications`, cid ? { decision, cids: [cid] } : { decision, all: true }); latest.current.dirty = false; await load(); onChanged(); } catch (e) { toast(errMsg(e), 'ko'); }
  };
  const preview = async () => {
    await commit();
    const m = await openPdf(() => api.post(orgPath(o, `/actes/${acte.id}/apercu`), { cible: t.kind === 'expose' ? 'expose' : 'deliberation', deliberationId: t.deliberationId ?? undefined, mode: view?.tracking ? 'suivi' : 'propre' }, { responseType: 'blob' }));
    if (m) toast(`Aperçu impossible : ${m}`, 'ko');
  };
  if (!view) return <Loading />;
  const canEdit = editable && view.canEdit;
  const tracking = view.tracking && view.changes?.length > 0;
  const editing = canEdit && mode === 'edition';

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-white px-4 py-2 text-[12px]">
          {view.tracking && <div className="flex rounded bg-soft p-0.5">{([['edition', canEdit ? 'Éditer' : 'Lire'], ['suivi', 'Modifications suivies'], ['propre', 'Version propre']] as const).map(([k, l]) =>
            <button key={k} className={`rounded px-2 py-1 font-semibold ${mode === k ? 'bg-white shadow-card' : ''}`} onClick={async () => { await commit(); setMode(k); }}>{l}</button>)}</div>}
          {canEdit && <span className={state === 'error' ? 'font-semibold text-ko' : 'text-mute'}>{state === 'saving' ? 'Enregistrement…' : state === 'dirty' ? 'Modifications en attente…' : state === 'error' ? 'Non enregistré' : `✓ Enregistré · version ${view.version}`}</span>}
          {!canEdit && <span className="text-mute">Lecture seule à ce stade du circuit.</span>}
          <button className="btn-secondary ml-auto !py-1" onClick={preview}><Eye className="h-3.5 w-3.5" /> Aperçu mis en page</button>
        </div>
        {conflict && <div role="alert" className="border-b border-warn/30 bg-warn-bg px-4 py-2 text-warn">Ce texte a été modifié par quelqu'un d'autre. <button className="font-semibold underline" onClick={async () => { latest.current.dirty = false; setConflict(false); await load(); }}>Recharger sa version</button> (vos dernières frappes seront perdues).</div>}
        <div className="min-h-0 flex-1">
          {editing ? <RichEditor value={text} onChange={change} mode={t.kind as EditorMode} placeholder={PLACEHOLDER[t.kind]} />
            : <div className="h-full overflow-auto bg-soft p-4 md:p-8"><div className="mx-auto min-h-[60vh] max-w-[820px] rounded-lg border border-line bg-white px-6 py-8 md:px-14">
              {view.markdown ? (mode === 'suivi' && view.tracking ? <SpanView spans={view.spans} /> : <div className="whitespace-pre-wrap text-[16px] leading-[26px]">{mode === 'propre' ? view.markdown : view.markdown}</div>) : <span className="text-mute">Texte vide.</span>}</div></div>}
        </div>
      </div>
      {view.tracking && (
        <aside className="hidden w-80 shrink-0 overflow-auto border-l border-line bg-white lg:block" aria-label="Modifications suivies">
          <div className="border-b border-line px-4 py-3"><h3 className="text-[14px]">Modifications suivies</h3><p className="text-[12px] text-mute">Une couleur par auteur.</p></div>
          {view.authors?.length > 0 && <ul className="flex flex-wrap gap-2 border-b border-line px-4 py-2">{view.authors.map((a: any) => <li key={a.username} className="flex items-center gap-1 text-[12px]"><span className="h-3 w-3 rounded-full" style={{ background: a.color }} />{a.name || a.username}</li>)}</ul>}
          {!tracking ? <p className="p-4 text-[12px] text-mute">Aucune modification en attente de décision.</p> : (
            <>
              {canEdit && <div className="border-b border-line px-4 py-2"><button className="btn-ok w-full" onClick={() => resolve('accept')}>Tout accepter ({view.changes.length})</button></div>}
              <ul>{view.changes.map((c: any) => (
                <li key={c.cid} className="border-b border-line px-4 py-3">
                  <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: c.color }} /><b className="text-[12px]">{c.name || c.author}</b><span className="ml-auto text-[11px] text-mute">{dt(c.at, { dateStyle: 'short', timeStyle: 'short' })}</span></div>
                  <div className="mt-1 text-[13px]">{c.deleted && <del className="mr-1 text-ko">{c.deleted}</del>}{c.inserted && <ins className="text-ok-text no-underline">{c.inserted}</ins>}</div>
                  {canEdit && <div className="mt-2 flex gap-2"><button className="flex items-center gap-1 text-[12px] font-semibold text-ok" onClick={() => resolve('accept', c.cid)}><CheckCircle2 className="h-4 w-4" /> Accepter</button>
                    <button className="flex items-center gap-1 text-[12px] font-semibold text-ko" onClick={() => resolve('reject', c.cid)}><XCircle className="h-4 w-4" /> Rejeter</button></div>}
                </li>))}</ul>
            </>)}
        </aside>)}
    </div>
  );
}

/** Modale plein écran de rédaction (D39, EDI-01) : trois onglets — exposé, « Vu et considérant », « Délibéré » — sans quitter le dossier. */
export default function TexteModal({ acte, texts, initialId, editable, onClose, onChanged, toast }: { acte: any; texts: any[]; initialId: number; editable: boolean; onClose: () => void; onChanged: () => void; toast: Toast }) {
  const [id, setId] = useState(initialId);
  const flush = useRef<(() => Promise<void>) | null>(null);
  const register = useCallback((fn: (() => Promise<void>) | null) => { flush.current = fn; }, []);
  const close = async () => { try { await flush.current?.(); } catch { /* signalé dans le panneau */ } onClose(); onChanged(); };
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); });
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);
  const dels = acte.deliberations || [];
  const label = (t: any) => {
    const d = dels.find((x: any) => x.id === t.deliberationId);
    return `${KIND_LABEL[t.kind]}${d && dels.length > 1 ? ` — délib. ${d.ordre}` : ''}`;
  };
  const cur = texts.find((t) => t.id === id) ?? texts[0];
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-page" role="dialog" aria-modal="true" aria-label="Rédaction du dossier">
      <header className="flex items-center gap-3 border-b border-line bg-white px-4 py-2">
        <div className="min-w-0"><div className="truncate text-[11px] font-bold uppercase tracking-wider text-mute">Dossier #{acte.numeroSuivi}</div><div className="truncate font-bold text-primary">{acte.titre}</div></div>
        <nav className="ml-4 flex min-w-0 flex-1 gap-1 overflow-x-auto" aria-label="Textes du dossier">
          {texts.map((t) => <button key={t.id} onClick={async () => { await flush.current?.(); setId(t.id); }} className={`whitespace-nowrap rounded px-3 py-2 text-[13px] font-semibold ${cur.id === t.id ? 'bg-primary text-white' : 'text-slate-700 hover:bg-slate-100'}`}>
            {label(t)}{t.empty && <span className="ml-1 text-warn" title="Texte vide">●</span>}</button>)}
        </nav>
        <button className="btn-primary" onClick={close}><X className="h-4 w-4" /> Terminer</button>
      </header>
      <div className="min-h-0 flex-1"><Pane key={cur.id} acte={acte} t={cur} editable={editable} onChanged={onChanged} toast={toast} registerFlush={register} /></div>
    </div>
  );
}
