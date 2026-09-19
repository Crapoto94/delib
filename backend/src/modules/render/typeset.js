/**
 * Composition typographique en PDF (pdf-lib) : Markdown restreint -> pages A4, au-dessus d'un PDF de fond.
 * Deux temps : layoutDocument() (pur, testable : découpe en lignes et en pages) puis paintDocument() (dessin).
 *  - blocs : titres (#), listes (- ou 1.), gras (**), paragraphes justifiés, saut de page avec contrôle des titres orphelins ;
 *  - suivi des modifications : ajout souligné et coloré, suppression barrée et colorée (couleur de l'auteur) ;
 *  - en-tête à variables, pied de page « Page x / y », filigrane diagonal, fond première page / pages suivantes.
 */
const { PDFDocument, rgb, degrees } = require('pdf-lib');
const { embedFamily } = require('./fonts');

const MM = 72 / 25.4;
const A4 = { w: 595.28, h: 841.89 };
const PT = { text: 'TimesRoman', bold: 'TimesRomanBold' };

/** Caractères hors WinAnsi (police standard PDF) remplacés par un équivalent sûr. */
const SAFE = { ' ': ' ', ' ': ' ', ' ': ' ', '‑': '-', '−': '-', '≥': '>=', '≤': '<=', '→': '->', '•': '-', '​': '' };
function winAnsi(font, text) {
  let out = '';
  for (const ch of String(text)) {
    const c = SAFE[ch] ?? ch;
    try { font.encodeText(c); out += c; } catch { out += '?'; }
  }
  return out;
}

const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return rgb(0, 0, 0);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const fill = (tpl, vars) => String(tpl ?? '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));

/** Découpe des « runs » ({text, type, color}) en lignes logiques (sur \n), en conservant le style. */
function splitLines(runs) {
  const lines = [[]];
  for (const r of runs) {
    const parts = String(r.text).split('\n');
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p) lines[lines.length - 1].push({ ...r, text: p });
    });
  }
  return lines;
}

const lineText = (line) => line.map((r) => r.text).join('');

/** Retire `n` caractères au début d'une ligne (préfixe Markdown : « ## », « - », « 1. »). */
function stripPrefix(line, n) {
  let left = n; const out = [];
  for (const r of line) {
    if (left >= r.text.length) { left -= r.text.length; continue; }
    out.push({ ...r, text: r.text.slice(left) }); left = 0;
  }
  return out;
}

/** Type de bloc d'une ligne + retrait du préfixe. */
function classify(line) {
  const t = lineText(line);
  let m;
  if ((m = /^(#{1,3})\s+/.exec(t))) return { kind: 'heading', level: m[1].length, runs: stripPrefix(line, m[0].length) };
  if ((m = /^(\s*)[-*]\s+/.exec(t))) return { kind: 'bullet', runs: stripPrefix(line, m[0].length), marker: '-' };
  if ((m = /^(\s*)(\d+)[.)]\s+/.exec(t))) return { kind: 'number', runs: stripPrefix(line, m[0].length), marker: `${m[2]}.` };
  return { kind: 'p', runs: line };
}

/** Jetons (mots et espaces) avec style ; « ** » bascule le gras. */
function tokenize(runs) {
  const tokens = []; let bold = false;
  for (const r of runs) {
    const segs = r.text.split('**');
    segs.forEach((seg, i) => {
      if (i > 0) bold = !bold;
      for (const part of seg.split(/(\s+)/)) {
        if (part === '') continue;
        tokens.push({ text: part, space: /^\s+$/.test(part), type: r.type || 'text', color: r.color, bold });
      }
    });
  }
  return tokens;
}

/**
 * Compose le document. `fonts` fournit widthOf(token, size) ; en test on peut passer une mesure factice.
 * content : [{ type:'title', text, size, align, bold, boxed, after }, { type:'runs', runs:[{text,type,color}] }, { type:'space', h }]
 * cfg : { marges:{haut,bas,gauche,droite} (mm), police:{taille,interligne,justifie}, pied:{texte,pagination}, entete:[…] }
 */
function layoutDocument({ content, cfg, vars, measure, logo }) {
  const m = cfg.marges;
  const size = cfg.police.taille; const lh = size * cfg.police.interligne;
  const left = m.gauche * MM; const width = A4.w - (m.gauche + m.droite) * MM;
  const top = A4.h - m.haut * MM; const bottom = m.bas * MM;
  const pages = [{ ops: [] }];
  let y = top - (logo ? logo.h + 10 : 0); let page = pages[0]; // le logo occupe le haut de la première page
  const newPage = () => { page = { ops: [] }; pages.push(page); y = top; };
  const need = (h) => { if (y - h < bottom) newPage(); };

  const lineOps = (tokens, x, w, opts) => {
    const widths = tokens.map((t) => measure(t, opts.size));
    const words = tokens.filter((t) => !t.space).length;
    const total = widths.reduce((a, b) => a + b, 0);
    const spaces = tokens.filter((t) => t.space).length;
    let extra = 0;
    if (opts.justify && spaces > 0 && total < w && opts.justified) extra = (w - total) / spaces;
    let cx = x;
    if (opts.align === 'center') cx = x + (w - total) / 2; else if (opts.align === 'right') cx = x + w - total;
    tokens.forEach((t, i) => {
      if (!t.space) page.ops.push({ x: cx, y, text: t.text, size: opts.size, bold: t.bold || opts.bold, type: t.type, color: t.color, width: widths[i] });
      cx += widths[i] + (t.space ? extra : 0);
    });
    return words;
  };

  const flow = (runs, { x0 = left, w0 = width, sz = size, bold = false, align = 'left', justify = cfg.police.justifie, marker = null, spacing = lh } = {}) => {
    const tokens = tokenize(runs.map((r) => ({ ...r, text: fill(r.text, vars) })));
    // découpe en lignes selon la largeur
    const lines = []; let cur = []; let curW = 0;
    for (const t of tokens) {
      const wd = measure({ ...t, bold: t.bold || bold }, sz);
      if (!t.space && curW + wd > w0 && cur.length) {
        while (cur.length && cur[cur.length - 1].space) cur.pop();
        lines.push(cur); cur = []; curW = 0;
      }
      if (t.space && !cur.length) continue; // pas d'espace en début de ligne
      cur.push(t); curW += wd;
    }
    while (cur.length && cur[cur.length - 1].space) cur.pop();
    if (cur.length) lines.push(cur);
    lines.forEach((ln, i) => {
      need(spacing);
      y -= sz; // ligne de base
      if (i === 0 && marker) page.ops.push({ x: x0 - measure({ text: marker + ' ', bold: false }, sz), y, text: marker, size: sz, bold: false, type: 'text' });
      lineOps(ln, x0, w0, { size: sz, bold, align, justify, justified: i < lines.length - 1 });
      y -= spacing - sz;
    });
    return lines.length;
  };

  for (const item of content) {
    if (item.type === 'space') { y -= item.h; if (y < bottom) newPage(); continue; }
    if (item.type === 'title') {
      const sz = item.size || size + 3;
      const height = sz * 1.5;
      if (y - height * (item.boxed ? 2 : 1) < bottom) newPage();
      if (item.boxed) {
        page.ops.push({ rect: true, x: left + width * 0.2, y: y - height - 2, w: width * 0.6, h: height + 6 });
      }
      flow([{ text: item.text, type: 'text' }], { sz, bold: item.bold !== false, align: item.align || 'left', justify: false, spacing: height });
      y -= item.after ?? 6;
      continue;
    }
    // runs : chaque ligne logique = un bloc
    const lines = splitLines(item.runs);
    for (const ln of lines) {
      if (!ln.length) { y -= lh * 0.6; continue; }
      const b = classify(ln);
      if (b.kind === 'heading') {
        const hs = size + (4 - b.level) * 1.5;
        if (y - lh * 3 < bottom) newPage(); // titre jamais isolé en bas de page
        flow(b.runs, { sz: hs, bold: true, justify: false, spacing: hs * 1.4 }); y -= 3;
      } else if (b.kind === 'bullet' || b.kind === 'number') {
        const indent = 14;
        flow(b.runs, { x0: left + indent, w0: width - indent, marker: b.marker });
        y -= 2;
      } else {
        flow(b.runs); y -= 3;
      }
    }
  }
  return { pages, geometry: { left, width, top, bottom, lineHeight: lh } };
}

/** Dessine les pages composées (fond, contenu, pied de page, filigrane). Renvoie { buffer, pageCount }. */
async function paintDocument({ layout, cfg, vars, bgFirst, bgNext, watermark, title, fontsDir, logo }) {
  const doc = await PDFDocument.create();
  doc.setTitle(title || 'Document'); doc.setProducer('IvryDélib'); doc.setCreator('IvryDélib');
  const fonts = await embedFamily(doc, cfg.police?.famille, fontsDir);
  const bg = async (bytes) => (bytes ? (await doc.embedPdf(bytes, [0]))[0] : null);
  const first = await bg(bgFirst); const next = (await bg(bgNext)) || first;
  const total = layout.pages.length;
  const logoImg = logo ? (logo.mime === 'image/png' ? await doc.embedPng(logo.bytes) : await doc.embedJpg(logo.bytes)) : null;
  layout.pages.forEach((p, i) => {
    const page = doc.addPage([A4.w, A4.h]);
    const b = i === 0 ? first : next;
    if (b) page.drawPage(b, { x: 0, y: 0, width: A4.w, height: A4.h });
    if (logoImg && i === 0) {
      const gauche = cfg.marges.gauche * MM; const droite = A4.w - cfg.marges.droite * MM;
      const al = cfg.logo?.align || 'left';
      const x = al === 'center' ? (A4.w - logo.w) / 2 : al === 'right' ? droite - logo.w : gauche;
      page.drawImage(logoImg, { x, y: A4.h - cfg.marges.haut * MM - logo.h, width: logo.w, height: logo.h });
    }
    if (watermark) {
      const f = fonts.bold; const sz = 64; const txt = winAnsi(f, watermark);
      const tw = f.widthOfTextAtSize(txt, sz);
      page.drawText(txt, { x: A4.w / 2 - (tw / 2) * Math.cos(Math.PI / 4), y: A4.h / 2 - (tw / 2) * Math.sin(Math.PI / 4), size: sz, font: f, color: rgb(0.8, 0.8, 0.8), opacity: 0.35, rotate: degrees(45) });
    }
    for (const op of p.ops) {
      if (op.rect) { page.drawRectangle({ x: op.x, y: op.y, width: op.w, height: op.h, borderColor: rgb(0, 0, 0), borderWidth: 1.2 }); continue; }
      const f = op.bold ? fonts.bold : fonts.text;
      const txt = winAnsi(f, op.text);
      const col = op.type === 'text' ? rgb(0, 0, 0) : hexToRgb(op.color);
      page.drawText(txt, { x: op.x, y: op.y, size: op.size, font: f, color: col, opacity: op.type === 'delete' ? 0.7 : 1 });
      const w = f.widthOfTextAtSize(txt, op.size);
      if (op.type === 'insert') page.drawLine({ start: { x: op.x, y: op.y - 1.5 }, end: { x: op.x + w, y: op.y - 1.5 }, thickness: 0.6, color: col });
      if (op.type === 'delete') page.drawLine({ start: { x: op.x, y: op.y + op.size * 0.3 }, end: { x: op.x + w, y: op.y + op.size * 0.3 }, thickness: 0.7, color: col });
    }
    const foot = [];
    if (cfg.pied?.texte) foot.push(fill(cfg.pied.texte, vars));
    if (cfg.pied?.pagination !== false) foot.push(`Page ${i + 1} / ${total}`);
    if (foot.length) {
      const txt = winAnsi(fonts.text, foot.join('   ·   '));
      const w = fonts.text.widthOfTextAtSize(txt, 8.5);
      page.drawText(txt, { x: (A4.w - w) / 2, y: Math.max(14, cfg.marges.bas * MM - 16), size: 8.5, font: fonts.text, color: rgb(0.35, 0.35, 0.35) });
    }
  });
  return { buffer: Buffer.from(await doc.save()), pageCount: total };
}

/** Mesure réelle (polices standard) pour le rendu de production. */
async function createMeasure(family, fontsDir) {
  const doc = await PDFDocument.create();
  const fonts = await embedFamily(doc, family, fontsDir);
  return (token, size) => { const f = token.bold ? fonts.bold : fonts.text; return f.widthOfTextAtSize(winAnsi(f, token.text), size); };
}

module.exports = { layoutDocument, paintDocument, createMeasure, fill, winAnsi, hexToRgb, MM, A4, splitLines, classify };
