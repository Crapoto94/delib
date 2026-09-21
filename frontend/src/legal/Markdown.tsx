import { Fragment } from 'react';

/**
 * Rendu Markdown minimal, suffisant pour les documents juridiques (CGU et licence).
 * Sous-ensemble pris en charge : titres `#` à `######`, paragraphes, listes `-` et `1.`,
 * citations `>`, filet `---`, et en ligne : `gras`, `*italique*`, `code`, `[lien](url)`.
 * Le contenu est embarqué dans l'application (import `?raw`), donc de confiance.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code class="rounded bg-soft px-1 py-0.5 font-mono text-[12px]">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" class="text-action underline">$1</a>');
}

type Bloc =
  | { t: 'h'; niveau: number; texte: string }
  | { t: 'p'; texte: string }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[] }
  | { t: 'quote'; texte: string }
  | { t: 'hr' };

const DEBUT_BLOC = /^(#{1,6}\s|[-*]\s|\d+[.)]\s|>\s?|-{3,}\s*$)/;

function parser(md: string): Bloc[] {
  const lignes = md.replace(/\r\n/g, '\n').split('\n');
  const blocs: Bloc[] = [];
  let i = 0;
  while (i < lignes.length) {
    const l = lignes[i];
    if (!l.trim()) { i++; continue; }
    const titre = /^(#{1,6})\s+(.*)$/.exec(l);
    if (titre) { blocs.push({ t: 'h', niveau: titre[1].length, texte: titre[2].trim() }); i++; continue; }
    if (/^\s*-{3,}\s*$/.test(l)) { blocs.push({ t: 'hr' }); i++; continue; }
    if (/^\s*[-*]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lignes.length && /^\s*[-*]\s+/.test(lignes[i])) { items.push(lignes[i].replace(/^\s*[-*]\s+/, '').trim()); i++; }
      blocs.push({ t: 'ul', items }); continue;
    }
    if (/^\s*\d+[.)]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lignes.length && /^\s*\d+[.)]\s+/.test(lignes[i])) { items.push(lignes[i].replace(/^\s*\d+[.)]\s+/, '').trim()); i++; }
      blocs.push({ t: 'ol', items }); continue;
    }
    if (/^\s*>/.test(l)) {
      const cite: string[] = [];
      while (i < lignes.length && /^\s*>/.test(lignes[i])) { cite.push(lignes[i].replace(/^\s*>\s?/, '').trim()); i++; }
      blocs.push({ t: 'quote', texte: cite.join(' ') }); continue;
    }
    const para: string[] = [];
    while (i < lignes.length && lignes[i].trim() && !DEBUT_BLOC.test(lignes[i])) { para.push(lignes[i].trim()); i++; }
    if (para.length === 0) { i++; continue; }
    blocs.push({ t: 'p', texte: para.join(' ') });
  }
  return blocs;
}

const HTML = ({ html, className }: { html: string; className: string }) => <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
const TEXTE = ({ html, className }: { html: string; className: string }) => <p className={className} dangerouslySetInnerHTML={{ __html: html }} />;

export function Markdown({ source }: { source: string }) {
  return (
    <div>
      {parser(source).map((b, i) => {
        switch (b.t) {
          case 'h': {
            const classes = b.niveau === 1
              ? 'mb-4 mt-1 text-[24px] font-bold leading-tight text-head'
              : b.niveau === 2
                ? 'mb-2 mt-7 border-b border-line pb-1 text-[18px] font-bold text-head'
                : b.niveau === 3
                  ? 'mb-2 mt-5 text-[15px] font-bold text-head'
                  : 'mb-1 mt-4 text-[14px] font-bold text-head';
            return <HTML key={i} className={classes} html={inline(b.texte)} />;
          }
          case 'p':
            return <TEXTE key={i} className="mb-3 text-[14px] leading-relaxed text-slate-700" html={inline(b.texte)} />;
          case 'ul':
            return (
              <ul key={i} className="mb-3 list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-slate-700">
                {b.items.map((it, k) => <li key={k} dangerouslySetInnerHTML={{ __html: inline(it) }} />)}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="mb-3 list-decimal space-y-1 pl-5 text-[14px] leading-relaxed text-slate-700">
                {b.items.map((it, k) => <li key={k} dangerouslySetInnerHTML={{ __html: inline(it) }} />)}
              </ol>
            );
          case 'quote':
            return <TEXTE key={i} className="mb-4 border-l-4 border-action/40 bg-action/5 px-4 py-3 text-[13px] leading-relaxed text-slate-700" html={inline(b.texte)} />;
          case 'hr':
            return <Fragment key={i}><hr className="my-6 border-line" /></Fragment>;
          default:
            return null;
        }
      })}
    </div>
  );
}
