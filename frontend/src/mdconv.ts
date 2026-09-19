/**
 * Conversions Markdown ⇄ éditeur. Le texte est STOCKÉ en Markdown (le suivi des modifications et le PDF en dépendent) :
 *  - paragraphes séparés par une ligne vide, retour à la ligne simple (Maj + Entrée) = « \n » dans le paragraphe ;
 *  - gras `**…**` (les « Article N » du dispositif), italique `*…*`, listes `- ` et `1. `.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(s: string): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>');
}

export function mdToHtml(md: string): string {
  const src = (md || '').replace(/\r\n/g, '\n').trim();
  if (!src) return '<p></p>';
  return src.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return `<ul>${lines.map((l) => `<li><p>${inline(l.replace(/^\s*[-*]\s+/, ''))}</p></li>`).join('')}</ul>`;
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return `<ol>${lines.map((l) => `<li><p>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</p></li>`).join('')}</ol>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}

type PMNode = { type: string; text?: string; marks?: { type: string }[]; content?: PMNode[] };

function inlineMd(nodes: PMNode[] = []): string {
  return nodes.map((n) => {
    if (n.type === 'hardBreak') return '\n';
    let t = n.text ?? '';
    if (!t) return '';
    const bold = n.marks?.some((m) => m.type === 'bold'); const it = n.marks?.some((m) => m.type === 'italic');
    if (it) t = `*${t}*`;
    if (bold) t = `**${t}**`;
    return t;
  }).join('').replace(/\*\*\*\*/g, '');
}

export function docToMd(doc: PMNode): string {
  const blocks: string[] = [];
  for (const b of doc.content ?? []) {
    if (b.type === 'paragraph') { const t = inlineMd(b.content).replace(/[ \t]+$/g, ''); if (t.trim()) blocks.push(t); }
    else if (b.type === 'bulletList' || b.type === 'orderedList') {
      const items = (b.content ?? []).map((li, i) => `${b.type === 'bulletList' ? '-' : `${i + 1}.`} ${inlineMd(li.content?.[0]?.content)}`.trimEnd());
      blocks.push(items.join('\n'));
    }
  }
  return blocks.join('\n\n');
}
