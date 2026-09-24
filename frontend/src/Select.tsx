import { Children, ChangeEvent, Fragment, isValidElement, ReactNode, SelectHTMLAttributes, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

/**
 * Liste déroulante à zone de saisie (D106) : remplace `<select>` partout, avec la même écriture (`<Select value onChange>` + `<option>`) et le même
 * événement (`e.target.value`). Une zone de saisie filtre les choix (sans tenir compte des accents ni de la casse) dès que la liste compte plus de
 * {@link SEUIL_FILTRE} choix. Clavier : ↓ ↑ pour parcourir, Entrée pour choisir, Échap pour fermer, frappe directe pour filtrer.
 * Un vrai `<select>` invisible reste dans la page : validation `required` des formulaires et lecteurs d'écran.
 */
type Opt = { value: string; label: string; disabled?: boolean; groupe?: string; noeud?: ReactNode };
export const SEUIL_FILTRE = 6;

const texte = (n: ReactNode): string => Children.toArray(n).map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : isValidElement(c) ? texte((c.props as { children?: ReactNode }).children) : '')).join('');
const sansAccent = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function lireOptions(children: ReactNode, groupe?: string): Opt[] {
  const out: Opt[] = [];
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    const p = c.props as { value?: string | number; children?: ReactNode; disabled?: boolean; label?: string; hidden?: boolean };
    if (c.type === 'option') { if (!p.hidden) out.push({ value: p.value === undefined ? texte(p.children) : String(p.value), label: texte(p.children), disabled: p.disabled, groupe, noeud: p.children }); }
    else if (c.type === 'optgroup') out.push(...lireOptions(p.children, p.label));
    else if (c.type === Fragment) out.push(...lireOptions(p.children, groupe));
  });
  return out;
}

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value' | 'defaultValue'> & {
  value?: string | number | readonly string[] | null; defaultValue?: string | number; onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
};

export function Select({ value, defaultValue, onChange, children, className = 'input', disabled, required, autoFocus, name, id, title, ...rest }: Props) {
  const options = useMemo(() => lireOptions(children), [children]);
  const [interne, setInterne] = useState<string>(defaultValue === undefined ? '' : String(defaultValue));
  const controle = value !== undefined;
  const courant = controle ? (value === null ? '' : String(value)) : interne;
  const choisi = options.find((o) => o.value === courant);
  const [ouvert, setOuvert] = useState(false); const [filtre, setFiltre] = useState(''); const [actif, setActif] = useState(0);
  const bouton = useRef<HTMLButtonElement>(null); const liste = useRef<HTMLDivElement>(null); const saisie = useRef<HTMLInputElement>(null); const ul = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; haut: boolean } | null>(null);
  const filtrable = options.length > SEUIL_FILTRE;

  const visibles = useMemo(() => {
    const mots = sansAccent(filtre).split(/\s+/).filter(Boolean);
    return options.filter((o) => !mots.length || mots.every((m) => sansAccent(o.label).includes(m)));
  }, [options, filtre]);

  const placer = () => {
    const r = bouton.current?.getBoundingClientRect(); if (!r) return;
    const h = Math.min(340, window.innerHeight * 0.5); const haut = window.innerHeight - r.bottom < h && r.top > window.innerHeight - r.bottom;
    setPos({ top: haut ? r.top : r.bottom, left: Math.max(4, Math.min(r.left, window.innerWidth - Math.max(r.width, 240) - 4)), width: Math.max(r.width, 240), haut });
  };
  useLayoutEffect(() => { if (ouvert) placer(); }, [ouvert]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: MouseEvent) => { const t = e.target as Node; if (!bouton.current?.contains(t) && !liste.current?.contains(t)) setOuvert(false); };
    const suivre = () => placer();
    document.addEventListener('mousedown', fermer); window.addEventListener('resize', suivre); window.addEventListener('scroll', suivre, true);
    return () => { document.removeEventListener('mousedown', fermer); window.removeEventListener('resize', suivre); window.removeEventListener('scroll', suivre, true); };
  }, [ouvert]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { ul.current?.querySelector('[data-actif="true"]')?.scrollIntoView({ block: 'nearest' }); }, [actif, ouvert, visibles]);
  useEffect(() => { if (autoFocus) bouton.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ouvrir = () => { if (disabled) return; setFiltre(''); const i = options.findIndex((o) => o.value === courant); setActif(Math.max(0, i)); setOuvert(true); };
  const fermer = (rendreFocus = true) => { setOuvert(false); if (rendreFocus) bouton.current?.focus(); };
  const choisir = (o: Opt) => {
    if (o.disabled) return;
    if (!controle) setInterne(o.value);
    onChange?.({ target: { value: o.value, name: name ?? '' }, currentTarget: { value: o.value, name: name ?? '' } } as unknown as ChangeEvent<HTMLSelectElement>);
    fermer();
  };
  const touche = (e: React.KeyboardEvent) => {
    if (!ouvert) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); ouvrir(); } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && filtrable) { ouvrir(); setFiltre(e.key); setActif(0); } return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermer(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActif((a) => Math.min(visibles.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActif((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (visibles[actif]) choisir(visibles[actif]); }
    else if (e.key === 'Tab') setOuvert(false);
  };

  const large = /(^|\s)!?w-auto(\s|$)/.test(className);
  let dernierGroupe: string | undefined;
  return (
    <span className={`relative ${large ? 'inline-block' : 'block'}`}>
      <button ref={bouton} type="button" id={id} title={title} role="combobox" aria-expanded={ouvert} aria-haspopup="listbox" aria-label={rest['aria-label']} disabled={disabled}
        className={`${className} flex items-center justify-between gap-2 text-left`} onClick={() => (ouvert ? fermer(false) : ouvrir())} onKeyDown={touche}>
        <span className={`min-w-0 flex-1 truncate ${!choisi || choisi.value === '' ? 'text-mute' : ''}`}>{choisi ? choisi.label : '—'}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-mute" aria-hidden="true" />
      </button>
      {/* vrai <select> invisible : validation « required » des formulaires, lecteurs d'écran, tests */}
      <select tabIndex={-1} aria-hidden="true" name={name} required={required} disabled={disabled} value={courant} onChange={() => undefined} className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0">{options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}</select>
      {ouvert && pos && createPortal(
        <div ref={liste} style={{ position: 'fixed', left: pos.left, width: pos.width, ...(pos.haut ? { bottom: window.innerHeight - pos.top + 4 } : { top: pos.top + 4 }), zIndex: 70 }}
          className="overflow-hidden rounded-lg border border-line bg-surface shadow-float" onMouseDown={(e) => e.stopPropagation()}>
          {filtrable && <div className="border-b border-line p-2"><input ref={saisie} autoFocus className="input !py-1.5" placeholder="Filtrer…" aria-label="Filtrer la liste" value={filtre} onChange={(e) => { setFiltre(e.target.value); setActif(0); }} onKeyDown={touche} /></div>}
          <ul ref={ul} role="listbox" tabIndex={-1} className="max-h-[min(300px,45vh)] overflow-y-auto py-1" onKeyDown={touche}>
            {!visibles.length && <li className="px-3 py-2 text-[13px] text-mute">Aucun résultat</li>}
            {visibles.map((o, i) => {
              const entete = o.groupe && o.groupe !== dernierGroupe; dernierGroupe = o.groupe;
              return (
                <Fragment key={`${o.value}-${i}`}>
                  {entete && <li role="presentation" className="px-3 pb-0.5 pt-2 text-[11px] font-bold uppercase tracking-wider text-mute">{o.groupe}</li>}
                  <li role="option" aria-selected={o.value === courant} aria-disabled={o.disabled} data-actif={i === actif}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] ${i === actif ? 'bg-soft' : ''} ${o.disabled ? 'cursor-not-allowed opacity-50' : ''} ${o.value === '' ? 'text-mute' : ''}`}
                    onMouseEnter={() => setActif(i)} onClick={() => choisir(o)}>
                    <span className="min-w-0 flex-1">{o.noeud ?? o.label}</span>{o.value === courant && <Check className="h-4 w-4 shrink-0 text-action" aria-hidden="true" />}
                  </li>
                </Fragment>);
            })}
          </ul>
        </div>, document.body)}
    </span>
  );
}
