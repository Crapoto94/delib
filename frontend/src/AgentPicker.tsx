import { useEffect, useRef, useState } from 'react';
import { api } from './api';

export type AgentHit = { username: string; displayName: string; email: string | null; direction: string | null; service: string | null; poste: string | null; knownLocally: boolean };

/** Recherche d'agents (identifiant de connexion, nom, direction) avec anti-rebond ; les deux premières lettres déclenchent la recherche. */
export function useAgentSearch(q: string) {
  const [hits, setHits] = useState<AgentHit[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const text = q.trim().replace(/^@/, '');
    if (text.length < 2) { setHits([]); return; }
    setBusy(true);
    const t = setTimeout(() => {
      api.get('/directory/agents/autocompletion', { params: { q: text } }).then((r) => setHits(r.data.items)).catch(() => setHits([])).finally(() => setBusy(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return { hits, busy };
}

function Hit({ a, active, onPick }: { a: AgentHit; active: boolean; onPick: () => void }) {
  return (
    <li role="option" aria-selected={active}>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onPick} className={`block w-full px-3 py-2 text-left ${active ? 'bg-soft' : 'hover:bg-soft'}`}>
        <span className="font-semibold">{a.displayName}</span> <span className="text-[12px] text-mute">@{a.username}</span>
        <span className="block text-[11px] text-mute">{[a.poste, a.direction].filter(Boolean).join(' · ')}{!a.knownLocally ? ' · jamais connecté' : ''}</span>
      </button>
    </li>
  );
}

/**
 * Champ « agent » : on tape un nom, un prénom ou @identifiant ; la liste propose les agents (déjà connectés, puis annuaire RH).
 * `value` = identifiant de connexion choisi (chaîne vide = aucun).
 */
export default function AgentPicker({ value, onChange, placeholder = 'Tapez @nom ou un prénom…', label = 'Agent', required, autoFocus }: { value: string; onChange: (username: string, hit?: AgentHit) => void; placeholder?: string; label?: string; required?: boolean; autoFocus?: boolean }) {
  const [text, setText] = useState(value); const [open, setOpen] = useState(false); const [cur, setCur] = useState(0);
  const { hits, busy } = useAgentSearch(open ? text : '');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { setText(value); }, [value]);
  useEffect(() => { const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const pick = (a: AgentHit) => { onChange(a.username, a); setText(a.username); setOpen(false); };
  return (
    <div className="relative" ref={box}>
      <input className="input" role="combobox" aria-expanded={open && hits.length > 0} aria-autocomplete="list" aria-label={label} required={required} autoFocus={autoFocus} value={text} placeholder={placeholder}
        onChange={(e) => { setText(e.target.value); setOpen(true); setCur(0); if (!e.target.value) onChange(''); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setCur((c) => Math.min(c + 1, hits.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setCur((c) => Math.max(c - 1, 0)); }
          else if (e.key === 'Enter' && open && hits[cur]) { e.preventDefault(); pick(hits[cur]); }
          else if (e.key === 'Escape') setOpen(false);
        }} onBlur={() => { const t = text.trim().replace(/^@/, ''); if (t && t !== value) onChange(t.toLowerCase()); }} />
      {open && text.trim().replace(/^@/, '').length >= 2 && (
        <ul role="listbox" className="card absolute left-0 right-0 z-40 mt-1 max-h-72 overflow-auto shadow-float">
          {busy && !hits.length && <li className="px-3 py-2 text-mute">Recherche…</li>}
          {!busy && !hits.length && <li className="px-3 py-2 text-mute">Aucun agent trouvé.</li>}
          {hits.map((a, i) => <Hit key={a.username} a={a} active={i === cur} onPick={() => pick(a)} />)}
        </ul>)}
    </div>
  );
}

/** Liste d'agents (groupes de valideurs…) : puces supprimables + champ d'ajout avec autocomplétion. */
export function AgentList({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-1">{value.map((u) => (
        <li key={u} className="flex items-center gap-1 rounded-full bg-soft py-0.5 pl-3 pr-1 text-[12px]">@{u}<button type="button" aria-label={`Retirer ${u}`} className="rounded-full px-1.5 text-mute hover:bg-surface hover:text-ko" onClick={() => onChange(value.filter((x) => x !== u))}>×</button></li>))}
        {!value.length && <li className="text-[12px] text-mute">Aucun membre.</li>}</ul>
      <AgentPicker value={draft} label="Ajouter un membre" placeholder="Ajouter : tapez @nom…" onChange={(u) => { if (u && !value.includes(u)) { onChange([...value, u]); setDraft(''); setTimeout(() => setDraft(''), 0); } }} />
    </div>
  );
}

/**
 * Zone de texte avec mentions : taper « @ » puis quelques lettres ouvre la liste des agents ; choisir insère @identifiant
 * (les personnes mentionnées sont notifiées).
 */
export function MentionTextarea({ value, onChange, rows = 3, placeholder }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [q, setQ] = useState<string | null>(null); const [start, setStart] = useState(0); const [cur, setCur] = useState(0);
  const { hits } = useAgentSearch(q ?? '');
  const detect = (v: string, caret: number) => {
    const m = /(?:^|\s)@([\p{L}0-9._-]{2,})$/u.exec(v.slice(0, caret));
    if (m) { setQ(m[1]); setStart(caret - m[1].length - 1); setCur(0); } else setQ(null);
  };
  const insert = (a: AgentHit) => {
    const el = ref.current!; const caret = el.selectionStart;
    const next = `${value.slice(0, start)}@${a.username} ${value.slice(caret)}`;
    onChange(next); setQ(null);
    setTimeout(() => { el.focus(); const pos = start + a.username.length + 2; el.setSelectionRange(pos, pos); }, 0);
  };
  return (
    <div className="relative">
      <textarea ref={ref} className="input" rows={rows} value={value} placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart); }}
        onKeyDown={(e) => {
          if (q === null || !hits.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setCur((c) => Math.min(c + 1, hits.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setCur((c) => Math.max(c - 1, 0)); }
          else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(hits[cur]); }
          else if (e.key === 'Escape') setQ(null);
        }} />
      {q !== null && hits.length > 0 && (
        <ul role="listbox" className="card absolute bottom-full left-0 z-40 mb-1 max-h-64 w-80 overflow-auto shadow-float">{hits.map((a, i) => <Hit key={a.username} a={a} active={i === cur} onPick={() => insert(a)} />)}</ul>)}
    </div>
  );
}
