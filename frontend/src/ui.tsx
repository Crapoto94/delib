import { ReactNode, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { STATUTS, TYPE_ACTES } from './format';

export const Spinner = () => <Loader2 className="h-4 w-4 animate-spin" aria-label="Chargement" />;
export const Loading = ({ progress }: { progress?: { fait?: number; total?: number; phase?: string } | null } = {}) => {
  const total = Number(progress?.total ?? 0);
  const pct = total > 0 ? Math.min(100, Math.round((Number(progress?.fait ?? 0) / total) * 100)) : null;
  const fait = Number(progress?.fait ?? 0);
  return (
    <div className="flex flex-col items-center gap-2 p-6 text-mute">
      <div className="flex items-center gap-2"><Spinner /> Chargement…</div>
      {pct !== null && (
        <div className="w-full max-w-md" role="status" aria-live="polite">
          <div className="h-2 overflow-hidden rounded-full bg-line"><div className="h-full bg-action-solid transition-all" style={{ width: `${pct}%` }} /></div>
          <div className="mt-1 text-center text-[12px] tabular-nums">{fait} / {total} · {pct} %</div>
        </div>
      )}
    </div>
  );
};
export const ErrorBox = ({ msg }: { msg: string | null }) => (msg ? <div role="alert" className="rounded border border-ko/30 bg-ko-bg px-3 py-2 text-ko">{msg}</div> : null);
export const Empty = ({ children }: { children: ReactNode }) => <div className="p-8 text-center text-mute">{children}</div>;

/**
 * Pagination côté serveur (l'API renvoie déjà `total`, `limit`, `offset`) : affiche l'intervalle courant
 * et la navigation entre les pages. `page` est numérotée à partir de 1.
 */
export function Pagination({ total, limit, page, onPage, itemLabel = 'élément', className }: {
  total: number; limit: number; page: number; onPage: (page: number) => void; itemLabel?: string; className?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const courant = Math.min(Math.max(1, page), pages);
  const premier = total === 0 ? 0 : (courant - 1) * limit + 1;
  const dernier = Math.min(courant * limit, total);
  const numeros: (number | '…')[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - courant) <= 1) { if (numeros[numeros.length - 1] !== p) numeros.push(p); }
    else if (numeros[numeros.length - 1] !== '…') numeros.push('…');
  }
  const pluriel = total > 1 && !itemLabel.endsWith('s') ? 's' : '';
  return (
    <nav className={`flex flex-wrap items-center justify-between gap-3 ${className ?? ''}`} aria-label="Pagination">
      <span className="text-[12px] text-mute">{total ? <>{premier}–{dernier} sur <b>{total}</b> {itemLabel}{pluriel}</> : <>Aucun {itemLabel}</>}</span>
      {pages > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className="btn-secondary !px-2 !py-1" disabled={courant <= 1} onClick={() => onPage(courant - 1)} aria-label="Page précédente"><ChevronLeft className="h-4 w-4" /></button>
          {numeros.map((n, i) => n === '…' ? <span key={`v${i}`} className="px-1 text-mute" aria-hidden="true">…</span> : (
            <button key={n} type="button" aria-current={n === courant ? 'page' : undefined} aria-label={`Page ${n}`} onClick={() => onPage(n)}
              className={`min-w-[30px] rounded border px-2 py-1 text-[12px] font-semibold ${n === courant ? 'border-transparent bg-primary text-white' : 'border-slate-300 bg-surface text-slate-700 hover:bg-soft'}`}>{n}</button>
          ))}
          <button type="button" className="btn-secondary !px-2 !py-1" disabled={courant >= pages} onClick={() => onPage(courant + 1)} aria-label="Page suivante"><ChevronRight className="h-4 w-4" /></button>
        </div>
      )}
    </nav>
  );
}

const TONES: Record<string, string> = {
  gray: 'bg-slate-100 text-slate-700 border-slate-300/70', blue: 'bg-action/10 text-action border-action/30', ok: 'bg-ok-bg text-ok-text border-ok/30', warn: 'bg-warn-bg text-warn border-warn/30', ko: 'bg-ko-bg text-ko border-ko/30',
};
export const Badge = ({ tone = 'gray', children, title }: { tone?: keyof typeof TONES; children: ReactNode; title?: string }) => <span className={`badge ${TONES[tone]}`} title={title}>{children}</span>;
export const StatutBadge = ({ statut }: { statut: string }) => { const s = STATUTS[statut] ?? { label: statut, tone: 'gray' as const }; return <Badge tone={s.tone}>{s.label}</Badge>; };
/**
 * Colonne « statut » d'une liste d'actes : un acte encore en circuit indique OÙ il en est (l'étape courante —
 * « Service juridique », « DGS »…), pas le simple « En circuit ». Hors circuit, le statut habituel est affiché.
 */
export const StatutOuEtape = ({ statut, etape }: { statut: string; etape?: { label?: string | null; holders?: string[] | null } | null }) => (
  statut === 'en_circuit' && etape?.label
    ? <Badge tone="blue" title={etape.holders?.length ? `En attente chez ${etape.holders.join(', ')}` : undefined}>{etape.label}</Badge>
    : <StatutBadge statut={statut} />
);

/** Pastille de type d'acte : l'icône du type, seule (infobulle = libellé), un peu à l'écart du titre. */
const TYPE_ICONES: Record<string, string> = {
  deliberation: '/types/delib.png',
  voeu: '/types/delib.png',
  decision: '/types/decision.png',
  arrete: '/types/arrete.png',
};
export const TypeBadge = ({ acte, className = '' }: { acte?: any; pastille?: string; className?: string }) => {
  const code = acte?.typeCode as string | undefined;
  const info = code ? TYPE_ACTES[code] : undefined;
  const label = acte?.typeLibelle || info?.label;
  const src = code ? TYPE_ICONES[code] : undefined;
  if (!label || !src) return null;
  return <img src={src} alt="" aria-hidden="true" title={label} className={`ml-2 inline-block h-5 w-5 shrink-0 align-[-0.2em] ${className}`} />;
};

export function PageTitle({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><h1>{title}</h1><span aria-hidden="true" className="mt-1 block h-1 w-14 rounded-full bg-gradient-to-r from-action-solid to-azur" />{sub && <p className="mt-2 text-mute">{sub}</p>}</div>
      <div className="flex gap-2">{actions}</div>
    </div>
  );
}

export function Field({ label, children, hint, missing }: { label: string; children: ReactNode; hint?: string; missing?: boolean }) {
  return (
    <label className={`block ${missing ? 'rounded-md border-l-4 border-warn bg-warn-bg/50 px-3 py-2' : ''}`}>
      <span className="label">{label}{missing && <span className="ml-1 inline-block h-2 w-2 rounded-full bg-warn align-middle" title="À renseigner" aria-label="À renseigner" />}</span>
      {children}{hint && <span className="mt-1 block text-[12px] text-mute">{hint}</span>}
    </label>
  );
}

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-slate-900/60 p-4 pt-16" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} className={`card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} shadow-float`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3"><h3>{title}</h3><button className="text-mute hover:text-ink" onClick={onClose} aria-label="Fermer"><X className="h-5 w-5" /></button></div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** Petit hook de chargement : recharge quand `deps` change ; `reload()` force. */
export function useLoad<T>(fn: () => Promise<T>, deps: any[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true; setLoading(true);
    fn().then((d) => { if (live) { setData(d); setError(null); } }).catch((e) => { if (live) setError(e?.response?.data?.error || e.message); }).finally(() => live && setLoading(false));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, loading, reload: () => setN((x) => x + 1), setData };
}

/** Notification éphémère. */
export function useToast() {
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'ko' } | null>(null);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4500); return () => clearTimeout(t); }, [msg]);
  const node = msg && <div role="status" className={`fixed bottom-20 right-6 z-50 rounded px-4 py-3 shadow-float ${msg.kind === 'ok' ? 'bg-ok-solid text-white' : 'bg-ko-solid text-white'}`}>{msg.text}</div>;
  return { toast: (text: string, kind: 'ok' | 'ko' = 'ok') => setMsg({ text, kind }), node };
}

/** Interrupteur : coché = la notification part aussi par e-mail ; décoché = elle reste dans l’outil (centre de notifications) seulement. */
export function MailSwitch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-action-solid' : 'bg-slate-300'}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  );
}
