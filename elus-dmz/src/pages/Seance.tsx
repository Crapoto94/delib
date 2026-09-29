import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, ChevronLeft, File, FileText, ListOrdered, Loader2, MessageSquareText, Minus, Paperclip, Plus, Radio, Star, StickyNote, Trash2, WifiOff } from 'lucide-react';
import LecteurAnnote from '../AnnotPdf';
import { api, errMsg } from '../api';
import { chargerAvecCache } from '../cache';
import { armerReprise, noterLecture, ouvrirDoc, prefetchSeance, type Doc } from '../docs';
import { useRafraichissement } from '../refresh';
import { EtatTelechargement, definirSeanceSuivie } from './Accueil';
import { dt } from '../format';
import { Select } from '../Select';

type Sel = { kind: 'point'; id: number } | { kind: 'doc'; key: string };
const DOC_ICON: Record<string, typeof FileText> = { expose: BookOpen, projet: FileText, annexe: Paperclip, piece: File, convocation: CalendarDays, odj: ListOrdered, cahier: BookOpen };
const DOC_LABEL_COURT: Record<string, string> = { expose: 'Exposé', projet: 'Délibération' };

/** Lecteur d'un document : depuis l'appareil s'il y est (instantané), sinon depuis le réseau. Consigne la lecture (même hors ligne). */
function Lecteur({ doc, seanceId, documents, onSelectDoc }: { doc: Pick<Doc, 'key' | 'version' | 'url'> & { titre: string; type?: string }; seanceId: number; documents: any[]; onSelectDoc: (key: string) => void }) {
  const [blob, setBlob] = useState<Blob | null>(null); const [err, setErr] = useState<string | null>(null); const [local, setLocal] = useState(false); const [zoom, setZoom] = useState(100); const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const surZoom = (deltaY: number) => setZoom((z) => Math.min(300, Math.max(25, z - (deltaY > 0 ? 15 : -15))));
  useEffect(() => {
    let stop = false; setBlob(null); setErr(null);
    ouvrirDoc(doc).then((r) => { if (stop) return; setBlob(r.blob); setLocal(r.local); }).catch((e) => { if (!stop) setErr(e?.message || errMsg(e)); });
    // la lecture est comptée après quelques secondes d'affichage, pas au simple survol d'un point
    const t = setTimeout(() => noterLecture(seanceId, doc.key, doc.version), 3000);
    return () => { stop = true; clearTimeout(t); };
  }, [doc.key, doc.version, doc.url, seanceId]);
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-line bg-slate-100">
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface px-3 py-2 text-[13px]">
        <FileText className="h-4 w-4 shrink-0 text-mute" /><span className="min-w-0 flex-1 truncate font-semibold">{doc.titre}</span>
        {documents.length > 1 && <div className="flex items-center gap-1" role="group" aria-label="Pièces du point">{documents.map((d) => {
          const I = DOC_ICON[d.type] ?? FileText; const label = DOC_LABEL_COURT[d.type];
          const actif = doc.key === d.key;
          // Exposé et projet ne sont jamais fusionnés en un seul PDF côté /elus : un libellé visible (pas seulement
          // une icône au survol) rappelle qu'il y a deux documents distincts à lire, pas un seul découpé en onglets.
          return label ? (
            <button key={d.key} type="button" aria-pressed={actif} onClick={() => onSelectDoc(d.key)}
              className={`inline-flex items-center gap-1 rounded px-2 py-1.5 text-[12px] font-semibold ${actif ? 'bg-primary text-white' : 'text-slate-700 hover:bg-slate-100'}`}>
              <I className="h-4 w-4" />{label}
            </button>
          ) : (
            <button key={d.key} type="button" title={d.titre} aria-label={d.titre} aria-pressed={actif} onClick={() => onSelectDoc(d.key)} className={`rounded p-2 ${actif ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}><I className="h-4 w-4" /></button>
          );
        })}</div>}
        <button type="button" className={`inline-flex items-center gap-1 rounded px-2 py-2 text-[12px] font-semibold ${annotationsOpen ? 'bg-primary text-white' : 'hover:bg-slate-100'}`} onClick={() => setAnnotationsOpen((v) => !v)} aria-expanded={annotationsOpen}><MessageSquareText className="h-4 w-4" /><span className="hidden sm:inline">Annotations</span></button>
        {blob && <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${local ? 'bg-ok-bg text-ok-text' : 'bg-slate-200 text-slate-700'}`}>{local ? 'sur l’appareil' : 'en ligne'}</span>}
        <button className="rounded p-2 hover:bg-slate-100" aria-label="Réduire" onClick={() => setZoom((z) => Math.max(25, z - 15))}><Minus className="h-4 w-4" /></button>
        <span className="w-10 text-center tabular-nums">{zoom} %</span>
        <button className="rounded p-2 hover:bg-slate-100" aria-label="Agrandir" onClick={() => setZoom((z) => Math.min(300, z + 15))}><Plus className="h-4 w-4" /></button>
      </div>
      {err ? <p className="p-6 text-ko">{err}</p> : !blob ? <div className="flex flex-1 items-center justify-center p-10 text-mute"><Loader2 className="h-6 w-6 animate-spin" /></div> : <div className="flex min-h-0 flex-1 flex-col"><LecteurAnnote blob={blob} doc={{ key: doc.key, version: doc.version, titre: doc.titre }} seanceId={seanceId} zoom={zoom} annotationsOpen={annotationsOpen} onToggleAnnotations={() => setAnnotationsOpen((v) => !v)} onZoomWheel={surZoom} onZoomSet={(z) => setZoom(Math.min(300, Math.max(25, z)))} /></div>}
    </div>
  );
}

const CIBLE_AM: Record<string, string> = { expose: 'Exposé des motifs', visas: 'Visas et considérants', dispositif: 'Dispositif' };
const STATUT_AM: Record<string, { label: string; classe: string }> = { a_voter: { label: 'À voter', classe: 'bg-action-solid text-white' }, adopte: { label: 'Adopté', classe: 'bg-ok-solid text-white' }, rejete: { label: 'Rejeté', classe: 'bg-ko-solid text-white' }, retire: { label: 'Retiré', classe: 'bg-warn-solid text-white' }, traite: { label: 'Voté', classe: 'bg-slate-500 text-white' } };

/** Amendements du point : le texte proposé arrive en temps réel, avant le vote (ELU-41). */
function AmendementsElus({ liste }: { liste: any[] }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4" aria-label="Amendements du point">
      <h2 className="mb-2 text-[15px]">Amendements ({liste.length})</h2>
      <ul className="space-y-2">
        {liste.map((a) => {
          const st = STATUT_AM[a.statut] ?? STATUT_AM.a_voter;
          return (
            <li key={a.id} className="rounded-lg border border-line bg-soft p-3">
              <div className="flex flex-wrap items-center gap-2"><b>Amendement n° {a.numero}</b><span className="text-[13px] text-mute">{a.auteur} · {CIBLE_AM[a.cible]}</span><span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${st.classe}`}>{st.label}</span></div>
              {a.motif && <p className="mt-1 text-[13px] text-mute">Motif : {a.motif}</p>}
              <details className="mt-1" open={a.statut === 'a_voter'}><summary className="cursor-pointer text-[13px] font-semibold text-action">Texte proposé</summary><pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 text-[13px]">{a.texte}</pre></details>
            </li>);
        })}
      </ul>
    </section>
  );
}

/** Notes personnelles du point : privées par défaut ; partage avec son groupe ou des élus nommés. */
function Notes({ seanceId, itemId, moi }: { seanceId: number; itemId: number; moi: boolean }) {
  const [notes, setNotes] = useState<any[]>([]); const [texte, setTexte] = useState(''); const [partage, setPartage] = useState<'prive' | 'groupe' | 'elus'>('prive');
  const [collegues, setCollegues] = useState<any[]>([]); const [avec, setAvec] = useState<number[]>([]); const [err, setErr] = useState<string | null>(null);
  const charger = useCallback(() => api.get(`/elus/seances/${seanceId}/notes`).then((r) => setNotes(r.data.items.filter((n: any) => n.itemId === itemId))).catch(() => undefined), [seanceId, itemId]);
  useEffect(() => { void charger(); }, [charger]);
  useEffect(() => { if (partage === 'elus' && !collegues.length) api.get('/elus/collegues').then((r) => setCollegues(r.data.items)).catch(() => undefined); }, [partage, collegues.length]);
  const ajouter = async () => { setErr(null); try { await api.post(`/elus/seances/${seanceId}/notes`, { itemId, texte, partage, avec }); setTexte(''); setPartage('prive'); setAvec([]); void charger(); } catch (e) { setErr(errMsg(e)); } };
  void moi;
  return (
    <div className="space-y-3">
      {notes.map((n) => (
        <div key={n.id} className="rounded-lg border border-line bg-surface p-3 text-[14px]">
          <div className="flex items-center gap-2 text-[11px] text-mute"><span>{n.miennes ? (n.partage === 'prive' ? 'Note privée' : n.partage === 'groupe' ? 'Partagée avec mon groupe' : 'Partagée avec des élus') : `Partagée par ${n.auteur}`}</span>
            {n.miennes && <button className="ml-auto text-ko" aria-label="Supprimer la note" onClick={async () => { await api.delete(`/elus/notes/${n.id}`); void charger(); }}><Trash2 className="h-4 w-4" /></button>}</div>
          <p className="mt-1 whitespace-pre-wrap">{n.texte}</p>
        </div>))}
      <div className="space-y-2 rounded-lg border border-line bg-soft p-3">
        {err && <p className="text-[13px] text-ko">{err}</p>}
        <textarea className="input !text-[15px]" rows={3} placeholder="Ma note sur ce point…" value={texte} onChange={(e) => setTexte(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <Select className="input !w-auto !py-2" value={partage} onChange={(e) => setPartage(e.target.value as any)}><option value="prive">Privée</option><option value="groupe">Partager avec mon groupe</option><option value="elus">Partager avec des élus…</option></Select>
          <button className="btn-primary ml-auto !py-2" disabled={!texte.trim() || (partage === 'elus' && !avec.length)} onClick={ajouter}>Enregistrer</button>
        </div>
        {partage === 'elus' && <div className="max-h-40 overflow-y-auto rounded border border-line bg-surface p-2 text-[13px]">{collegues.map((c) => (
          <label key={c.id} className="flex items-center gap-2 py-1"><input type="checkbox" checked={avec.includes(c.id)} onChange={(e) => setAvec(e.target.checked ? [...avec, c.id] : avec.filter((x) => x !== c.id))} />{c.nom}{c.groupe && <span className="text-mute"> · {c.groupe}</span>}</label>))}</div>}
      </div>
    </div>
  );
}

export default function Seance() {
  const { id } = useParams(); const sid = Number(id);
  const [s, setS] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [sel, setSel] = useState<Sel | null>(null); const [docKey, setDocKey] = useState<string | null>(null); const [rail, setRail] = useState(false); const [notes, setNotes] = useState(false);
  const [suivre, setSuivre] = useState(false); const [direct, setDirect] = useState<any>(null);
  const suivreRef = useRef(false); suivreRef.current = suivre;

  const charger = useCallback(async () => { try { const { data, horsLigne } = await chargerAvecCache(`seance:${sid}`, () => api.get(`/elus/seances/${sid}`).then((r) => r.data)); setS(data); setHorsLigne(horsLigne); } catch (e) { setErr(errMsg(e)); } }, [sid]);
  const v = useRafraichissement();
  useEffect(() => { void charger(); definirSeanceSuivie(sid); armerReprise(() => sid); void prefetchSeance(sid); }, [sid, charger, v]);

  const points: any[] = useMemo(() => (s?.points ?? []).filter((p: any) => p.kind !== 'chapitre'), [s]);
  const navigables = useMemo(() => points.filter((p) => !p.retire), [points]);
  const courant = sel?.kind === 'point' ? points.find((p) => p.id === sel.id) : null;
  const docsPoint: any[] = courant?.documents ?? [];
  const docCourant = sel?.kind === 'doc' ? s?.documents.find((d: any) => d.key === sel.key) : (docsPoint.find((d) => d.key === docKey) ?? docsPoint[0]);

  // première sélection : le premier point non lu (ou le premier)
  useEffect(() => { if (s && !sel) { const p = navigables.find((x) => !x.lu) ?? navigables[0]; if (p) setSel({ kind: 'point', id: p.id }); else if (s.documents[0]) setSel({ kind: 'doc', key: s.documents[0].key }); } }, [s, sel, navigables]);
  useEffect(() => { setDocKey(null); }, [sel]);

  // un point ouvert plus de 3 secondes est « lu »
  useEffect(() => {
    if (!courant || courant.lu) return;
    const t = setTimeout(() => { api.put(`/elus/points/${courant.id}/etat`, { lu: true }).then(() => setS((x: any) => ({ ...x, points: x.points.map((p: any) => (p.id === courant.id ? { ...p, lu: true } : p)) }))).catch(() => undefined); }, 3000);
    return () => clearTimeout(t);
  }, [courant?.id, courant?.lu]); // eslint-disable-line react-hooks/exhaustive-deps

  const aller = (delta: number) => { if (!courant) return; const i = navigables.findIndex((p) => p.id === courant.id); const n = navigables[i + delta]; if (n) { setSel({ kind: 'point', id: n.id }); window.scrollTo({ top: 0 }); } };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'INPUT') return; if (e.key === 'ArrowRight') aller(1); if (e.key === 'ArrowLeft') aller(-1); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // suivi en direct : la tablette suit le point en cours quand l'élu le souhaite (attente longue)
  useEffect(() => {
    if (!s?.suivreLaSeance) return;
    let stop = false; let since = 0;
    (async () => {
      while (!stop) {
        try {
          const r = (await api.get(`/elus/seances/${sid}/direct`, { params: since ? { since, wait: 20 } : {}, timeout: 40000 })).data;
          if (stop) break;
          if (r.unchanged) { since = Math.max(since, r.version); continue; }
          since = r.version; setDirect(r);
          if (suivreRef.current && r.courantId) setSel({ kind: 'point', id: r.courantId });
        } catch { await new Promise((res) => setTimeout(res, 4000)); }
      }
    })();
    return () => { stop = true; };
  }, [s?.suivreLaSeance, sid]);
  useEffect(() => { if (suivre && direct?.courantId) setSel({ kind: 'point', id: direct.courantId }); }, [suivre]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <p className="p-6 text-ko">{err}</p>;
  if (!s) return <p className="p-6 text-mute">Chargement…</p>;
  const idx = courant ? navigables.findIndex((p) => p.id === courant.id) : -1;
  const etatDirect = (pid: number) => direct?.points?.find((p: any) => p.id === pid);

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <Link to="/" className="rounded p-2 hover:bg-slate-100" aria-label="Retour"><ChevronLeft className="h-5 w-5" /></Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-mute">{s.instance} · {dt(s.dateSeance, { dateStyle: 'full', timeStyle: 'short' })}</div>
          {courant && <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[15px] font-bold leading-snug md:text-[17px]">{courant.numero ? `${courant.numero} · ` : ''}{courant.titre}</h1>
              {(courant.rapporteur || courant.rubrique) && <p className="truncate text-[11px] text-mute">{courant.rapporteur ? `Rapporteur : ${courant.rapporteur}` : ''}{courant.rapporteur && courant.rubrique ? ' · ' : ''}{courant.rubrique || ''}</p>}
            </div>
            <button className="rounded-lg p-2 hover:bg-slate-100" aria-label="Favori" aria-pressed={courant.favori} onClick={async () => { const f = !courant.favori; await api.put(`/elus/points/${courant.id}/etat`, { favori: f }); setS((x: any) => ({ ...x, points: x.points.map((p: any) => (p.id === courant.id ? { ...p, favori: f } : p)) })); }}><Star className={`h-5 w-5 ${courant.favori ? 'fill-warn text-warn' : ''}`} /></button>
            <button className={`rounded-lg p-2 ${notes ? 'bg-action/10 text-action' : 'hover:bg-slate-100'}`} aria-label="Mes notes" aria-pressed={notes} onClick={() => setNotes(!notes)}><StickyNote className="h-5 w-5" /></button>
          </div>}
        </div>
        {horsLigne && <span className="inline-flex items-center gap-1 rounded-full bg-warn-bg px-2.5 py-1 text-[11px] font-semibold text-warn" title="Seules les données déjà enregistrées sur l’appareil sont affichées."><WifiOff className="h-3.5 w-3.5" /> hors ligne</span>}
        <EtatTelechargement />
        {s.suivreLaSeance && <button className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold ${suivre ? 'bg-ko-solid text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setSuivre(!suivre)} aria-pressed={suivre}><Radio className="h-3.5 w-3.5" /> {suivre ? 'Je suis la séance' : 'Suivre la séance'}</button>}
        <button className="rounded p-2 hover:bg-slate-100 md:hidden" onClick={() => setRail(!rail)} aria-label="Ordre du jour"><BookOpen className="h-5 w-5" /></button>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <nav className={`${rail ? 'absolute inset-0 z-30 max-h-[70vh] shadow-float' : 'hidden'} w-full shrink-0 overflow-y-auto border-r border-line bg-surface md:static md:block md:max-h-none md:w-80 md:shadow-none`} aria-label="Ordre du jour">
          {s.documents.length > 0 && <div className="border-b border-line">
            <div className="bg-soft px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-mute">Documents de la séance</div>
            {s.documents.map((d: any) => <button key={d.key} onClick={() => { setSel({ kind: 'doc', key: d.key }); setRail(false); }} className={`flex w-full items-center gap-2 px-4 py-3 text-left text-[14px] ${sel?.kind === 'doc' && sel.key === d.key ? 'bg-primary text-white' : 'hover:bg-soft'}`}><FileText className="h-4 w-4 shrink-0" />{d.titre}{d.modifie && <span className="ml-auto rounded bg-warn-solid px-1.5 text-[10px] font-bold text-white">modifié</span>}</button>)}</div>}
          <div className="bg-soft px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-mute">Ordre du jour</div>
          <ol>{s.points.map((p: any) => p.kind === 'chapitre' ? <li key={p.id} className="bg-slate-100 px-4 py-1.5 text-[11px] font-bold uppercase text-mute">{p.titre}</li> : (
            <li key={p.id}><button onClick={() => { setSel({ kind: 'point', id: p.id }); setRail(false); }} disabled={false}
              className={`flex w-full items-start gap-2 border-t border-line/60 px-4 py-3 text-left text-[14px] ${sel?.kind === 'point' && sel.id === p.id ? 'bg-primary text-white' : 'hover:bg-soft'} ${p.retire ? 'opacity-60' : ''}`}>
              <span className="min-w-0 flex-1"><span className="block truncate font-mono text-[11px] opacity-80">{p.numero ?? '·'}</span><span className={`line-clamp-2 ${p.retire ? 'line-through' : ''}`}>{p.titre}</span>
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {p.retire && <span className="rounded bg-warn-solid px-1.5 text-[10px] font-bold text-white">retiré</span>}
                  {p.documents.some((d: any) => d.modifie) && <span className="rounded bg-warn-solid px-1.5 text-[10px] font-bold text-white">modifié</span>}
                  {etatDirect(p.id)?.etat === 'en_cours' && <span className="rounded bg-ko-solid px-1.5 text-[10px] font-bold text-white">en cours</span>}
                  {etatDirect(p.id)?.issue === 'adopte' && <span className="rounded bg-ok-solid px-1.5 text-[10px] font-bold text-white">adoptée</span>}
                  {etatDirect(p.id)?.issue === 'rejete' && <span className="rounded bg-ko-solid px-1.5 text-[10px] font-bold text-white">rejetée</span>}
                </span></span>
              <span className="flex shrink-0 items-center gap-1">{p.favori && <Star className="h-4 w-4 fill-warn text-warn" />}{p.lu && <span className="text-[11px] opacity-70">✓</span>}</span>
            </button></li>))}</ol>
        </nav>

        <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3 md:p-4">
          {courant ? (
            <>
              {suivre && (direct?.amendements ?? []).some((a: any) => a.itemId === courant.id) && <AmendementsElus liste={(direct.amendements as any[]).filter((a) => a.itemId === courant.id)} />}
              {notes && <div className="rounded-xl border border-line bg-surface p-4"><Notes seanceId={sid} itemId={courant.id} moi /></div>}
            </>
          ) : sel?.kind === 'doc' && docCourant ? <h1 className="text-[20px]">{docCourant.titre}</h1> : null}

          {docCourant ? <div className="flex min-h-[60vh] flex-1 flex-col"><Lecteur key={docCourant.key} seanceId={sid} doc={{ key: docCourant.key, version: docCourant.version, titre: docCourant.titre, type: docCourant.type, url: `/api/v1/elus/documents/${encodeURIComponent(docCourant.key)}` }} documents={courant ? docsPoint : s.documents} onSelectDoc={(key) => { if (courant) setDocKey(key); else setSel({ kind: 'doc', key }); }} /></div>
            : courant && !courant.retire ? <p className="rounded-xl border border-line bg-surface p-6 text-mute">Aucun document pour ce point.</p> : null}

          {courant && (
            <div className="sticky bottom-0 -mx-3 flex items-center gap-2 border-t border-line bg-white/95 px-3 py-2 backdrop-blur md:-mx-4 md:px-4">
              <button className="btn-secondary !px-5 !py-3 !text-[15px]" disabled={idx <= 0} onClick={() => aller(-1)}><ArrowLeft className="h-5 w-5" /> Précédent</button>
              <span className="flex-1 text-center text-[13px] text-mute">Point {idx + 1} / {navigables.length}</span>
              <button className="btn-primary !px-5 !py-3 !text-[15px]" disabled={idx >= navigables.length - 1} onClick={() => aller(1)}>Suivant <ArrowRight className="h-5 w-5" /></button>
            </div>)}
        </main>
      </div>
    </div>
  );
}
