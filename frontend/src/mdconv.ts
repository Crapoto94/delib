/**
 * Conversions Markdown ⇄ éditeur. Le texte est STOCKÉ en Markdown (le suivi des modifications et le rendu en dépendent) :
 *  - paragraphes séparés par une ligne vide, retour à la ligne simple (Maj + Entrée) = « \n » dans le paragraphe ;
 *  - gras `**…**` (les « Article N » du dispositif), italique `*…*`, listes `- ` et `1. ` ;
 *  - images `![alt](src)` (src en data-URL : copier/coller depuis Word ou insertion) ;
 *  - tableaux au format Markdown (GFM) : `| a | b |` + ligne de séparation `| --- | --- |`.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(s: string): string {
  return esc(s)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>');
}

const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const splitRow = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function mdToHtml(md: string): string {
  const src = (md || '').replace(/\r\n/g, '\n').trim();
  if (!src) return '<p></p>';
  return src.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    if (lines.length >= 2 && lines[0].includes('|') && isTableSep(lines[1])) {
      const head = splitRow(lines[0]); const rows = lines.slice(2).map(splitRow);
      return `<table><tbody><tr>${head.map((c) => `<th><p>${inline(c)}</p></th>`).join('')}</tr>`
        + `${rows.map((r) => `<tr>${r.map((c) => `<td><p>${inline(c)}</p></td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }
    if (lines.every((l) => /^\s*!\[[^\]]*\]\([^)]+\)\s*$/.test(l))) return `<p>${lines.map((l) => inline(l.trim())).join('</p><p>')}</p>`;
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return `<ul>${lines.map((l) => `<li><p>${inline(l.replace(/^\s*[-*]\s+/, ''))}</p></li>`).join('')}</ul>`;
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return `<ol>${lines.map((l) => `<li><p>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</p></li>`).join('')}</ol>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}

type PMNode = { type: string; text?: string; marks?: { type: string }[]; attrs?: any; content?: PMNode[] };

function inlineMd(nodes: PMNode[] = []): string {
  return nodes.map((n) => {
    if (n.type === 'hardBreak') return '\n';
    if (n.type === 'image') return `![${n.attrs?.alt ?? ''}](${n.attrs?.src ?? ''})`;
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
    if (b.type === 'paragraph') { const t = inlineMd(b.content).replace(/[ \t]+$/g, ''); if (t.trim()) blocks.push(t); }
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
