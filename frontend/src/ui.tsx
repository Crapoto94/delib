import { ReactNode, useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { STATUTS } from './format';

export const Spinner = () => <Loader2 className="h-4 w-4 animate-spin" aria-label="Chargement" />;
export const Loading = () => <div className="flex items-center gap-2 p-6 text-mute"><Spinner /> Chargement…</div>;
export const ErrorBox = ({ msg }: { msg: string | null }) => (msg ? <div role="alert" className="rounded border border-ko/30 bg-ko-bg px-3 py-2 text-ko">{msg}</div> : null);
export const Empty = ({ children }: { children: ReactNode }) => <div className="p-8 text-center text-mute">{children}</div>;

const TONES: Record<string, string> = {
  gray: 'bg-slate-100 text-slate-700 border-slate-300/70', blue: 'bg-action/10 text-action border-action/30', ok: 'bg-ok-bg text-ok-text border-ok/30', warn: 'bg-warn-bg text-warn border-warn/30', ko: 'bg-ko-bg text-ko border-ko/30',
};
export const Badge = ({ tone = 'gray', children }: { tone?: keyof typeof TONES; children: ReactNode }) => <span className={`badge ${TONES[tone]}`}>{children}</span>;
export const StatutBadge = ({ statut }: { statut: string }) => { const s = STATUTS[statut] ?? { label: statut, tone: 'gray' as const }; return <Badge tone={s.tone}>{s.label}</Badge>; };

export function PageTitle({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><h1>{title}</h1><span aria-hidden="true" className="mt-1 block h-1 w-14 rounded-full bg-gradient-to-r from-action-solid to-azur" />{sub && <p className="mt-2 text-mute">{sub}</p>}</div>
      <div className="flex gap-2">{actions}</div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block"><span className="label">{label}</span>{children}{hint && <span className="mt-1 block text-[12px] text-mute">{hint}</span>}</label>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-slate-900/60 p-4 pt-16" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} shadow-float`} onMouseDown={(e) => e.stopPropagation()}>
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
