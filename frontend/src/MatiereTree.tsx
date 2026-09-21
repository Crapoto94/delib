import { ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { api, org as orgPath } from './api';
import { useAuth } from './auth';

type Noeud = { id: number; code: string; libelle: string; parentCode?: string | null; feuille?: boolean; selectionnable?: boolean; enfants?: Noeud[] };

const sansAccent = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const ligneTexte = (n: Noeud) => `${n.code} — ${n.libelle}`;

/**
 * Choix d'une matière en arborescence (MAT-04) : la nomenclature de la préfecture est présentée par niveaux,
 * seules les feuilles sont sélectionnables (même règle que le serveur). L'arbre vient de `/referentiels/matiere/tree`.
 */
export function MatiereTree({ value, onChange, disabled, className = 'input' }: {
  value?: number | string | null; onChange: (id: number | null) => void; disabled?: boolean; className?: string;
}) {
  const { org } = useAuth();
  const [items, setItems] = useState<Noeud[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [ouverts, setOuverts] = useState<Set<number>>(new Set());
  const [filtre, setFiltre] = useState('');
  const bouton = useRef<HTMLButtonElement>(null); const liste = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; haut: boolean } | null>(null);

  useEffect(() => {
    if (!org) return; let vivant = true;
    api.get(orgPath(org.id, '/referentiels/matiere/tree')).then((r) => { if (vivant) setItems(r.data.items ?? []); }).catch(() => { if (vivant) setItems([]); });
    return () => { vivant = false; };
  }, [org]);

  const { parId, parentDe } = useMemo(() => {
    const parId = new Map<number, Noeud>(); const parentDe = new Map<number, number | null>();
    const parc = (l: Noeud[], parent: number | null) => l.forEach((n) => { parId.set(n.id, n); parentDe.set(n.id, parent); parc(n.enfants ?? [], n.id); });
    parc(items, null); return { parId, parentDe };
  }, [items]);

  const ancetres = (id: number) => { const out: number[] = []; let cur = parentDe.get(id); while (cur != null) { out.push(cur); cur = parentDe.get(cur); } return out; };
  const choix = value != null && value !== '' ? parId.get(Number(value)) : undefined;
  const chemin = (n: Noeud) => { const out: Noeud[] = [n]; let cur = n; for (;;) { const p = parentDe.get(cur.id); if (p == null) break; const pn = parId.get(p); if (!pn) break; out.unshift(pn); cur = pn; } return out; };
  const libelle = choix ? chemin(choix).map(ligneTexte).join(' › ') : '';

  const placer = () => {
    const r = bouton.current?.getBoundingClientRect(); if (!r) return;
    const h = Math.min(380, window.innerHeight * 0.6); const haut = window.innerHeight - r.bottom < h && r.top > window.innerHeight - r.bottom;
    setPos({ top: haut ? r.top : r.bottom, left: Math.max(4, Math.min(r.left, window.innerWidth - Math.max(r.width, 320) - 4)), width: Math.max(r.width, 320), haut });
  };
  useLayoutEffect(() => { if (ouvert) placer(); }, [ouvert]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: MouseEvent) => { const t = e.target as Node; if (!bouton.current?.contains(t) && !liste.current?.contains(t)) setOuvert(false); };
    const suivre = () => placer();
    document.addEventListener('mousedown', fermer); window.addEventListener('resize', suivre); window.addEventListener('scroll', suivre, true);
    return () => { document.removeEventListener('mousedown', fermer); window.removeEventListener('resize', suivre); window.removeEventListener('scroll', suivre, true); };
  }, [ouvert]); // eslint-disable-line react-hooks/exhaustive-deps

  const ouvrir = () => {
    if (disabled) return; setFiltre('');
    setOuverts((prev) => { const s = new Set(prev); items.forEach((n) => { if ((n.enfants ?? []).length) s.add(n.id); }); if (choix) ancetres(choix.id).forEach((id) => s.add(id)); return s; });
    setOuvert(true);
  };
  const fermer = () => { setOuvert(false); bouton.current?.focus(); };
  const choisir = (n: Noeud) => { onChange(n.id); fermer(); };
  const basculer = (id: number) => setOuverts((prev) => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });

  const mots = sansAccent(filtre).split(/\s+/).filter(Boolean);
  const garde = useMemo(() => {
    const ok = new Set<number>();
    const marcher = (n: Noeud): boolean => {
      const enfantsGardes = (n.enfants ?? []).map(marcher).some(Boolean);
      const trouve = !mots.length || mots.every((m) => sansAccent(`${n.code} ${n.libelle}`).includes(m)) || enfantsGardes;
      if (trouve) ok.add(n.id);
      return trouve;
    };
    items.forEach(marcher); return ok;
  }, [items, filtre]); // eslint-disable-line react-hooks/exhaustive-deps

  const lignes = (l: Noeud[], depth: number): ReactNode[] => l.flatMap((n) => {
    if (!garde.has(n.id)) return [];
    const enfants = n.enfants ?? [];
    const selectionnable = n.selectionnable ?? n.feuille ?? enfants.length === 0;
    const estOuvert = mots.length > 0 || ouverts.has(n.id);
    const courant = choix?.id === n.id;
    const row = (
      <li key={n.id} role="treeitem" aria-level={depth + 1} aria-selected={courant} aria-expanded={enfants.length ? estOuvert : undefined}>
        <div className="flex items-center gap-1 rounded pr-2 hover:bg-soft" style={{ paddingLeft: 6 + depth * 16 }}>
          {enfants.length ? (
            <button type="button" tabIndex={-1} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-mute hover:bg-line" onClick={() => basculer(n.id)} aria-label={estOuvert ? 'Replier' : 'Déplier'}>{estOuvert ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
          ) : <span className="h-6 w-6 shrink-0" aria-hidden="true" />}
          {selectionnable ? (
            <button type="button" className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-[13px] ${courant ? 'font-semibold text-head' : 'text-ink'}`} onClick={() => choisir(n)}>
              <span className="min-w-0 flex-1 truncate"><span className="font-mono text-[11px] text-mute">{n.code}</span> {n.libelle}</span>
              {courant && <Check className="h-4 w-4 shrink-0 text-action" aria-label="Sélectionné" />}
            </button>
          ) : (
            <span className="min-w-0 flex-1 truncate py-1.5 text-[13px] font-semibold text-slate-700"><span className="font-mono text-[11px] text-mute">{n.code}</span> {n.libelle}</span>
          )}
        </div>
      </li>);
    return [row, ...(enfants.length && estOuvert ? lignes(enfants, depth + 1) : [])];
  });

  return (
    <span className="relative block">
      <button ref={bouton} type="button" disabled={disabled} className={`${className} flex items-center justify-between gap-2 text-left`} onClick={() => (ouvert ? fermer() : ouvrir())} aria-haspopup="tree" aria-expanded={ouvert}>
        <span className={`min-w-0 flex-1 truncate ${!choix ? 'text-mute' : ''}`} title={libelle}>{choix ? libelle : '— choisir —'}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-mute" aria-hidden="true" />
      </button>
      {ouvert && pos && createPortal(
        <div ref={liste} style={{ position: 'fixed', left: pos.left, width: pos.width, ...(pos.haut ? { bottom: window.innerHeight - pos.top + 4 } : { top: pos.top + 4 }), zIndex: 70 }}
          className="overflow-hidden rounded-lg border border-line bg-surface shadow-float" onMouseDown={(e) => e.stopPropagation()}>
          <div className="border-b border-line p-2"><input autoFocus className="input !py-1.5" placeholder="Rechercher une matière…" aria-label="Rechercher une matière" value={filtre} onChange={(e) => setFiltre(e.target.value)} /></div>
          <ul role="tree" className="max-h-[min(340px,50vh)] overflow-y-auto py-1">
            {!garde.size && <li className="px-3 py-2 text-[13px] text-mute">Aucune matière trouvée</li>}
            {lignes(items, 0)}
          </ul>
          {choix && <div className="border-t border-line p-2 text-right"><button type="button" className="text-[12px] font-semibold text-action hover:underline" onClick={() => { onChange(null); fermer(); }}>Retirer la matière</button></div>}
        </div>, document.body)}
    </span>
  );
}
