/**
 * Extraction des références juridiques d'un texte, PAR RÈGLES (IA-30, IA-35) : aucun appel au modèle, résultat reproductible.
 * Chaque référence reçoit une clé normalisée qui sert à la rapprocher de la bibliothèque de visas (IA-38) :
 *   cgct:L2121-29   article d'un code (clé du code + article)      cgct   un code cité sans article
 *   loi:2015-991    loi ou loi organique n°                          ordonnance:2019-1  ·  decret:2016-360  ·  arrete:2024-12
 *   arrete:du:2024-03-12   texte cité par sa seule date              delib:2026-4-012   délibération antérieure par son numéro
 *   delib:du:2024-03-12    délibération antérieure citée par sa date
 * Le module ne juge de rien : il lit. La vérification (existence, actualité) est faite contre la bibliothèque, jamais de mémoire.
 */

const MOIS = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };
const sansAccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s) => sansAccent(s).toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/** Codes connus : [motif sur le texte sans accents ni casse, clé, libellé]. Les autres codes reçoivent une clé tirée de leur nom. */
const CODES = [
  [/code general des collectivites territoriales|\bcgct\b/, 'cgct', 'code général des collectivités territoriales'],
  [/code de la commande publique/, 'ccp', 'code de la commande publique'],
  [/code general de la fonction publique|\bcgfp\b/, 'cgfp', 'code général de la fonction publique'],
  [/code de l'urbanisme/, 'urbanisme', "code de l'urbanisme"],
  [/code general de la propriete des personnes publiques|\bcg3p\b/, 'cg3p', 'code général de la propriété des personnes publiques'],
  [/code de l'environnement/, 'environnement', "code de l'environnement"],
  [/code de l'education/, 'education', "code de l'éducation"],
  [/code de l'action sociale et des familles|\bcasf\b/, 'casf', "code de l'action sociale et des familles"],
  [/code general des impots|\bcgi\b/, 'cgi', 'code général des impôts'],
  [/code de la construction et de l'habitation|\bcch\b/, 'cch', "code de la construction et de l'habitation"],
  [/code de justice administrative|\bcja\b/, 'cja', 'code de justice administrative'],
  [/code des relations entre le public et l'administration|\bcrpa\b/, 'crpa', "code des relations entre le public et l'administration"],
  [/code de la sante publique/, 'sante', 'code de la santé publique'],
  [/code du travail/, 'travail', 'code du travail'],
  [/code du patrimoine/, 'patrimoine', 'code du patrimoine'],
  [/code de la route/, 'route', 'code de la route'],
  [/code civil/, 'civil', 'code civil'],
  [/code penal/, 'penal', 'code pénal'],
  [/code de la securite interieure/, 'securite-interieure', 'code de la sécurité intérieure'],
  [/code de la voirie routiere/, 'voirie-routiere', 'code de la voirie routière'],
  [/code du sport/, 'sport', 'code du sport'],
  [/code du tourisme/, 'tourisme', 'code du tourisme'],
  [/code de commerce/, 'commerce', 'code de commerce'],
  [/code de l'energie/, 'energie', "code de l'énergie"],
];

/** Clé et libellé d'un code à partir du nom cité (« code général des collectivités territoriales », « CGCT »…). */
function codeCle(nom) {
  const n = norm(nom);
  for (const [re, cle, libelle] of CODES) if (re.test(n)) return { cle, libelle };
  const mots = n.replace(/^code\s+(?:de la |de l'|du |des |de |d')?/, '').replace(/[^a-z0-9' -]/g, '').trim();
  const slug = mots.replace(/'/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return slug ? { cle: slug, libelle: `code ${mots}` } : null;
}

/** « 7 août 2015 », « 1er mars 2024 » → « 2015-08-07 ». */
function dateIso(txt) {
  const m = /(\d{1,2})(?:er)?\s+([a-zéèûôîà]+)\s+(\d{4})/i.exec(String(txt || '')); if (!m) return null;
  const mois = MOIS[sansAccent(m[2]).toLowerCase()]; if (!mois) return null;
  return `${m[3]}-${String(mois).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
}
const dateFr = (iso) => { const [y, mo, d] = iso.split('-'); const noms = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']; return `${Number(d) === 1 ? '1er' : Number(d)} ${noms[Number(mo) - 1]} ${y}`; };

/** Numéro d'article : « L. 2121-29 », « L2121‑29 », « R.2121-1 » → « L2121-29 ». */
const articleCle = (lettre, num) => `${(lettre || '').toUpperCase()}${String(num).replace(/[‑–—]/g, '-').replace(/\.$/, '')}`;

const RANG = { code: 1, loi: 1, ordonnance: 2, decret: 3, arrete: 4, delib: 5 };
const LIB_TEXTE = { loi: 'Loi', ordonnance: 'Ordonnance', decret: 'Décret', arrete: 'Arrêté' };

const RE_NUMERO_TEXTE = /\b(loi(?:\s+organique)?|ordonnance|d[ée]cret|arr[êe]t[ée])\s+(?:n[°o]\s*)?(\d{2,4}\s?[-‑–]\s?\d+)\s*(?:(?:du|en date du)\s+(\d{1,2}(?:er)?\s+[a-zéèûôîà]+\s+\d{4}))?/gi;
const RE_TEXTE_DATE = /\b(loi(?:\s+organique)?|ordonnance|d[ée]cret|arr[êe]t[ée])\s+(?:[a-zéèûôîà' ]{0,50}?)du\s+(\d{1,2}(?:er)?\s+[a-zéèûôîà]+\s+\d{4})/gi;
const RE_DELIB_NUM = /d[ée]lib[ée]rations?\s+(?:du\s+conseil\s+\w+\s+)?(?:n[°o]\s*)?(\d{4}[-‑–][A-Za-z0-9]+[-‑–][A-Za-z0-9]+)/gi;
const RE_DELIB_DATE = /d[ée]lib[ée]rations?\s+(?:du\s+conseil\s+(?:municipal|communautaire|territorial|d[ée]partemental|r[ée]gional)\s+)?du\s+(\d{1,2}(?:er)?\s+[a-zéèûôîà]+\s+\d{4})/gi;

/**
 * Lit les articles qui suivent « article(s) » : « L. 2121-29 », « L. 2121-29 et L. 2122-22 », « L. 2121-29, L. 2122-22 et suivants »,
 * puis le code visé (« du code général des collectivités territoriales »). Renvoie { articles, code, fin } ou null.
 */
function lireArticles(ligne, debut) {
  let pos = debut; const articles = [];
  const TOK = /^\s*([LRD])?\s*\.?\s*(\d+(?:\s?[-‑–]\s?\d+|\.\d+)*)/i;
  for (;;) {
    const m = TOK.exec(ligne.slice(pos)); if (!m) break;
    articles.push(articleCle(m[1], m[2].replace(/\s/g, '')));
    pos += m[0].length;
    const sep = /^\s*(?:,|et|ainsi que|à|a)\s+(?=\s*[LRD]?\s*\.?\s*\d)/i.exec(ligne.slice(pos));
    if (!sep) break;
    pos += sep[0].length;
  }
  if (!articles.length) return null;
  pos += (/^\s*(?:et suivants|et s\.?)/i.exec(ligne.slice(pos)) || [''])[0].length;
  const du = /^\s*(?:du|de la|de l['’]|des)\s+/i.exec(ligne.slice(pos));
  if (!du) return { articles, code: null, fin: pos };
  const reste = ligne.slice(pos + du[0].length);
  const nom = /^(code[^,;:\n(]*|CGCT|CGFP|CCP|CG3P|CASF|CGI|CJA|CRPA|CCH)/i.exec(reste);
  if (!nom) return { articles, code: null, fin: pos };
  return { articles, code: nom[1].trim(), fin: pos + du[0].length + nom[0].length };
}

const extrait = (ligne) => ligne.replace(/\s+/g, ' ').trim().slice(0, 240);

/**
 * Références d'un texte. `texte` : { id, kind, markdown }. Une ligne = un visa ou un considérant : l'extrait est la ligne.
 * Renvoie [{ cle, type, code, article, libelle, extrait, textId, kind, ligne, rang, date, numero }].
 */
function extraire(texte) {
  const out = []; const lignes = String(texte.markdown || '').split(/\r?\n/);
  lignes.forEach((brut, i) => {
    const ligne = brut.replace(/[*_`]/g, ''); if (!ligne.trim()) return;
    const base = { extrait: extrait(ligne), textId: texte.id ?? null, kind: texte.kind ?? null, ligne: i + 1 };
    const couvert = []; // [début, fin[ déjà interprétés sur la ligne
    const libre = (a, b) => !couvert.some(([x, y]) => a < y && b > x);
    const pousse = (r, a, b) => { couvert.push([a, b]); out.push({ ...base, rang: RANG[r.type] ?? 9, ...r, _pos: a }); };

    // articles de code
    for (const m of ligne.matchAll(/\barticles?\s+/gi)) {
      const lu = lireArticles(ligne, m.index + m[0].length); if (!lu) continue;
      // « … du code X, notamment ses articles L. 1 et L. 2 » : sans code à la suite, on retient le code cité plus tôt sur la même ligne
      let code = lu.code ? codeCle(lu.code) : null;
      if (!code) { const avant = ligne.slice(0, m.index); const trouves = CODES.map(([re, cle, libelle]) => ({ cle, libelle, at: re.exec(norm(avant))?.index })).filter((c) => c.at !== undefined && c.at !== null); if (trouves.length) code = trouves.sort((a, b) => b.at - a.at)[0]; }
      for (const art of lu.articles) {
        if (code) pousse({ cle: `${code.cle}:${art}`, type: 'code', code: code.cle, article: art, libelle: `article ${art.replace(/^([LRD])(?=\d)/, '$1. ')} du ${code.libelle}` }, m.index, lu.fin);
        else pousse({ cle: `article:${art}`, type: 'article', code: null, article: art, libelle: `article ${art} (texte non précisé)` }, m.index, lu.fin);
      }
    }
    // lois, ordonnances, décrets, arrêtés avec numéro
    for (const m of ligne.matchAll(RE_NUMERO_TEXTE)) {
      if (!libre(m.index, m.index + m[0].length)) continue;
      const type = /loi/i.test(m[1]) ? 'loi' : /ordonnance/i.test(m[1]) ? 'ordonnance' : /cret/i.test(m[1]) ? 'decret' : 'arrete';
      const numero = m[2].replace(/\s|[‑–]/g, (c) => (c === '‑' || c === '–' ? '-' : '')); const d = dateIso(m[3]);
      pousse({ cle: `${type}:${numero}`, type, code: null, article: null, numero, date: d, libelle: `${LIB_TEXTE[type]} n° ${numero}${d ? ` du ${dateFr(d)}` : ''}` }, m.index, m.index + m[0].length);
    }
    // texte cité par sa seule date
    for (const m of ligne.matchAll(RE_TEXTE_DATE)) {
      if (!libre(m.index, m.index + m[0].length)) continue;
      const type = /loi/i.test(m[1]) ? 'loi' : /ordonnance/i.test(m[1]) ? 'ordonnance' : /cret/i.test(m[1]) ? 'decret' : 'arrete'; const d = dateIso(m[2]); if (!d) continue;
      pousse({ cle: `${type}:du:${d}`, type, code: null, article: null, date: d, libelle: `${LIB_TEXTE[type]} du ${dateFr(d)}` }, m.index, m.index + m[0].length);
    }
    // délibérations antérieures
    for (const m of ligne.matchAll(RE_DELIB_NUM)) {
      if (!libre(m.index, m.index + m[0].length)) continue;
      const numero = m[1].replace(/[‑–]/g, '-').toUpperCase();
      pousse({ cle: `delib:${numero}`, type: 'delib', code: null, article: null, numero, libelle: `délibération n° ${numero}` }, m.index, m.index + m[0].length);
    }
    for (const m of ligne.matchAll(RE_DELIB_DATE)) {
      if (!libre(m.index, m.index + m[0].length)) continue;
      const d = dateIso(m[1]); if (!d) continue;
      pousse({ cle: `delib:du:${d}`, type: 'delib', code: null, article: null, date: d, libelle: `délibération du ${dateFr(d)}` }, m.index, m.index + m[0].length);
    }
    // codes cités sans article
    for (const m of ligne.matchAll(/\b(code\s+(?:de la |de l['’]|du |des |de |d['’])?[a-zéèêàâûôîç]+(?:\s+(?:et|de|des|du|la|le|les|l['’])?\s*[a-zéèêàâûôîç]+){0,5}|CGCT|CGFP|CCP|CG3P|CASF)\b/gi)) {
      if (!libre(m.index, m.index + m[0].length)) continue;
      const code = codeCle(m[1]); if (!code || !CODES.some(([, c]) => c === code.cle)) continue; // un « code » inconnu, sans article, n'est pas une référence exploitable
      pousse({ cle: code.cle, type: 'code', code: code.cle, article: null, libelle: code.libelle }, m.index, m.index + m[0].length);
    }
  });
  // ordre d'apparition sur la ligne, puis dédoublonnage par (ligne, clé)
  out.sort((a, b) => a.ligne - b.ligne || a._pos - b._pos);
  const vus = new Set();
  return out.filter((r) => { const k = `${r.textId}|${r.ligne}|${r.cle}`; if (vus.has(k)) return false; vus.add(k); return true; }).map(({ _pos, ...r }) => r);
}

/** Ordre conventionnel des visas (IA-35) : lois et codes, ordonnances, décrets, arrêtés, délibérations. Renvoie les lignes hors ordre. */
function ordreVisas(refs) {
  const visas = refs.filter((r) => r.kind === 'visas');
  const parLigne = new Map();
  for (const r of visas) if (!parLigne.has(r.ligne)) parLigne.set(r.ligne, r);
  const hors = []; let max = 0; let precedent = null;
  for (const r of [...parLigne.values()].sort((a, b) => a.ligne - b.ligne)) {
    if (r.rang < max) hors.push({ ...r, apres: precedent }); else { max = r.rang; precedent = r; }
  }
  return hors;
}

module.exports = { extraire, ordreVisas, codeCle, dateIso, dateFr, norm, sansAccent, RANG, CODES };
