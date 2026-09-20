import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileText, Loader2, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

/**
 * Visionneuse PDF intégrée (modale) avec zoom — reprise de la visionneuse d'AppDSI.
 * Tout PDF de l'application s'affiche ici (aperçus, annexes, étalonnage), jamais dans un onglet vierge.
 *
 * - Ordinateur : lecteur PDF natif du navigateur dans une iframe, zoom piloté par les paramètres d'ouverture PDF.
 * - Mobile et Safari macOS : rendu des pages avec pdf.js (canvas), avec défilement et zoom.
 */
const isMobileDevice = () => typeof navigator !== 'undefined'
  && (/Android|iPhone|iPad|iPod|Mobile|Opera Mini/i.test(navigator.userAgent) || (!!window.matchMedia?.('(pointer: coarse)').matches && window.innerWidth < 1024));
const isSafariDesktop = () => typeof navigator !== 'undefined' && /Safari/i.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/i.test(navigator.userAgent);

export type PdfRequest = { blob: Blob; title?: string };
const EVT = 'vibedelib:pdf';
/** Ouvre la visionneuse sur un PDF déjà chargé. */
export const showPdf = (blob: Blob, title?: string) => window.dispatchEvent(new CustomEvent<PdfRequest>(EVT, { detail: { blob: new Blob([blob], { type: 'application/pdf' }), title } }));

/** À monter une seule fois (Layout) : écoute les demandes d'ouverture et affiche la modale. */
export function PdfViewerHost() {
  const [req, setReq] = useState<PdfRequest | null>(null);
  useEffect(() => {
    const on = (e: Event) => setReq((e as CustomEvent<PdfRequest>).detail);
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);
  return req ? <PdfViewer blob={req.blob} title={req.title} onClose={() => setReq(null)} /> : null;
}

export default function PdfViewer({ blob, title, onClose }: { blob: Blob; title?: string; onClose: () => void }) {
  const [zoom, setZoom] = useState<string>('page-width');
  const [mobile, setMobile] = useState(isMobileDevice); const [safari, setSafari] = useState(isSafariDesktop);
  const blobUrl = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(blobUrl), [blobUrl]);
  useEffect(() => {
    const onResize = () => { setMobile(isMobileDevice()); setSafari(isSafariDesktop()); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('resize', onResize); window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const level = zoom === 'page-width' ? 100 : parseInt(zoom, 10) || 100;
  const setPct = (n: number) => setZoom(String(Math.min(400, Math.max(50, n))));
  const src = `${blobUrl}#zoom=${zoom === 'page-width' ? 'page-width' : level}&toolbar=1&navpanes=0`;

  return (
    <div role="dialog" aria-modal="true" aria-label={title || 'Document PDF'} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 8 }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 960, maxHeight: '95vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={18} color="#ef4444" />
          <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 14, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || 'Document'}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, border: '1px solid #e2e8f0', borderRadius: 8, padding: 2 }}>
            <button onClick={() => setPct(level - 25)} disabled={level <= 50} title="Réduire" aria-label="Réduire" style={zoomBtn(level <= 50)}><ZoomOut size={15} /></button>
            <span style={{ minWidth: 42, textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#475569' }}>{level}%</span>
            <button onClick={() => setPct(level + 25)} disabled={level >= 400} title="Agrandir" aria-label="Agrandir" style={zoomBtn(level >= 400)}><ZoomIn size={15} /></button>
          </div>
          <button onClick={() => setZoom('page-width')} title="Ajuster à la largeur" aria-label="Ajuster à la largeur" style={{ ...zoomTextBtn, background: zoom === 'page-width' ? '#ede9fe' : '#fff', color: zoom === 'page-width' ? '#6d28d9' : '#475569' }}><Maximize2 size={14} /></button>
          {!mobile && <button onClick={() => window.open(blobUrl, '_blank', 'noopener')} title="Ouvrir dans un onglet" aria-label="Ouvrir dans un onglet" style={zoomTextBtn}><ExternalLink size={14} /></button>}
          <button onClick={onClose} aria-label="Fermer" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex' }}><X size={20} /></button>
        </div>
        <div style={{ flex: 1, minHeight: 0, background: '#f1f5f9', display: 'flex', flexDirection: 'column' }}>
          {mobile || safari
            ? <CanvasPdfViewer source={blob} zoom={level} />
            : <iframe key={`${blobUrl}-${zoom}`} src={src} title={title || 'Document PDF'} style={{ width: '100%', height: '80vh', border: 'none', display: 'block' }} />}
        </div>
      </div>
    </div>
  );
}

/** Rendu pdf.js multi-pages (mobile : les iframes PDF ne s'affichent pas ; Safari macOS : le lecteur natif ignore le zoom). */
function CanvasPdfViewer({ source, zoom }: { source: Blob; zoom: number }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { const { pdfjsLib, pdfDocumentOptions } = await import('./pdfjs'); /* chargé à la demande : le worker pdf.js pèse lourd */ const d = await pdfjsLib.getDocument({ data: new Uint8Array(await source.arrayBuffer()), ...pdfDocumentOptions }).promise; if (!cancelled) setDoc(d); }
      catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Erreur de chargement du PDF'); }
    })();
    return () => { cancelled = true; };
  }, [source]);
  if (error) return <div style={{ margin: 16, padding: 16, background: '#fef2f2', color: '#b91c1c', borderRadius: 8, fontSize: 13 }}>{error}</div>;
  if (!doc) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 280, color: '#64748b' }}><Loader2 className="animate-spin" size={28} /></div>;
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 8 }}>
      <div style={{ width: `${zoom}%`, minWidth: '100%' }}>
        {Array.from({ length: doc.numPages }, (_, i) => i + 1).map((p) => (
          <div key={p} style={{ marginBottom: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.2)', background: '#fff' }}><PdfPageCanvas doc={doc} page={p} /></div>))}
      </div>
    </div>
  );
}

/** Une page PDF dans un <canvas>, à la largeur du conteneur. */
function PdfPageCanvas({ doc, page }: { doc: PDFDocumentProxy; page: number }) {
  const wrap = useRef<HTMLDivElement>(null); const canvas = useRef<HTMLCanvasElement>(null); const task = useRef<RenderTask | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cv = canvas.current; if (!cv) return;
      if (task.current) { try { task.current.cancel(); } catch { /* ignore */ } try { await task.current.promise; } catch { /* annulé */ } }
      if (cancelled) return;
      try {
        setErr(false);
        const p = await doc.getPage(Math.max(1, Math.min(page, doc.numPages)));
        if (cancelled) return;
        const base = p.getViewport({ scale: 1 }); const vp = p.getViewport({ scale: (wrap.current?.clientWidth || 700) / base.width });
        cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
        task.current = p.render({ canvas: cv, viewport: vp }); await task.current.promise;
      } catch (e) { if ((e as { name?: string })?.name !== 'RenderingCancelledException' && !cancelled) setErr(true); }
    })();
    return () => { cancelled = true; try { task.current?.cancel(); } catch { /* ignore */ } };
  }, [doc, page]);
  return (
    <div ref={wrap} style={{ position: 'relative', width: '100%' }}>
      <canvas ref={canvas} style={{ width: '100%', display: 'block', borderRadius: 4, background: '#fff' }} />
      {err && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fef2f2', color: '#b91c1c', fontSize: 12, fontWeight: 600 }}>Impossible d'afficher la page.</div>}
    </div>
  );
}

const zoomBtn = (disabled: boolean): CSSProperties => ({ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, border: 'none', background: 'transparent', borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer', color: disabled ? '#cbd5e1' : '#475569' });
const zoomTextBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', color: '#475569', fontSize: 12, fontWeight: 700, cursor: 'pointer' };
