import { PointerEvent as RPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Download, Highlighter, Loader2, MessageSquare, MousePointer2, PanelRight, Pencil, Share2, StickyNote, Trash2, X } from 'lucide-react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { api, errMsg } from './api';

/**
 * Lecteur PDF annoté de l'espace élus (ELU-71 à ELU-75) : surlignage sur sélection de texte, note, dessin au doigt / au stylet, signet.
 * Coordonnées relatives à la page (0..1, origine en haut à gauche) : indépendantes du zoom et de l'appareil.
 * Privé par défaut ; partage par annotation, document ou séance ; ré-ancrage par citation quand le document change de version.
 */
type Rect = { x: number; y: number; w: number; h: number };
export type Ann = {
  id: number; docKey: string; docVersion: string; page: number; kind: 'surlignage' | 'note' | 'dessin' | 'signet'; rects: Rect[]; trace: [number, number][][]; couleur: string;
  citation: string; contenu: string; orpheline: boolean; miennes: boolean; auteur: string | null; destinataires?: { eluId: number; nom: string | null; via: string }[];
  reponses: { id: number; auteur: string | null; miennes: boolean; contenu: string; le: string }[];
};
type Mode = 'lire' | 'surligner' | 'note' | 'dessin' | 'signet';
type TextItem = { str: string; x: number; y: number; w: number; h: number };
type PageText = { W: number; H: number; items: TextItem[] };

const COULEURS = ['#facc15', '#4ade80', '#60a5fa', '#f472b6', '#ef4444'];
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const ICONE = { surlignage: Highlighter, note: StickyNote, dessin: Pencil, signet: Bookmark } as const;
const LIBELLE = { surlignage: 'Surlignage', note: 'Note', dessin: 'Dessin', signet: 'Signet' } as const;

/** Cherche une citation dans le texte d'une page ; renvoie les zones correspondantes (fractions de la page). Insensible aux espaces et à la casse. */
function retrouver(citation: string, pt: PageText): Rect[] | null {
  const compact = (t: string) => t.replace(/\s+/g, '').toLowerCase();
  const cible = compact(citation); if (cible.length < 4) return null;
  let texte = ''; const debut: number[] = []; const longueur: number[] = [];
  pt.items.forEach((it) => { debut.push(texte.length); const c = compact(it.str); longueur.push(c.length); texte += c; });
  const i = texte.indexOf(cible); if (i < 0) return null;
  const fin = i + cible.length; const rects: Rect[] = [];
  pt.items.forEach((it, k) => {
    if (!longueur[k] || !it.str.trim()) return;
    const a = Math.max(i, debut[k]); const b = Math.min(fin, debut[k] + longueur[k]); if (b <= a) return;
    // la zone est proportionnelle aux caractères retrouvés dans l'élément (approximation d'une chasse régulière)
    const f0 = (a - debut[k]) / longueur[k]; const f1 = (b - debut[k]) / longueur[k];
    rects.push({ x: (it.x + f0 * it.w) / pt.W, y: Math.max(0, (pt.H - it.y - it.h) / pt.H), w: Math.min(1, ((f1 - f0) * it.w) / pt.W), h: Math.min(1, (it.h * 1.15) / pt.H) });
  });
  return rects.length ? rects : null;
}

/** Une page : image, texte sélectionnable (invisible), annotations, capture des gestes. */
function Page({ pdf, num, anns, mode, couleur, selected, onCreate, onSelect, onText, onSelection }: {
  pdf: PDFDocumentProxy; num: number; anns: Ann[]; mode: Mode; couleur: string; selected: number | null; onSelection: () => void;
  onCreate: (a: { page: number; kind: Ann['kind']; rects?: Rect[]; trace?: [number, number][][]; citation?: string }) => void; onSelect: (id: number) => void; onText: (n: number, t: PageText) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null); const canvas = useRef<HTMLCanvasElement>(null); const task = useRef<RenderTask | null>(null);
  const [texte, setTexte] = useState<{ items: (TextItem & { size: number; k: number })[]; W: number; H: number } | null>(null);
  const [trait, setTrait] = useState<[number, number][]>([]); const dessin = useRef(false);
  const [largeur, setLargeur] = useState(0);
  useEffect(() => { // la page suit la largeur disponible (panneau ouvert, rotation, zoom) : on refait le rendu, sans déformer
    const el = wrap.current; if (!el || typeof ResizeObserver === 'undefined') { setLargeur(el?.clientWidth || 700); return; }
    let t: number; const ro = new ResizeObserver(() => { window.clearTimeout(t); t = window.setTimeout(() => setLargeur(Math.round(el.clientWidth)), 120); });
    setLargeur(Math.round(el.clientWidth)); ro.observe(el); return () => { window.clearTimeout(t); ro.disconnect(); };
  }, []);

  useEffect(() => {
    let annule = false;
    (async () => {
      const cv = canvas.current; if (!cv || !largeur) return;
      try {
        if (task.current) { try { task.current.cancel(); } catch { /* ignore */ } try { await task.current.promise; } catch { /* annulé */ } task.current = null; } // un canevas n'accepte qu'un rendu à la fois
        if (annule) return;
        const p = await pdf.getPage(num); if (annule) return;
        const base = p.getViewport({ scale: 1 }); const vp = p.getViewport({ scale: largeur / base.width });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        cv.width = Math.round(vp.width * dpr); cv.height = Math.round(vp.height * dpr);
        task.current = p.render({ canvas: cv, viewport: p.getViewport({ scale: (largeur / base.width) * dpr }) });
        const tc = await p.getTextContent(); if (annule) return;
        const mesure = document.createElement('canvas').getContext('2d');
        const k = largeur / base.width;
        const items = (tc.items as any[]).filter((i) => typeof i.str === 'string' && i.str.length).map((i) => {
          const size = Math.max(4, (i.height || Math.abs(i.transform[3]) || 10) * k);
          if (mesure) mesure.font = `${size}px sans-serif`;
          const voulu = i.width * k; const reel = mesure ? mesure.measureText(i.str).width : voulu;
          return { str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: i.height || Math.abs(i.transform[3]), size, k: reel > 0 ? voulu / reel : 1 };
        });
        setTexte({ items, W: base.width, H: base.height });
        onText(num, { W: base.width, H: base.height, items: items.map((i) => ({ str: i.str, x: i.x, y: i.y, w: i.w, h: i.h })) });
        await task.current.promise;
      } catch (e) { if ((e as { name?: string })?.name !== 'RenderingCancelledException') { /* page illisible : on laisse la page vide */ } }
    })();
    return () => { annule = true; try { task.current?.cancel(); } catch { /* ignore */ } };
  }, [pdf, num, largeur]); // eslint-disable-line react-hooks/exhaustive-deps

  const pos = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = wrap.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  const debut = (e: RPointerEvent) => { if (mode !== 'dessin') return; dessin.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); setTrait([pos(e)]); };
  const suite = (e: RPointerEvent) => { if (dessin.current) setTrait((t) => (t.length < 2900 ? [...t, pos(e)] : t)); };
  const fin = () => { if (!dessin.current) return; dessin.current = false; if (trait.length >= 2) onCreate({ page: num, kind: 'dessin', trace: [trait] }); setTrait([]); };
  const clic = (e: RPointerEvent) => { if (mode !== 'note' && mode !== 'signet') return; const [x, y] = pos(e); onCreate({ page: num, kind: mode, rects: [{ x, y, w: 0, h: 0 }] }); };

  const surcouche = mode === 'dessin' || mode === 'note' || mode === 'signet';
  return (
    <div ref={wrap} className="relative w-full select-none bg-surface shadow-card" data-page={num} onPointerUp={(e) => { if (e.pointerType !== 'touch') onSelection(); }}>
      <canvas ref={canvas} className="block w-full" />
      {/* texte invisible : sert à sélectionner (surlignage) */}
      <div className={`absolute inset-0 overflow-hidden ${mode === 'surligner' ? 'select-text' : 'pointer-events-none'}`} style={{ lineHeight: 1 }}>
        {texte?.items.map((t, i) => (
          <span key={i} className="absolute whitespace-pre text-transparent selection:bg-blue-300/40" style={{ left: `${(t.x / texte.W) * 100}%`, top: `${((texte.H - t.y - t.h * 0.85) / texte.H) * 100}%`, fontSize: t.size, fontFamily: 'sans-serif', transformOrigin: '0 0', transform: `scaleX(${t.k})` }}>{t.str}</span>))}
      </div>
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
        {anns.filter((a) => a.page === num && !a.orpheline).map((a) => (
          <g key={a.id} opacity={selected === a.id ? 1 : 0.85}>
            {a.kind === 'surlignage' && a.rects.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={a.couleur} fillOpacity={0.4} stroke={selected === a.id ? '#0f172a' : 'none'} strokeWidth={0.002} />)}
            {a.kind === 'dessin' && a.trace.map((t, i) => <polyline key={i} points={t.map((p) => p.join(',')).join(' ')} fill="none" stroke={a.couleur} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
          </g>))}
        {trait.length > 1 && <polyline points={trait.map((p) => p.join(',')).join(' ')} fill="none" stroke={couleur} strokeWidth={2.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      </svg>
      {anns.filter((a) => a.page === num && !a.orpheline && (a.kind === 'note' || a.kind === 'signet')).map((a) => (
        <button key={a.id} onClick={() => onSelect(a.id)} aria-label={`${LIBELLE[a.kind]} : ${a.contenu || ''}`.trim()} title={a.contenu || LIBELLE[a.kind]}
          className={`absolute z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-slate-700/40 shadow ${selected === a.id ? 'ring-2 ring-slate-900' : ''}`}
          style={{ left: `${a.rects[0].x * 100}%`, top: `${a.rects[0].y * 100}%`, background: a.couleur }}>
          {a.kind === 'note' ? <StickyNote className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
        </button>))}
      {anns.filter((a) => a.page === num && a.kind === 'surlignage' && !a.orpheline).map((a) => a.rects[0] && (
        <button key={`s${a.id}`} onClick={() => onSelect(a.id)} aria-label="Ouvrir le surlignage" className="absolute z-10 h-4 w-4 -translate-x-1/2 rounded-sm border border-slate-700/30 opacity-0 focus:opacity-100" style={{ left: `${a.rects[0].x * 100}%`, top: `${a.rects[0].y * 100}%`, background: a.couleur }} />))}
      {surcouche && (
        <div className="absolute inset-0 z-20 cursor-crosshair" style={{ touchAction: 'none' }} onPointerDown={mode === 'dessin' ? debut : clic} onPointerMove={suite} onPointerUp={fin} onPointerCancel={fin} />)}
    </div>
  );
}

function PartageModal({ seanceId, docKey, ann, onClose, onDone }: { seanceId: number; docKey: string; ann: Ann | null; onClose: () => void; onDone: () => void }) {
  const [portee, setPortee] = useState<'annotation' | 'document' | 'seance'>(ann ? 'annotation' : 'document');
  const [mode, setMode] = useState<'groupe' | 'elus' | 'revoquer'>('groupe');
  const [collegues, setCollegues] = useState<any[]>([]); const [avec, setAvec] = useState<number[]>([]); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (mode === 'elus' && !collegues.length) api.get('/elus/collegues').then((r) => setCollegues(r.data.items)).catch(() => undefined); }, [mode, collegues.length]);
  const valider = async () => {
    setBusy(true); setErr(null);
    try {
      const corps = { mode, eluIds: mode === 'elus' ? avec : undefined };
      if (portee === 'annotation' && ann) await api.post(`/elus/annotations/${ann.id}/partage`, corps);
      else await api.post(`/elus/seances/${seanceId}/annotations/partage`, { ...corps, portee, docKey: portee === 'document' ? docKey : undefined });
      onDone();
    } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/50 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="Partager mes annotations">
      <div className="w-full max-w-md rounded-xl bg-surface p-4 shadow-float">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-[16px]">Partager</h2><button onClick={onClose} aria-label="Fermer" className="rounded p-1 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        {err && <p role="alert" className="mb-2 text-[13px] text-ko">{err}</p>}
        <fieldset className="mb-3 space-y-1 text-[14px]"><legend className="mb-1 text-[12px] font-semibold uppercase text-mute">Quoi</legend>
          {ann && <label className="flex items-center gap-2"><input type="radio" checked={portee === 'annotation'} onChange={() => setPortee('annotation')} /> Cette annotation</label>}
          <label className="flex items-center gap-2"><input type="radio" checked={portee === 'document'} onChange={() => setPortee('document')} /> Toutes mes annotations de ce document</label>
          <label className="flex items-center gap-2"><input type="radio" checked={portee === 'seance'} onChange={() => setPortee('seance')} /> Tout mon carnet de la séance</label>
        </fieldset>
        <fieldset className="mb-3 space-y-1 text-[14px]"><legend className="mb-1 text-[12px] font-semibold uppercase text-mute">Avec qui</legend>
          <label className="flex items-center gap-2"><input type="radio" checked={mode === 'groupe'} onChange={() => setMode('groupe')} /> Mon groupe (les membres d’aujourd’hui)</label>
          <label className="flex items-center gap-2"><input type="radio" checked={mode === 'elus'} onChange={() => setMode('elus')} /> Des élus que je choisis…</label>
          <label className="flex items-center gap-2"><input type="radio" checked={mode === 'revoquer'} onChange={() => setMode('revoquer')} /> Personne : <b>retirer tous les partages</b></label>
        </fieldset>
        {mode === 'elus' && <div className="mb-3 max-h-40 overflow-y-auto rounded border border-line p-2 text-[13px]">{collegues.map((c) => <label key={c.id} className="flex items-center gap-2 py-1"><input type="checkbox" checked={avec.includes(c.id)} onChange={(e) => setAvec(e.target.checked ? [...avec, c.id] : avec.filter((x) => x !== c.id))} />{c.nom}{c.groupe && <span className="text-mute"> · {c.groupe}</span>}</label>)}</div>}
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy || (mode === 'elus' && !avec.length)} onClick={valider}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Valider'}</button></div>
      </div>
    </div>
  );
}

function Fiche({ a, onClose, onChange, onShare }: { a: Ann; onClose: () => void; onChange: () => void; onShare: () => void }) {
  const [rep, setRep] = useState(''); const [texte, setTexte] = useState(a.contenu); const [err, setErr] = useState<string | null>(null);
  useEffect(() => setTexte(a.contenu), [a.id, a.contenu]);
  const Icone = ICONE[a.kind];
  const agir = async (f: () => Promise<unknown>) => { setErr(null); try { await f(); onChange(); } catch (e) { setErr(errMsg(e)); } };
  return (
    <div className="rounded-lg border border-line bg-surface p-3 text-[14px]">
      <div className="flex items-center gap-2 text-[12px] text-mute"><Icone className="h-4 w-4" style={{ color: a.couleur }} /><span className="font-semibold text-ink">{LIBELLE[a.kind]}</span><span>page {a.page}</span>
        {a.orpheline && <span className="rounded bg-warn-bg px-1.5 py-0.5 font-semibold text-warn">orpheline</span>}
        <button className="ml-auto rounded p-1 hover:bg-slate-100" onClick={onClose} aria-label="Fermer la fiche"><X className="h-4 w-4" /></button></div>
      {a.citation && <blockquote className="mt-2 border-l-2 pl-2 text-[13px] italic text-slate-600" style={{ borderColor: a.couleur }}>{a.citation}</blockquote>}
      {a.orpheline && <p className="mt-1 text-[12px] text-warn">Ce passage n’existe plus dans la version actuelle du document ; l’annotation est conservée.</p>}
      {!a.miennes && <p className="mt-2 text-[12px] text-mute">Partagée par <b>{a.auteur}</b></p>}
      {a.miennes && (a.kind === 'note' || a.kind === 'signet')
        ? <div className="mt-2 flex gap-2"><textarea className="input !text-[14px]" rows={2} value={texte} onChange={(e) => setTexte(e.target.value)} /><button className="btn-secondary !py-1" disabled={texte === a.contenu || !texte.trim()} onClick={() => agir(() => api.put(`/elus/annotations/${a.id}`, { contenu: texte }))}>OK</button></div>
        : a.contenu && <p className="mt-2 whitespace-pre-wrap">{a.contenu}</p>}
      {err && <p className="mt-1 text-[12px] text-ko">{err}</p>}
      {a.miennes && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
          <span className="flex items-center gap-1">{COULEURS.map((c) => <button key={c} aria-label={`Couleur ${c}`} className={`h-4 w-4 rounded-full border ${a.couleur === c ? 'ring-2 ring-slate-800' : ''}`} style={{ background: c }} onClick={() => agir(() => api.put(`/elus/annotations/${a.id}`, { couleur: c }))} />)}</span>
          <span className="text-mute">{a.destinataires?.length ? `Partagée avec ${a.destinataires.map((d) => d.nom).join(', ')}` : 'Privée'}</span>
          <button className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-slate-100" onClick={onShare}><Share2 className="h-3.5 w-3.5" /> Partager</button>
          <button className="inline-flex items-center gap-1 rounded px-2 py-1 text-ko hover:bg-slate-100" onClick={() => window.confirm('Supprimer cette annotation ?') && agir(() => api.delete(`/elus/annotations/${a.id}`).then(onClose))}><Trash2 className="h-3.5 w-3.5" /> Supprimer</button>
        </div>)}
      {(a.reponses.length > 0 || !a.miennes || (a.destinataires?.length ?? 0) > 0) && (
        <div className="mt-3 space-y-1 border-t border-line pt-2">
          {a.reponses.map((r) => <p key={r.id} className="rounded bg-soft px-2 py-1 text-[13px]"><b>{r.miennes ? 'Moi' : r.auteur}</b> : {r.contenu}</p>)}
          <div className="flex gap-2"><input className="input !py-1.5 !text-[13px]" placeholder="Répondre…" value={rep} onChange={(e) => setRep(e.target.value)} />
            <button className="btn-secondary !py-1" disabled={!rep.trim()} onClick={() => agir(async () => { await api.post(`/elus/annotations/${a.id}/reponses`, { contenu: rep }); setRep(''); })}><MessageSquare className="h-4 w-4" /></button></div>
        </div>)}
    </div>
  );
}

export default function LecteurAnnote({ blob, doc, seanceId, zoom = 100 }: { blob: Blob; doc: { key: string; version: string; titre: string }; seanceId: number; zoom?: number }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null); const [erreur, setErreur] = useState<string | null>(null);
  const [anns, setAnns] = useState<Ann[]>([]); const [mode, setMode] = useState<Mode>('lire'); const [couleur, setCouleur] = useState(COULEURS[0]);
  const [sel, setSel] = useState<number | null>(null); const [panneau, setPanneau] = useState(false); const [partage, setPartage] = useState<null | { ann: Ann | null }>(null);
  const [brouillon, setBrouillon] = useState<null | { page: number; kind: 'note' | 'signet'; rects: Rect[]; texte: string }>(null); const [msg, setMsg] = useState<string | null>(null);
  const textes = useRef(new Map<number, PageText>()); const traites = useRef(new Set<number>());

  useEffect(() => {
    let annule = false; setPdf(null); setErreur(null); textes.current.clear(); traites.current.clear();
    (async () => {
      try { const { pdfjsLib, pdfDocumentOptions } = await import('../pdfjs'); const d = await pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), ...pdfDocumentOptions }).promise; if (!annule) setPdf(d); }
      catch (e) { if (!annule) setErreur(e instanceof Error ? e.message : 'Erreur de chargement du PDF'); }
    })();
    return () => { annule = true; };
  }, [blob]);

  const charger = useCallback(() => api.get(`/elus/seances/${seanceId}/annotations`, { params: { docKey: doc.key } }).then((r) => setAnns(r.data.items)).catch(() => undefined), [seanceId, doc.key]);
  useEffect(() => { void charger(); }, [charger]);

  // ELU-74 : le document a changé de version → on cherche la citation dans le nouveau texte, sinon « orpheline »
  const surTexte = useCallback((n: number, t: PageText) => {
    textes.current.set(n, t);
    if (!pdf || textes.current.size < pdf.numPages) return;
    const aFaire = anns.filter((a) => a.miennes && a.docVersion !== doc.version && a.citation && (a.kind === 'surlignage' || a.kind === 'note') && !traites.current.has(a.id));
    if (!aFaire.length) return;
    (async () => {
      for (const a of aFaire) {
        traites.current.add(a.id);
        let trouve: { page: number; rects: Rect[] } | null = null;
        const ordre = [a.page, ...Array.from(textes.current.keys()).filter((p) => p !== a.page)];
        for (const p of ordre) { const r = textes.current.get(p) ? retrouver(a.citation, textes.current.get(p)!) : null; if (r) { trouve = { page: p, rects: r }; break; } }
        try { await api.put(`/elus/annotations/${a.id}/ancrage`, trouve ? { docVersion: doc.version, page: trouve.page, rects: a.kind === 'note' ? [trouve.rects[0]] : trouve.rects } : { orpheline: true }); } catch { /* réessayé à la prochaine ouverture */ }
      }
      void charger();
    })();
  }, [pdf, anns, doc.version, charger]);

  /** Surligne le texte actuellement sélectionné (la page est celle où commence la sélection). */
  const enSelection = useRef(false);
  const surlignerSelection = () => {
    if (mode !== 'surligner' || enSelection.current) return;
    const sel = window.getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const r0 = sel.getRangeAt(0); const el = (r0.startContainer.nodeType === 1 ? r0.startContainer : r0.startContainer.parentElement) as Element | null;
    const pageEl = el?.closest('[data-page]') as HTMLElement | null; if (!pageEl) return;
    const cadre = pageEl.getBoundingClientRect(); const rects: Rect[] = [];
    for (const c of Array.from(r0.getClientRects())) {
      if (c.width < 2 || c.height < 2 || c.bottom < cadre.top || c.top > cadre.bottom) continue;
      rects.push({ x: Math.max(0, (c.left - cadre.left) / cadre.width), y: Math.max(0, (c.top - cadre.top) / cadre.height), w: Math.min(1, c.width / cadre.width), h: Math.min(1, c.height / cadre.height) });
    }
    if (!rects.length) return;
    const citation = sel.toString().replace(/\s+/g, ' ').trim().slice(0, 1500); sel.removeAllRanges(); setSelTexte('');
    enSelection.current = true; void creer({ page: Number(pageEl.dataset.page), kind: 'surlignage', rects, citation }).finally(() => { enSelection.current = false; });
  };
  // au doigt, la sélection se fait avec les poignées du système : un bouton confirme le surlignage
  const [selTexte, setSelTexte] = useState('');
  useEffect(() => {
    if (mode !== 'surligner') { setSelTexte(''); return; }
    const h = () => setSelTexte(window.getSelection()?.toString().trim() || '');
    document.addEventListener('selectionchange', h); return () => document.removeEventListener('selectionchange', h);
  }, [mode]);

  const creer = async (b: { page: number; kind: Ann['kind']; rects?: Rect[]; trace?: [number, number][][]; citation?: string }) => {
    if (b.kind === 'note' || b.kind === 'signet') { setBrouillon({ page: b.page, kind: b.kind, rects: b.rects || [], texte: '' }); return; }
    try { const a = (await api.post(`/elus/seances/${seanceId}/annotations`, { docKey: doc.key, docVersion: doc.version, couleur, ...b })).data; setAnns((x) => [...x, a]); setSel(a.id); if (b.kind === 'surlignage') setMode('lire'); } catch (e) { setMsg(errMsg(e)); }
  };
  const enregistrerNote = async () => {
    if (!brouillon || !brouillon.texte.trim()) return;
    try { const a = (await api.post(`/elus/seances/${seanceId}/annotations`, { docKey: doc.key, docVersion: doc.version, couleur, page: brouillon.page, kind: brouillon.kind, rects: brouillon.rects, contenu: brouillon.texte })).data; setAnns((x) => [...x, a]); setSel(a.id); setBrouillon(null); setMode('lire'); } catch (e) { setMsg(errMsg(e)); }
  };
  const exporter = async () => {
    try { const r = await api.get(`/elus/seances/${seanceId}/dossier-annote`, { responseType: 'blob' }); const u = URL.createObjectURL(r.data); const a = document.createElement('a'); a.href = u; a.download = `dossier-annote-seance-${seanceId}.pdf`; a.click(); URL.revokeObjectURL(u); }
    catch (e) { setMsg(e && (e as any).response?.status === 403 ? 'L’export du dossier annoté est désactivé.' : errMsg(e)); }
  };
  const courante = useMemo(() => anns.find((a) => a.id === sel) || null, [anns, sel]);
  const allerA = (a: Ann) => { setSel(a.id); document.querySelector(`[data-page="${a.page}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };

  const OUTILS: [Mode, string, typeof Highlighter][] = [['lire', 'Lire', MousePointer2], ['surligner', 'Surligner', Highlighter], ['note', 'Note', StickyNote], ['dessin', 'Dessiner', Pencil], ['signet', 'Signet', Bookmark]];
  if (erreur) return <p className="m-4 rounded bg-ko-bg p-3 text-[13px] text-ko">{erreur}</p>;
  if (!pdf) return <div className="flex flex-1 items-center justify-center p-10 text-mute"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface px-2 py-1.5" role="toolbar" aria-label="Outils d’annotation">
        {OUTILS.map(([m, l, I]) => <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} className={`inline-flex items-center gap-1 rounded px-2.5 py-2 text-[13px] font-semibold ${mode === m ? 'bg-primary text-white' : 'text-slate-700 hover:bg-slate-100'}`}><I className="h-4 w-4" /><span className="hidden sm:inline">{l}</span></button>)}
        <span className="mx-1 flex items-center gap-1" role="group" aria-label="Couleur">{COULEURS.map((c) => <button key={c} aria-label={`Couleur ${c}`} aria-pressed={couleur === c} onClick={() => setCouleur(c)} className={`h-5 w-5 rounded-full border ${couleur === c ? 'ring-2 ring-slate-800 ring-offset-1' : ''}`} style={{ background: c }} />)}</span>
        <button className="ml-auto inline-flex items-center gap-1 rounded px-2.5 py-2 text-[13px] font-semibold hover:bg-slate-100" onClick={() => setPanneau(!panneau)} aria-expanded={panneau}><PanelRight className="h-4 w-4" /> Annotations ({anns.length})</button>
      </div>
      {/* consignes en surimpression : elles ne décalent jamais la page (le geste tombe toujours où on vise) */}
      {mode !== 'lire' && <div className="pointer-events-none relative z-30 h-0"><div className="pointer-events-auto mx-auto flex w-fit max-w-[92%] items-center gap-3 rounded-b-lg bg-slate-900/85 px-3 py-1 text-[12px] text-white shadow" role="status">
        {mode === 'surligner' ? 'Sélectionnez du texte pour le surligner.' : mode === 'dessin' ? 'Dessinez au doigt ou au stylet sur la page.' : 'Touchez la page à l’endroit voulu.'}
        {mode === 'surligner' && selTexte && <button className="rounded bg-surface px-2 py-0.5 font-semibold text-ink" onClick={surlignerSelection}>Surligner la sélection</button>}</div></div>}
      {msg && <p role="alert" className="flex items-center bg-ko-bg px-3 py-1 text-[12px] text-ko">{msg}<button className="ml-auto" onClick={() => setMsg(null)} aria-label="Fermer"><X className="h-3.5 w-3.5" /></button></p>}
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 space-y-2 overflow-auto bg-slate-100 p-2">
          <div className="space-y-2" style={{ width: `${zoom}%`, minWidth: '100%' }}>
            {Array.from({ length: pdf.numPages }, (_, i) => i + 1).map((n) => <Page key={`${n}-${zoom}`} pdf={pdf} num={n} anns={anns} mode={mode} couleur={couleur} selected={sel} onCreate={creer} onSelect={(id) => { setSel(id); setPanneau(true); }} onText={surTexte} onSelection={surlignerSelection} />)}
          </div>
        </div>
        {panneau && (
          <aside className="w-full max-w-sm shrink-0 space-y-2 overflow-y-auto border-l border-line bg-surface p-2 max-sm:absolute max-sm:inset-y-0 max-sm:right-0 max-sm:z-30 max-sm:max-w-full" aria-label="Annotations du document">
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary !py-1.5 text-[12px]" onClick={() => setPartage({ ann: null })}><Share2 className="h-3.5 w-3.5" /> Partager…</button>
              <button className="btn-secondary !py-1.5 text-[12px]" onClick={exporter}><Download className="h-3.5 w-3.5" /> Mon dossier annoté</button>
              <button className="ml-auto rounded p-1 hover:bg-slate-100 sm:hidden" onClick={() => setPanneau(false)} aria-label="Fermer"><X className="h-4 w-4" /></button>
            </div>
            {courante && <Fiche a={courante} onClose={() => setSel(null)} onChange={charger} onShare={() => setPartage({ ann: courante })} />}
            {!anns.length ? <p className="p-4 text-center text-[13px] text-mute">Aucune annotation sur ce document. Choisissez un outil ci-dessus.</p> : (
              <ul className="space-y-1">{anns.map((a) => { const I = ICONE[a.kind]; return (
                <li key={a.id}><button onClick={() => allerA(a)} className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-soft ${sel === a.id ? 'bg-soft' : ''}`}>
                  <I className="mt-0.5 h-4 w-4 shrink-0" style={{ color: a.couleur }} />
                  <span className="min-w-0 flex-1"><span className="block truncate">{a.contenu || a.citation || LIBELLE[a.kind]}</span>
                    <span className="text-[11px] text-mute">page {a.page}{!a.miennes && ` · de ${a.auteur}`}{a.orpheline && ' · orpheline'}{a.reponses.length > 0 && ` · ${a.reponses.length} réponse${a.reponses.length > 1 ? 's' : ''}`}</span></span></button></li>); })}</ul>)}
          </aside>)}
      </div>
      {brouillon && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/50 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label={brouillon.kind === 'note' ? 'Nouvelle note' : 'Nouveau signet'}>
          <div className="w-full max-w-md rounded-xl bg-surface p-4 shadow-float">
            <h2 className="mb-2 text-[16px]">{brouillon.kind === 'note' ? 'Nouvelle note' : 'Nouveau signet'} — page {brouillon.page}</h2>
            <textarea className="input !text-[15px]" rows={4} autoFocus placeholder={brouillon.kind === 'note' ? 'Votre note…' : 'Nom du signet…'} value={brouillon.texte} onChange={(e) => setBrouillon({ ...brouillon, texte: e.target.value })} />
            <p className="mt-1 text-[12px] text-mute">Privée : vous pourrez la partager ensuite.</p>
            <div className="mt-3 flex justify-end gap-2"><button className="btn-secondary" onClick={() => setBrouillon(null)}>Annuler</button><button className="btn-primary" disabled={!brouillon.texte.trim()} onClick={enregistrerNote}>Enregistrer</button></div>
          </div>
        </div>)}
      {partage && <PartageModal seanceId={seanceId} docKey={doc.key} ann={partage.ann} onClose={() => setPartage(null)} onDone={() => { setPartage(null); void charger(); }} />}
    </div>
  );
}
