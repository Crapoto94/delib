/**
 * Modèles Word (.docx) à variables (comme ODP) : on fusionne le document avec les valeurs des zones de la délibération.
 *
 * Un .docx est une archive ZIP ; les variables sont remplacées dans `word/document.xml` (JSZip + expressions
 * régulières), en gérant :
 *  - les variables fragmentées par des balises (`{expo</w:t>…<w:t>se}`) ;
 *  - les blocs conditionnels `{IF variable|texte}` ;
 *  - le gras `**…**` (marqueur interne) et « Article N » en majuscules ;
 *  - les contenus RICHES d'une zone : tableaux Markdown → vraie table Word, images `![alt](data:…)` → image insérée.
 */
const JSZip = require('jszip');
const { E } = require('../../shared/errors');

const BOLD = '\u0002'; // marqueur interne : encadre un passage en gras dans une valeur

const escapeXml = (str) => String(str ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

/** Runs Word pour un texte (gras via marqueur BOLD, sauts de ligne en <w:br/>). */
function inlineRuns(text) {
  const parts = String(text ?? '').split(BOLD);
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const bold = i % 2 === 1;
    const segs = escapeXml(parts[i]).split(/\r?\n/);
    for (let j = 0; j < segs.length; j++) {
      if (j > 0) out += '<w:r><w:br/></w:r>';
      out += `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${segs[j]}</w:t></w:r>`;
    }
  }
  return out;
}
const para = (text) => { const r = inlineRuns(text); return `<w:p>${r}</w:p>`; };

const BORDER = (c) => `<w:${c} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`;
const tableXml = (rows) => {
  const cols = Math.max(...rows.map((r) => r.length), 1);
  const grid = `<w:tblGrid>${Array.from({ length: cols }, () => '<w:gridCol w:w="2400"/>').join('')}</w:tblGrid>`;
  const trs = rows.map((r) => `<w:tr>${Array.from({ length: cols }, (_, i) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${para(r[i] ?? '')}</w:tc>`).join('')}</w:tr>`).join('');
  const borders = `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(BORDER).join('')}</w:tblBorders>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${borders}</w:tblPr>${grid}${trs}</w:tbl>`;
};

/** Dimensions (px) d'une image PNG / JPEG / GIF, pour calculer le ratio. */
function imageSize(buf, mime) {
  try {
    if (mime.includes('png') && buf.length > 24) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (mime.includes('gif') && buf.length > 10) return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (mime.includes('jpeg') || mime.includes('jpg')) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xFF) { i++; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch { /* dimensions inconnues */ }
  return { w: 600, h: 400 };
}

const EMU = 9525; // 1 px (96 dpi) en EMU
const MAX_W = 5_600_000; // ~15,5 cm
function drawingXml(rid, size, id) {
  const ratio = size.h / size.w || 0.66;
  const cx = Math.min(MAX_W, Math.max(1, size.w) * EMU);
  const cy = Math.round(cx * ratio);
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">`
    + `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Image ${id}"/>`
    + `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

const IMG_LINE = /^\s*!\[([^\]]*)\]\((data:[^)]+)\)\s*$/;
const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const splitRow = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const hasRich = (v) => String(v ?? '').split('\n').some((l) => IMG_LINE.test(l)) || /\n\s*\|.*\|\s*\n/.test(`\n${v}\n`);

/** Contenu d'une zone → XML Word (paragraphes, tableaux, images). `img` collecte les images à joindre au .docx. */
function blocksXml(value, img) {
  const blocks = String(value ?? '').split(/\n{2,}/);
  let out = '';
  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length >= 2 && lines[0].includes('|') && isTableSep(lines[1])) { out += tableXml(lines.slice(2).length ? [splitRow(lines[0]), ...lines.slice(2).map(splitRow)] : [splitRow(lines[0])]); continue; }
    if (lines.every((l) => IMG_LINE.test(l))) { for (const l of lines) { const m = IMG_LINE.exec(l); out += img.add(m[2], m[1]); } continue; }
    if (block.trim() || lines.length) out += para(block);
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
  xml = xml.replace(/\{[^{}]*\}/g, (m) => m.replace(/<[^>]+>/g, ''));
  xml = processConditionals(xml, variables);

  // Registre des images : rels existantes + compteur d'id.
  const relsFile = zip.file('word/_rels/document.xml.rels');
  let rels = relsFile ? await relsFile.async('text') : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  let relId = Math.max(0, ...[...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]))) + 1;
  let picId = 1; const images = [];
  const img = {
    add(dataUrl, alt) {
      const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
      if (!m) return para(alt || '');
      const mime = m[1]; const bytes = Buffer.from(m[2], 'base64');
      const ext = mime.includes('png') ? 'png' : mime.includes('gif') ? 'gif' : 'jpeg';
      const name = `image${picId}.${ext}`; const rid = `rId${relId}`;
      images.push({ name, bytes, rid, mime, ext });
      relId++; const id = picId++;
      return drawingXml(rid, imageSize(bytes, mime), id);
    },
  };

  const entries = Object.entries(variables).sort((a, b) => b[0].length - a[0].length);
  for (const [key, value] of entries) {
    const rich = hasRich(value);
    const reKey = escapeRe(key);
    if (rich) {
      const pRe = new RegExp(`<w:p\\b[^>]*>(?:(?!</w:p>)[\\s\\S])*?${reKey}(?:(?!</w:p>)[\\s\\S])*?</w:p>`, 'g');
      if (pRe.test(xml)) { xml = xml.replace(pRe, () => blocksXml(value, img)); continue; }
    }
    const re = new RegExp(reKey, 'g');
    xml = xml.replace(re, () => valeurInline(value));
  }

  zip.file('word/document.xml', xml);
  if (images.length) {
    for (const im of images) {
      zip.file(`word/media/${im.name}`, im.bytes);
      rels = rels.replace('</Relationships>', `<Relationship Id="${im.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${im.name}"/></Relationships>`);
    }
    zip.file('word/_rels/document.xml.rels', rels);
    const ctFile = zip.file('[Content_Types].xml');
    if (ctFile) {
      let ct = await ctFile.async('text');
      for (const ext of new Set(images.map((i) => i.ext))) if (!new RegExp(`Extension="${ext}"`, 'i').test(ct)) ct = ct.replace('</Types>', `<Default Extension="${ext}" ContentType="image/${ext === 'jpeg' ? 'jpeg' : ext}"/></Types>`);
      zip.file('[Content_Types].xml', ct);
    }
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Valeur simple insérée dans le run existant (gras + sauts de ligne). */
function valeurInline(v) {
  const parts = String(v ?? '').split(BOLD);
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const text = escapeXml(parts[i]).replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
    if (i % 2 === 1) out += `</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r><w:r><w:t xml:space="preserve">`;
    else out += text;
  }
  return out;
}

/** Markdown (tiptap) → texte simple pour un modèle Word : garde les sauts de ligne, retire la syntaxe. */
const markdownToText = (s) => String(s || '')
  .replace(/\r\n/g, '\n').replace(/^#{1,6}\s+/gm, '')
  .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/__([^_]+)__/g, '$1').replace(/`([^`]+)`/g, '$1')
  .replace(/^\s*[-*+]\s+/gm, '• ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();

/** Markdown → valeur « riche » pour Word : gras `**…**` (marqueur), « Article N » en MAJUSCULES, tableaux/images conservés. */
const markdownToRich = (s) => {
  const art = (x) => (/^\s*article\s+\d+/i.test(x) ? x.toUpperCase() : x);
  return String(s || '')
    .replace(/\r\n/g, '\n').replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, (_m, x) => `${BOLD}${art(x)}${BOLD}`)
    .replace(/__([^_]+)__/g, (_m, x) => `${BOLD}${art(x)}${BOLD}`)
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .trim();
};

module.exports = { remplir, markdownToText, markdownToRich, escapeXml, BOLD };
