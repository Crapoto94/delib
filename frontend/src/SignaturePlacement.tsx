import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, MapPin, Move } from 'lucide-react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { api, errMsg, org as orgPath } from './api';
import { useAuth } from './auth';
import { Modal, Spinner } from './ui';

/** Emplacement de la signature (mécanisme du Hub DSI) : page 1-based, centre en % (gauche/haut), w/h en points. */
export type Placement = { page: number; x: number; y: number; w: number; h: number };
const DEFAULT_W = 150;
const DEFAULT_H = 60;

/**
 * Positionnement de la signature du maire sur le document de l'acte, AVANT l'envoi au parapheur. On reprend le
 * mécanisme du Hub DSI : on fait glisser un cadre sur la page ; la position est enregistrée (page, centre en %, taille
 * en points) et transmise telle quelle au parapheur au moment de l'envoi.
 */
export default function SignaturePlacement({ acte, initial, onClose, onSaved, toast }: {
  acte: any; initial?: Placement | null; onClose: () => void; onSaved: () => void; toast: (m: string, k?: 'ok' | 'ko') => void;
}) {
  const { org } = useAuth(); const o = org!.id;
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(initial?.page || 1);
  const [pos, setPos] = useState({ x: initial?.x ?? 75, y: initial?.y ?? 85 });
  const [base, setBase] = useState<{ w: number; h: number; pxW: number; pxH: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null); const canvas = useRef<HTMLCanvasElement>(null); const task = useRef<RenderTask | null>(null);
  const dragging = useRef(false);

  // Chargement du document envoyé au parapheur (aperçu « deliberation », gabarit du type d'acte).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.post(orgPath(o, `/actes/${acte.id}/apercu`), { cible: 'deliberation', mode: 'propre' }, { responseType: 'blob' });
        const { pdfjsLib, pdfDocumentOptions } = await import('./pdfjs');
        const d = await pdfjsLib.getDocument({ data: new Uint8Array(await (r.data as Blob).arrayBuffer()), ...pdfDocumentOptions }).promise;
        if (!cancelled) setDoc(d);
      } catch (e) { if (!cancelled) setError(errMsg(e)); }
    })();
    return () => { cancelled = true; };
  }, [acte.id, o]);

  const draw = useCallback(async () => {
    const d = doc; const cv = canvas.current; if (!d || !cv || !wrap.current) return;
    try {
      if (task.current) { try { task.current.cancel(); } catch { /* ignore */ } }
      const p = await d.getPage(Math.max(1, Math.min(page, d.numPages)));
      const vp0 = p.getViewport({ scale: 1 });
      const width = wrap.current.clientWidth || 600;
      const vp = p.getViewport({ scale: width / vp0.width });
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      setBase({ w: vp0.width, h: vp0.height, pxW: vp.width, pxH: vp.height });
      task.current = p.render({ canvas: cv, viewport: vp });
      await task.current.promise;
    } catch { /* rendu annulé */ }
  }, [doc, page]);
  useEffect(() => { draw(); }, [draw]);

  const box = base ? { w: DEFAULT_W * (base.pxW / base.w), h: DEFAULT_H * (base.pxH / base.h) } : { w: 120, h: 48 };
  const moveTo = (clientX: number, clientY: number) => {
    const r = wrap.current?.getBoundingClientRect(); if (!r) return;
    setPos({ x: Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)), y: Math.max(0, Math.min(100, ((clientY - r.top) / r.height) * 100)) });
  };
  const enregistrer = async () => {
    setBusy(true);
    try {
      await api.put(orgPath(o, `/actes/${acte.id}/signature-position`), { page, x: Math.round(pos.x * 100) / 100, y: Math.round(pos.y * 100) / 100, w: DEFAULT_W, h: DEFAULT_H });
      toast('Emplacement de la signature enregistré'); onSaved(); onClose();
    } catch (e) { toast(errMsg(e), 'ko'); setBusy(false); }
  };

  return (
    <Modal title="Positionner la signature du maire" onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-[13px] text-mute">Faites glisser le cadre bleu à l'endroit où le maire signera, sur le document qui partira au parapheur. Cette position est transmise au parapheur (même mécanisme que le Hub DSI).</p>
        {error && <div className="rounded bg-ko-bg p-3 text-[13px] text-ko">{error}</div>}
        {!error && !doc && <div className="flex h-60 items-center justify-center text-mute"><Loader2 className="animate-spin" size={26} /></div>}
        {doc && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold uppercase tracking-wider text-mute">Page</span>
              <div className="flex items-center gap-2">
                <button className="btn-secondary !px-2 !py-1" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Page précédente"><ChevronLeft className="h-4 w-4" /></button>
                <span className="min-w-[58px] text-center text-[13px] font-semibold">{page} / {doc.numPages}</span>
                <button className="btn-secondary !px-2 !py-1" onClick={() => setPage((p) => Math.min(doc.numPages, p + 1))} disabled={page >= doc.numPages} aria-label="Page suivante"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
            <div ref={wrap} className="relative max-h-[60vh] overflow-auto rounded border-2 border-line bg-soft"
              onPointerMove={(e) => { if (dragging.current) moveTo(e.clientX, e.clientY); }} onPointerUp={() => { dragging.current = false; }} onPointerLeave={() => { dragging.current = false; }}>
              <canvas ref={canvas} className="block w-full bg-white" />
              <div onPointerDown={(e) => { e.preventDefault(); dragging.current = true; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
                className="absolute flex cursor-grab flex-col items-center justify-center rounded border-2 border-action bg-action/20"
                style={{ left: `calc(${pos.x}% - ${box.w / 2}px)`, top: `calc(${pos.y}% - ${box.h / 2}px)`, width: box.w, height: box.h, touchAction: 'none' }}>
                <Move className="h-3.5 w-3.5 text-action" />
                <span className="px-1 text-center text-[9px] font-bold uppercase leading-tight text-action">Signature</span>
              </div>
            </div>
          </>
        )}
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" disabled={busy || !doc} onClick={enregistrer}>{busy && <Spinner />}<MapPin className="h-4 w-4" /> Valider la position</button></div>
      </div>
    </Modal>
  );
}
