/**
 * Suivi des modifications — algorithme repris du Transcript Manager d'appdsi (transcriptmanager.controller.js) et durci.
 *
 * Un texte est un Markdown restreint + une liste de « spans » cumulative sur toute la vie du document :
 *   { id, text, type: 'text' | 'insert' | 'delete', author, name, color, at, cid }
 *  - `text`   : texte accepté / d'origine (aucune coloration) ;
 *  - `insert` : ajout d'un auteur (coloré) ; `delete` : retrait d'un auteur (barré, coloré) ;
 *  - `cid`    : identifiant de la modification (permet de l'accepter ou de la rejeter une par une, D30) ;
 *  - un nouvel amendement ne fait que fusionner SON diff dans la structure : les portions déjà amendées gardent leur
 *    auteur, leur couleur et leur date.
 * Le diff est fait mot à mot (diffWordsWithSpace : les espaces sont des jetons à part entière, ce qui évite des
 * ré-attributions parasites). Contrairement à appdsi, une désynchronisation des spans n'entraîne JAMAIS une
 * réinitialisation silencieuse : on reconstruit depuis les instantanés (text_versions), voir rebuildSpans().
 */
const crypto = require('crypto');
const { diffWordsWithSpace } = require('diff');

const PALETTE = ['#2563EB', '#059669', '#7C3AED', '#DB2777', '#0891B2', '#65A30D', '#EA580C', '#4338CA', '#0D9488', '#C026D3'];

/** Normalise fins de ligne et espaces de fin ; l'éditeur (aller-retour Markdown) n'est pas parfaitement réversible. */
const normalize = (s) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();

const newId = () => crypto.randomBytes(6).toString('hex');
const initialSpans = (text) => (text ? [{ id: newId(), text, type: 'text' }] : []);
const liveText = (spans) => spans.filter((s) => s.type !== 'delete').map((s) => s.text).join('');

/**
 * Fusionne un amendement (diff oldClean -> newClean) dans les spans existants, en conservant l'attribution des
 * portions déjà amendées. Algorithme à deux curseurs (prevIdx / offsetInSpan) sur les spans « vivants ».
 * `amender` = { author, name, color } ; `at` = horodatage ISO ; `cid` = identifiant de la modification.
 */
function applyDiffToSpans(prevSpans, oldClean, newClean, amender, { at = new Date().toISOString(), cid = newId() } = {}) {
  const parts = diffWordsWithSpace(oldClean, newClean);
  const result = [];
  let prevIdx = 0;
  let offset = 0;
  const mark = (text, type) => ({ id: newId(), text, type, author: amender.author, name: amender.name, color: amender.color, at, cid });

  const flushLeadingDeletes = () => {
    while (prevIdx < prevSpans.length && prevSpans[prevIdx].type === 'delete') { result.push(prevSpans[prevIdx]); prevIdx++; }
  };
  flushLeadingDeletes();

  for (const part of parts) {
    if (part.added) { if (part.value) result.push(mark(part.value, 'insert')); continue; }
    let need = part.value.length;
    while (need > 0 && prevIdx < prevSpans.length) {
      const span = prevSpans[prevIdx];
      if (span.type === 'delete') { result.push(span); prevIdx++; flushLeadingDeletes(); continue; }
      const take = Math.min(span.text.length - offset, need);
      const chunk = span.text.substr(offset, take);
      if (part.removed) {
        // texte accepté ou ajout d'un autre auteur retiré : barré à la couleur de l'amendeur courant
        if (chunk) result.push(mark(chunk, 'delete'));
      } else if (chunk) {
        result.push({ ...span, id: newId(), text: chunk });
      }
      offset += take;
      need -= take;
      if (offset >= span.text.length) { prevIdx++; offset = 0; flushLeadingDeletes(); }
    }
  }
  while (prevIdx < prevSpans.length) result.push(prevSpans[prevIdx++]);
  return mergeAdjacent(result);
}

/**
 * Identifiants des modifications d'un auteur postérieures à `sinceAt` (bornes de sa série en cours).
 * Sert à « défaire » les changements d'une personne avant de la comparer à la personne précédente :
 * on ne se diffe jamais contre soi-même.
 */
function authorChangeIds(spans, author, sinceAt = null) {
  const since = sinceAt ? new Date(sinceAt).getTime() : null;
  const ids = new Set();
  for (const s of spans) {
    if (s.type === 'text' || s.author !== author || !s.cid) continue;
    if (since !== null && !(s.at && new Date(s.at).getTime() >= since)) continue;
    ids.add(s.cid);
  }
  return [...ids];
}

/** Fusionne les spans contigus de même nature (même type, auteur, modification) pour garder la structure compacte. */
function mergeAdjacent(spans) {
  const out = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && last.type === s.type && (last.cid || null) === (s.cid || null) && (last.author || null) === (s.author || null) && (last.at || null) === (s.at || null)) {
      last.text += s.text;
    } else out.push({ ...s });
  }
  return out;
}

/**
 * Reconstruit les spans en rejouant les instantanés (du plus ancien au plus récent) : jamais de perte silencieuse.
 * Une série de versions du même auteur est recollée en une seule modification nette, pour comparer chacun à la
 * personne précédente (et non à lui-même).
 * `versions` : [{ markdown, author, name, color, created_at, tracking, cid }] ordonnées par version.
 */
function rebuildSpans(versions) {
  let spans = [];
  let prev = null;
  let streakAuthor = null;
  let boundary = null; // début de la série d'écritures de l'auteur courant
  for (const v of versions) {
    const md = normalize(v.markdown);
    if (prev === null || !v.tracking) { spans = initialSpans(md); prev = md; streakAuthor = null; boundary = null; continue; }
    const startStreak = v.author !== streakAuthor;
    if (md !== prev) {
      let base = spans;
      if (!startStreak && boundary !== null) {
        const mine = authorChangeIds(base, v.author, boundary);
        if (mine.length) base = resolveChanges(base, mine, 'reject');
      }
      spans = applyDiffToSpans(base, liveText(base), md, { author: v.author, name: v.name, color: v.color }, { at: new Date(v.created_at).toISOString(), cid: v.cid });
    }
    if (startStreak) { streakAuthor = v.author; boundary = v.created_at; }
    prev = md;
  }
  return spans;
}

/** Vérifie que les spans reconstruisent bien le texte courant. */
const isConsistent = (spans, markdown) => liveText(spans) === markdown;

/** Accepte (`accept`) ou rejette (`reject`) des modifications précises : insertion -> texte / retirée ; suppression -> retirée / restaurée. */
function resolveChanges(spans, cids, decision) {
  const set = new Set(cids);
  const out = [];
  for (const s of spans) {
    if (s.type === 'text' || !set.has(s.cid)) { out.push(s); continue; }
    const keep = (s.type === 'insert') === (decision === 'accept');
    if (keep) out.push({ id: s.id, text: s.text, type: 'text' });
  }
  return mergeAdjacent(out);
}

/** Tout accepter : version « propre » consolidée (TRK-10). */
const acceptAll = (spans) => resolveChanges(spans, spans.filter((s) => s.type !== 'text').map((s) => s.cid), 'accept');

/** Liste des modifications (un groupe par cid) avec auteur, couleur, date et extraits, la plus récente d'abord. */
function listChanges(spans) {
  const map = new Map();
  for (const s of spans) {
    if (s.type === 'text') continue;
    const c = map.get(s.cid) || { cid: s.cid, author: s.author, name: s.name, color: s.color, at: s.at, inserted: '', deleted: '' };
    if (s.type === 'insert') c.inserted += s.text; else c.deleted += s.text;
    map.set(s.cid, c);
  }
  return [...map.values()].sort((a, b) => ((Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)) || String(b.cid).localeCompare(String(a.cid)));
}

/**
 * Vue « depuis » (TRK-07) : seules les modifications postérieures à `sinceAt` gardent leur couleur ; les anciennes
 * insertions redeviennent du texte neutre et les anciennes suppressions disparaissent.
 */
function sinceView(spans, sinceAt) {
  const t = sinceAt ? new Date(sinceAt).getTime() : 0;
  return mergeAdjacent(spans.flatMap((s) => {
    if (s.type === 'text') return [s];
    const recent = s.at && new Date(s.at).getTime() > t;
    if (recent) return [s];
    return s.type === 'delete' ? [] : [{ id: s.id, text: s.text, type: 'text' }];
  }));
}

/** Markdown annoté (<ins>/<del> colorés, échappés) pour un rendu HTML côté client. */
function annotatedMarkdown(spans) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return spans.map((s) => {
    if (s.type === 'insert') return `<ins data-cid="${s.cid}" style="color:${s.color};background:${s.color}1A;text-decoration:none;font-weight:600;">${esc(s.text)}</ins>`;
    if (s.type === 'delete') return `<del data-cid="${s.cid}" style="color:${s.color};opacity:0.75;">${esc(s.text)}</del>`;
    return esc(s.text);
  }).join('');
}

const pickColor = (usedCount) => PALETTE[usedCount % PALETTE.length];

module.exports = {
  PALETTE, normalize, initialSpans, liveText, applyDiffToSpans, rebuildSpans, isConsistent, resolveChanges, acceptAll,
  listChanges, sinceView, annotatedMarkdown, pickColor, mergeAdjacent, authorChangeIds, diffParts: diffWordsWithSpace,
};
