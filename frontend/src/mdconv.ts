/**
 * Conversions Markdown ⇄ éditeur. Le texte est STOCKÉ en Markdown (le suivi des modifications et le rendu en dépendent) :
 *  - paragraphes séparés par une ligne vide, retour à la ligne simple (Maj + Entrée) = « \n » dans le paragraphe ;
 *  - gras `**…**` (les « Article N » du dispositif), italique `*…*`, listes `- ` et `1. ` ;
 *  - images `![alt](src)` (src en data-URL : copier/coller depuis Word ou insertion) ;
 *  - tableaux au format Markdown (GFM) : `| a | b |` + ligne de séparation `| --- | --- |`.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Réglages d'une image, conservés dans le markdown sous forme de fragment `#vd:w=…,rot=…,align=…` sur la source. */
export type ImgAttrs = { width?: number; rotation?: number; align?: 'left' | 'center' | 'right' };

/** Sépare la source de ses réglages : `data:…#vd:w=200,rot=90,align=center`. */
export function parseImgSrc(raw: string): { src: string; attrs: ImgAttrs } {
  const i = String(raw).indexOf('#vd:');
  if (i < 0) return { src: raw, attrs: {} };
  const attrs: ImgAttrs = {};
  for (const part of raw.slice(i + 4).split(',')) {
    const [k, v] = part.split('=');
    if (k === 'w' && Number(v)) attrs.width = Number(v);
    else if (k === 'rot' && Number(v)) attrs.rotation = Number(v);
    else if (k === 'align' && (v === 'left' || v === 'center' || v === 'right')) attrs.align = v;
  }
  return { src: raw.slice(0, i), attrs };
}

/** Ré-encode la source d'une image avec ses réglages (les valeurs par défaut sont omises). */
export function encodeImgSrc(src: string, a: { width?: number | null; rotation?: number | null; align?: string | null } = {}): string {
  const parts: string[] = [];
  if (a.width) parts.push(`w=${Math.round(a.width)}`);
  if (a.rotation) parts.push(`rot=${Math.round(a.rotation)}`);
  if (a.align && a.align !== 'left') parts.push(`align=${a.align}`);
  return parts.length ? `${src}#vd:${parts.join(',')}` : src;
}

function inline(s: string): string {
  return esc(s)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, raw: string) => {
      const { src, attrs } = parseImgSrc(raw);
      const da = [attrs.width ? ` data-width="${attrs.width}"` : '', attrs.rotation ? ` data-rotation="${attrs.rotation}"` : '', attrs.align ? ` data-align="${attrs.align}"` : ''].join('');
      return `<img src="${src}" alt="${alt}"${da}>`;
    })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>');
}

const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const splitRow = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

// Alignement d'un paragraphe, stocké en tête de bloc : `{center} …`, `{right} …`, `{justify} …` (rien pour « à gauche »).
const ALIGN_PREFIX = /^\s*\{(center|right|justify)\}\s*/;

export function mdToHtml(md: string): string {
  const src = (md || '').replace(/\r\n/g, '\n').trim();
  if (!src) return '<p></p>';
  return src.split(/\n{2,}/).map((block0) => {
    const am = ALIGN_PREFIX.exec(block0);
    const block = am ? block0.slice(am[0].length) : block0;
    const sty = am ? ` style="text-align:${am[1]}"` : '';
    const lines = block.split('\n');
    if (lines.length >= 2 && lines[0].includes('|') && isTableSep(lines[1])) {
      const head = splitRow(lines[0]); const rows = lines.slice(2).map(splitRow);
      return `<table><tbody><tr>${head.map((c) => `<th><p>${inline(c)}</p></th>`).join('')}</tr>`
        + `${rows.map((r) => `<tr>${r.map((c) => `<td><p>${inline(c)}</p></td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }
    // Image(s) seule(s) : nœud « image » de bloc (pas dans un paragraphe).
    if (lines.every((l) => /^\s*!\[[^\]]*\]\([^)]+\)\s*$/.test(l))) return lines.map((l) => inline(l.trim())).join('');
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return `<ul>${lines.map((l) => `<li><p>${inline(l.replace(/^\s*[-*]\s+/, ''))}</p></li>`).join('')}</ul>`;
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return `<ol>${lines.map((l) => `<li><p>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</p></li>`).join('')}</ol>`;
    return `<p${sty}>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}

type PMNode = { type: string; text?: string; marks?: { type: string }[]; attrs?: any; content?: PMNode[] };

function inlineMd(nodes: PMNode[] = []): string {
  return nodes.map((n) => {
    if (n.type === 'hardBreak') return '\n';
    if (n.type === 'image') return `![${n.attrs?.alt ?? ''}](${encodeImgSrc(n.attrs?.src ?? '', n.attrs)})`;
    let t = n.text ?? '';
    if (!t) return '';
    const bold = n.marks?.some((m) => m.type === 'bold'); const it = n.marks?.some((m) => m.type === 'italic');
    if (it) t = `*${t}*`;
    if (bold) t = `**${t}**`;
    return t;
  }).join('').replace(/\*\*\*\*/g, '');
}

const cellMd = (cell: PMNode) => (cell.content ?? []).map((p) => inlineMd(p.content)).join(' ').replace(/\|/g, '\\|').trim();

export function docToMd(doc: PMNode): string {
  const blocks: string[] = [];
  for (const b of doc.content ?? []) {
    if (b.type === 'paragraph') {
      const t = inlineMd(b.content).replace(/[ \t]+$/g, '');
      const a = b.attrs?.textAlign;
      if (t.trim()) blocks.push(a && a !== 'left' ? `{${a}} ${t}` : t);
    }
    else if (b.type === 'image') blocks.push(`![${b.attrs?.alt ?? ''}](${encodeImgSrc(b.attrs?.src ?? '', b.attrs)})`);
    else if (b.type === 'bulletList' || b.type === 'orderedList') {
      const items = (b.content ?? []).map((li, i) => `${b.type === 'bulletList' ? '-' : `${i + 1}.`} ${inlineMd(li.content?.[0]?.content)}`.trimEnd());
      blocks.push(items.join('\n'));
    } else if (b.type === 'table') {
      const rows = b.content ?? [];
      const head = (rows[0]?.content ?? []).map(cellMd);
      const cols = Math.max(head.length, 1);
      const lines = [`| ${head.join(' | ')} |`, `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`];
      for (const r of rows.slice(1)) lines.push(`| ${(r.content ?? []).map(cellMd).join(' | ')} |`);
      blocks.push(lines.join('\n'));
    }
  }
  return blocks.join('\n\n');
}
