/**
 * Modèles Word (.docx) à variables (comme ODP) : on fusionne le document avec les valeurs des zones de la délibération.
 *
 * Un .docx est une archive ZIP ; les variables sont remplacées dans `word/document.xml` (JSZip + expressions
 * régulières), en gérant deux écueils de Word :
 *  - les variables fragmentées par des balises (`{expo</w:t>…<w:t>se}`) : les balises à l'intérieur des accolades sont retirées ;
 *  - les blocs conditionnels `{IF variable|texte}` : le texte n'est conservé que si la variable a une valeur.
 * Les valeurs sont échappées (XML) et les sauts de ligne deviennent des `<w:br/>` (reste dans le même paragraphe).
 */
const JSZip = require('jszip');
const { E } = require('../../shared/errors');

const escapeXml = (str) => String(str ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const BOLD = '\u0002'; // marqueur interne : encadre un passage en gras dans une valeur

/** Valeur insérée dans un run Word : gras (marqueur), sauts de ligne en <w:br/> (même paragraphe). */
const valeurRun = (v) => {
  const parts = String(v ?? '').split(BOLD);
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const text = escapeXml(parts[i]).replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
    if (i % 2 === 1) out += `</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r><w:r><w:t xml:space="preserve">`;
    else out += text;
  }
  return out;
};

/** Blocs conditionnels `{IF variable|texte}` (accolades imbriquées comptées) : texte conservé si la variable est non vide. */
function processConditionals(xml, variables) {
  const matches = [];
  const re = /\{IF\s+(\w+(?:\.\w+)*)\|/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const start = m.index; const textStart = m.index + m[0].length;
    let braces = 1; let end = textStart;
    while (end < xml.length && braces > 0) { if (xml[end] === '{') braces++; if (xml[end] === '}') braces--; end++; }
    matches.push({ start, length: end - start, key: m[1], text: xml.substring(textStart, end - 1) });
  }
  let out = xml;
  for (let i = matches.length - 1; i >= 0; i--) {
    const x = matches[i];
    const val = variables[`{${x.key}}`];
    const rep = val && String(val).trim() !== '' ? x.text : '';
    out = out.substring(0, x.start) + rep + out.substring(x.start + x.length);
  }
  return out;
}

/** Fusionne un modèle .docx avec un dictionnaire `{ '{variable}': valeur }` ; renvoie le tampon .docx. */
async function remplir(buffer, variables) {
  if (!buffer || !buffer.length) throw E.badRequest('Modèle Word vide');
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  if (!file) throw E.badRequest('Fichier .docx invalide (word/document.xml introuvable)');
  let xml = await file.async('text');
  // 1) recoller les variables coupées par des balises : on retire toute balise située entre accolades.
  xml = xml.replace(/\{[^{}]*\}/g, (m) => m.replace(/<[^>]+>/g, ''));
  // 2) conditionnels
  xml = processConditionals(xml, variables);
  // 3) substitutions (clés les plus longues d'abord pour éviter les correspondances partielles)
  const entries = Object.entries(variables).sort((a, b) => b[0].length - a[0].length);
  for (const [key, value] of entries) {
    const re = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    xml = xml.replace(re, valeurRun(value));
  }
  zip.file('word/document.xml', xml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Markdown (tiptap) → texte simple pour un modèle Word : garde les sauts de ligne, retire la syntaxe. */
const markdownToText = (s) => String(s || '')
  .replace(/\r\n/g, '\n')
  .replace(/^#{1,6}\s+/gm, '')
  .replace(/\*\*([^*]+)\*\*/g, '$1')
  .replace(/\*([^*]+)\*/g, '$1')
  .replace(/__([^_]+)__/g, '$1')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/^\s*[-*+]\s+/gm, '• ')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .trim();

/** Markdown → valeur « riche » pour Word : le gras `**…**` devient un marqueur (BOLD), et « Article N » passe en MAJUSCULES. */
const markdownToRich = (s) => {
  const art = (x) => (/^\s*article\s+\d+/i.test(x) ? x.toUpperCase() : x);
  return String(s || '')
    .replace(/\r\n/g, '\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, (_m, x) => `${BOLD}${art(x)}${BOLD}`)
    .replace(/__([^_]+)__/g, (_m, x) => `${BOLD}${art(x)}${BOLD}`)
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .trim();
};

module.exports = { remplir, markdownToText, markdownToRich, escapeXml, BOLD };
