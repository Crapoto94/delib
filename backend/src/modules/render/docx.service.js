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

const BOLD = '\u0002';   // marqueur interne : encadre un passage en gras dans une valeur
const ITALIC = '\u0003'; // marqueur interne : encadre un passage en italique dans une valeur

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

/** Runs Word pour un texte (gras via marqueur BOLD, italique via ITALIC, sauts de ligne en <w:br/>). */
function inlineRuns(text) {
  let out = '';
  let bold = false; let italic = false; let buf = '';
  const flush = () => {
    if (!buf) return;
    const segs = escapeXml(buf).split(/\r?\n/);
    const rpr = bold || italic ? `<w:rPr>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}</w:rPr>` : '';
    for (let j = 0; j < segs.length; j++) {
      if (j > 0) out += '<w:r><w:br/></w:r>';
      out += `<w:r>${rpr}<w:t xml:space="preserve">${segs[j]}</w:t></w:r>`;
    }
    buf = '';
  };
  for (const ch of String(text ?? '')) {
    if (ch === BOLD) { flush(); bold = !bold; }
    else if (ch === ITALIC) { flush(); italic = !italic; }
    else buf += ch;
  }
  flush();
  return out;
}
const JC = { center: 'center', right: 'right', justify: 'both' }; // justifié = « both » en OOXML
const para = (text, align) => { const jc = JC[align]; const r = inlineRuns(text); return `<w:p>${jc ? `<w:pPr><w:jc w:val="${jc}"/></w:pPr>` : ''}${r}</w:p>`; };

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
function drawingXml(rid, size, id, opts = {}) {
  const ratio = size.h / size.w || 0.66;
  const wpx = opts.width && opts.width > 0 ? opts.width : size.w;
  const cx = Math.min(MAX_W, Math.max(1, wpx) * EMU);
  const cy = Math.round(cx * ratio);
  const rot = opts.rotation ? Math.round(opts.rotation * 60000) : 0;
  const jc = JC[opts.align];
  const pPr = jc ? `<w:pPr><w:jc w:val="${jc}"/></w:pPr>` : '';
  const descr = opts.descr ? ` descr="${escapeXml(opts.descr)}"` : '';
  return `<w:p>${pPr}<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">`
    + `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Image ${id}"${descr}/>`
    + `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm${rot ? ` rot="${rot}"` : ''}><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

const ALIGN_PREFIX = /^\s*\{(center|right|justify)\}\s*/;
const IMG_LINE = /^\s*!\[([^\]]*)\]\((data:[^)]+)\)\s*$/;
const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const splitRow = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const hasRich = (v) => String(v ?? '').split('\n').some((l) => IMG_LINE.test(l)) || /(^|\n)\s*\{(center|right|justify)\}\s/i.test(String(v ?? '')) || /\n\s*\|.*\|\s*\n/.test(`\n${v}\n`);

/** Contenu d'une zone → XML Word (paragraphes, tableaux, images). `img` collecte les images à joindre au .docx. */
function blocksXml(value, img) {
  const blocks = String(value ?? '').split(/\n{2,}/);
  let out = '';
  for (const block0 of blocks) {
    const am = ALIGN_PREFIX.exec(block0);
    const align = am ? am[1] : null;
    const block = am ? block0.slice(am[0].length) : block0;
    const lines = block.split('\n');
    if (lines.length >= 2 && lines[0].includes('|') && isTableSep(lines[1])) { out += tableXml(lines.slice(2).length ? [splitRow(lines[0]), ...lines.slice(2).map(splitRow)] : [splitRow(lines[0])]); continue; }
    if (lines.every((l) => IMG_LINE.test(l))) { for (const l of lines) { const m = IMG_LINE.exec(l); out += img.add(m[2], m[1], align); } continue; }
    if (block.trim() || lines.length) out += para(block, align);
  }
  return out;
}

/**
 * Collecteur d'images d'une zone riche : `add(dataUrl, alt, align)` rend le XML du dessin et retient le média à joindre
 * au `.docx`. `relIdDepart` évite de réutiliser un identifiant de relation déjà présent dans le document.
 */
function creerCollecteurImages(relIdDepart = 1) {
  const images = [];
  let relId = relIdDepart;
  let picId = 1;
  const add = (dataUrl, alt, blockAlign = null) => {
    // Réglages de l'éditeur : fragment `#vd:w=200,rot=90,align=center` ajouté à la source.
    const opts = {};
    const hi = dataUrl.indexOf('#vd:');
    const clean = hi >= 0 ? dataUrl.slice(0, hi) : dataUrl;
    if (hi >= 0) for (const part of dataUrl.slice(hi + 4).split(',')) {
      const [k, v] = part.split('=');
      if (k === 'w' && Number(v)) opts.width = Number(v);
      else if (k === 'rot' && Number(v)) opts.rotation = Number(v);
      else if (k === 'align') opts.align = v;
    }
    if (!opts.align) opts.align = blockAlign;
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(clean);
    if (!m) return para(alt || '', blockAlign);
    const mime = m[1]; const bytes = Buffer.from(m[2], 'base64');
    const ext = mime.includes('png') ? 'png' : mime.includes('gif') ? 'gif' : 'jpeg';
    const name = `image${picId}.${ext}`; const rid = `rId${relId}`;
    images.push({ name, bytes, rid, mime, ext });
    relId++; const id = picId++;
    return drawingXml(rid, imageSize(bytes, mime), id, { ...opts, descr: alt || undefined });
  };
  return { add, images };
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
  const relId = Math.max(0, ...[...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]))) + 1;
  const collecteur = creerCollecteurImages(relId);
  const { images } = collecteur;

  const entries = Object.entries(variables).sort((a, b) => b[0].length - a[0].length);
  for (const [key, value] of entries) {
    const rich = hasRich(value);
    const reKey = escapeRe(key);
    if (rich) {
      const pRe = new RegExp(`<w:p\\b[^>]*>(?:(?!</w:p>)[\\s\\S])*?${reKey}(?:(?!</w:p>)[\\s\\S])*?</w:p>`, 'g');
      if (pRe.test(xml)) { xml = xml.replace(pRe, () => blocksXml(value, collecteur)); continue; }
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

/* ----------------------------------------------------------------------------------------------------------------
 * Texte suivi (exposé, visas, dispositif) rédigé dans le bureau en ligne : conversion Markdown ⇄ .docx autonome.
 *
 * Le markdown est la source de vérité ; l'agent l'édite dans Word / ONLYOFFICE / Collabora, et le document rapporté est
 * reconverti puis enregistré par le chemin ordinaire des textes (version, suivi des modifications). Le va-et-vient
 * conserve paragraphes, gras, italique, alignement, listes, tableaux et images, pour ne rien perdre au retour.
 * ---------------------------------------------------------------------------------------------------------------- */

const NS_DOC = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const CT_TEXTE = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Default Extension="png" ContentType="image/png"/>'
  + '<Default Extension="jpeg" ContentType="image/jpeg"/>'
  + '<Default Extension="gif" ContentType="image/gif"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
  + '</Types>';
const RELS_ROOT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>';
const STYLES_TEXTE = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>'
  + '<w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>';

/**
 * Markdown → valeur « riche » pour Word. Contrairement à `markdownToRich`, les listes (`- `, `1. `) et les préfixes
 * d'alignement (`{center}`…) sont laissés intacts : ils sont relus tels quels au retour, sans transformation.
 */
const richTexte = (s) => String(s ?? '')
  .replace(/\r\n/g, '\n').replace(/^#{1,6}\s+/gm, '')
  .replace(/\*\*([^*]+)\*\*/g, (_m, x) => `${BOLD}${x}${BOLD}`)
  .replace(/__([^_]+)__/g, (_m, x) => `${BOLD}${x}${BOLD}`)
  .replace(/\*([^*]+)\*/g, (_m, x) => `${ITALIC}${x}${ITALIC}`);

/** Markdown d'un texte suivi → document Word autonome (un .docx prêt à éditer). */
async function markdownVersDocx(markdown) {
  const collecteur = creerCollecteurImages(1);
  const { images } = collecteur;
  const corps = blocksXml(richTexte(markdown), collecteur);
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + `<w:document ${NS_DOC}><w:body>${corps}`
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
    + '<w:pgMar w:top="1134" w:right="1418" w:bottom="1134" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>'
    + '</w:body></w:document>';
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CT_TEXTE);
  zip.file('_rels/.rels', RELS_ROOT);
  zip.file('word/document.xml', xml);
  zip.file('word/styles.xml', STYLES_TEXTE);
  let rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  for (const im of images) {
    zip.file(`word/media/${im.name}`, im.bytes);
    rels += `<Relationship Id="${im.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${im.name}"/>`;
  }
  rels += '</Relationships>';
  zip.file('word/_rels/document.xml.rels', rels);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const decoderXml = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&');

/** La balise de mise en forme (`w:b`, `w:i`) est-elle active dans ce run (absente ou vraie) ? */
const estActif = (xml, balise) => new RegExp(`<w:${balise}\\b(?![^>]*w:val="(?:0|false|off)")[^>]*\\/?>`).test(xml);

function texteDuRun(run) {
  let out = '';
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:br\b[^>]*\/?>|<w:cr\b[^>]*\/?>|<w:tab\b[^>]*\/?>/g;
  let m;
  while ((m = re.exec(run)) !== null) {
    if (m[0].startsWith('<w:br') || m[0].startsWith('<w:cr')) out += '\n';
    else if (m[0].startsWith('<w:tab')) out += ' ';
    else out += decoderXml(m[1] ?? '');
  }
  return out;
}

/** Segments de texte d'un paragraphe, regroupés par style, pour ne pas produire « **a****b** ». */
function segmentsTexte(p) {
  const segments = [];
  const re = /<w:r\b[\s\S]*?<\/w:r>/g; let m;
  while ((m = re.exec(p)) !== null) {
    const r = m[0];
    if (/<w:drawing\b/.test(r)) continue;               // les images sont traitées à part
    const texte = texteDuRun(r);
    if (!texte) continue;
    const gras = estActif(r, 'b'); const italique = estActif(r, 'i');
    const dernier = segments[segments.length - 1];
    if (dernier && dernier.gras === gras && dernier.italique === italique) dernier.texte += texte;
    else segments.push({ texte, gras, italique });
  }
  return segments;
}

const markdownDunSegment = (s) => (s.gras ? `**${s.texte}**` : s.italique ? `*${s.texte}*` : s.texte);

const MIME_IMAGE = (nom) => (/\.png$/i.test(nom) ? 'image/png' : /\.gif$/i.test(nom) ? 'image/gif' : /\.(tiff?|bmp)$/i.test(nom) ? 'image/png' : 'image/jpeg');

/** Relations d'images du document : `rId` → data-URL, pour recoller les images dans le markdown. */
async function blipsDesImages(zip) {
  const map = new Map();
  const rels = zip.file('word/_rels/document.xml.rels');
  if (!rels) return map;
  const xml = await rels.async('text');
  const re = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const id = m[1]; const cible = m[2];
    if (!/(^|\/)media\//i.test(cible) && !/\.(png|jpe?g|gif|bmp|tiff?)$/i.test(cible)) continue;
    const chemin = cible.startsWith('/') ? cible.slice(1) : `word/${cible}`;
    const f = zip.file(chemin);
    if (!f) continue;
    const bytes = await f.async('nodebuffer');
    map.set(id, { dataUrl: `data:${MIME_IMAGE(cible)};base64,${bytes.toString('base64')}` });
  }
  return map;
}

function imagesDuParagraphe(p, blips, align) {
  const out = [];
  const re = /<a:blip\b[^>]*r:embed="([^"]+)"/g;
  let m;
  while ((m = re.exec(p)) !== null) {
    const b = blips.get(m[1]);
    if (!b) continue;
    const alt = (/<wp:docPr\b[^>]*descr="([^"]*)"/.exec(p) || [])[1] || '';
    const attrs = [];
    const cx = (/<wp:extent\b[^>]*cx="(\d+)"/.exec(p) || [])[1];
    if (cx) { const px = Math.round(Number(cx) / 9525); if (px > 0 && px < 1000) attrs.push(`w=${px}`); }
    const rot = (/<a:xfrm\b[^>]*rot="(-?\d+)"/.exec(p) || [])[1];
    if (rot && Number(rot) !== 0) attrs.push(`rot=${Math.round(Number(rot) / 60000)}`);
    if (align && align !== 'left') attrs.push(`align=${align}`);
    out.push(`![${alt}](${b.dataUrl}${attrs.length ? `#vd:${attrs.join(',')}` : ''})`);
  }
  return out;
}

const ALIGN_W = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' };

function paragrapheVersMarkdown(p, blips) {
  const jc = (/<w:jc\b[^>]*w:val="([^"]+)"/.exec(p) || [])[1];
  const align = ALIGN_W[jc] || null;
  const liste = /<w:numPr\b/.test(p);
  const md = segmentsTexte(p).map(markdownDunSegment).join('');
  return { md, align, liste, images: imagesDuParagraphe(p, blips, align) };
}

function tableVersMarkdown(tbl, blips) {
  const lignes = (tbl.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || []).map((tr) => {
    const cellules = tr.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || [];
    return cellules.map((tc) => {
      const ps = tc.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
      return ps.map((p) => paragrapheVersMarkdown(p, blips).md).join(' ').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
    });
  });
  if (!lignes.length) return null;
  const cols = Math.max(...lignes.map((l) => l.length), 1);
  const out = [`| ${lignes[0].join(' | ')} |`, `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`];
  for (const l of lignes.slice(1)) out.push(`| ${Array.from({ length: cols }, (_, i) => l[i] ?? '').join(' | ')} |`);
  return out.join('\n');
}

/** Document Word → markdown d'un texte suivi (paragraphes, gras, italique, alignement, listes, tableaux, images). */
async function docxVersMarkdown(buffer) {
  if (!buffer || !buffer.length) throw E.badRequest('Document vide');
  const zip = await JSZip.loadAsync(buffer);
  const f = zip.file('word/document.xml');
  if (!f) throw E.badRequest('Fichier .docx invalide (word/document.xml introuvable)');
  const xml = await f.async('text');
  const blips = await blipsDesImages(zip);
  const corps = (/<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(xml) || [])[1] || xml;
  const tokens = corps.match(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g) || [];
  const blocs = [];
  let liste = null;
  const fermerListe = () => { if (liste) { blocs.push(liste.join('\n')); liste = null; } };
  for (const tok of tokens) {
    if (/^<w:tbl\b/.test(tok)) { fermerListe(); const t = tableVersMarkdown(tok, blips); if (t) blocs.push(t); continue; }
    const p = paragrapheVersMarkdown(tok, blips);
    if (p.liste && (p.md.trim() || p.images.length)) {
      liste = liste || [];
      if (p.md.trim()) liste.push(`- ${p.md.trim()}`);
      liste.push(...p.images);
      continue;
    }
    fermerListe();
    blocs.push(...p.images);
    if (p.md.trim()) blocs.push((p.align ? `{${p.align}} ` : '') + p.md.replace(/[ \t]+$/g, ''));
  }
  fermerListe();
  return blocs.map((b) => b.trim()).filter(Boolean).join('\n\n');
}

module.exports = { remplir, markdownToText, markdownToRich, markdownVersDocx, docxVersMarkdown, escapeXml, BOLD };
