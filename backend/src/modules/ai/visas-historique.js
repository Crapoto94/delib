/**
 * Visas de l'HISTORIQUE des délibérations : extraction des « Vu … » d'un texte de délibération, puis regroupement par référence juridique
 * (code et article, loi, ordonnance, décret, arrêté) avec le nombre de délibérations qui la citent. Sert à PROPOSER des entrées à la bibliothèque de visas ;
 * rien n'est affirmé de mémoire (IA-05) : une entrée créée à partir de l'historique n'est jamais « vérifiée » — le juridique la contrôle à la source.
 */
const R = require('./references');

const TYPES_BIBLIOTHEQUE = ['code', 'loi', 'ordonnance', 'decret', 'arrete'];

// L'extraction d'un PDF coupe parfois les mots (« collectivi tés », « article s ») : on recolle un court fragment à son mot quand le résultat est un mot du
// vocabulaire juridique (noms de codes compris). Volontairement limité à ce vocabulaire : jamais de recollage hasardeux.
const sansAccent = (x) => String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const VOCABULAIRE = new Set([...R.CODES.flatMap(([, , libelle]) => libelle.split(/[\s']+/)), 'articles', 'article', 'notamment', 'ordonnance', 'decret', 'arrete', 'deliberation', 'delibere', 'considerant', 'territoriale', 'territoriales', 'collectivites', 'publique', 'publiques', 'general', 'generale']
  .map(sansAccent).filter((m) => m.length >= 5));
function reparerEspaces(texte) {
  const mots = String(texte || '').split(' '); const out = [];
  for (let i = 0; i < mots.length; i++) {
    const suivant = mots[i + 1];
    if (suivant !== undefined && suivant.length > 0 && suivant.length <= 4 && /^[\p{L}]+$/u.test(suivant) && mots[i].length > 0 && VOCABULAIRE.has(sansAccent(mots[i] + suivant)) && !VOCABULAIRE.has(sansAccent(suivant))) { out.push(mots[i] + suivant); i++; } else out.push(mots[i]);
  }
  return out.join(' ');
}

// Début d'un visa : « vu le/la/les/l'/du/des… », en minuscules comme en majuscules (les textes d'archive écrivent « vu le code… »). Un « vu » courant
// (« au vu de », « vu que ») ne commence pas un visa. Bornes d'un paragraphe dans un texte aplati par l'extraction PDF : visa, considérant, décision, premier article.
const DEBUT_VU = String.raw`vu\s+(?:les?\b|la\b|du\b|des\b|ledit\b|ladite\b|l['’])`;
const BORNE = new RegExp(String.raw`(?=\b${DEBUT_VU}|\bconsid[ée]rant\b|\bapr[èe]s en avoir d[ée]lib[ée]r[ée]\b|\bd[ée]cide\b|\bd[ée]lib[èe]re\b|\barticle\s+(?:1|premier|unique)\b)`, 'gi');
const EST_VISA = new RegExp(`^${DEBUT_VU}`, 'i');
const FIN_VISAS = new RegExp(String.raw`^(?:d[ée]cide|d[ée]lib[èe]re|apr[èe]s en avoir d[ée]lib[ée]r[ée]|article\s+(?:1|premier|unique))`, 'i');
const MAX_VISA = 700;

/** Paragraphes « vu … » d'un texte (aplati ou non). */
function paragraphesVu(texte) {
  const t = reparerEspaces(String(texte || '').replace(/\s+/g, ' ').trim());
  const morceaux = t.split(BORNE).map((x) => x.trim()).filter(Boolean);
  const fin = morceaux.findIndex((x) => FIN_VISAS.test(x));                                 // la décision commence : un « vu » plus loin appartient au dispositif
  return (fin === -1 ? morceaux : morceaux.slice(0, fin)).filter((x) => EST_VISA.test(x)).map((x) => x.slice(0, MAX_VISA));
}

/** Références (types de la bibliothèque seulement) des « vu » d'une délibération, une fois chacune. */
function referencesDuTexte(texte) {
  const vues = new Map();
  for (const p of paragraphesVu(texte)) {
    for (const x of R.extraire({ id: null, kind: 'visas', markdown: p })) {
      // la bibliothèque ne connaît que « code », « code:ARTICLE », « type:NUMERO » : pas de référence par la seule date ni d'article sans code
      if (!TYPES_BIBLIOTHEQUE.includes(x.type) || x.cle.split(':').length > 2 || x.cle.includes(':du:')) continue;
      if (!vues.has(x.cle)) vues.set(x.cle, { cle: x.cle, type: x.type, code: x.code ?? null, article: x.article ?? null, numero: x.numero ?? null, date: x.date ?? null, libelle: x.libelle, exemple: p });
    }
  }
  return [...vues.values()];
}

/**
 * Rubrique d'une délibération d'archive : le texte commence par « … OBJET : <RUBRIQUE> <titre> ». On retient la plus longue rubrique connue qui suit « OBJET : »
 * (comparaison sans accents ni casse) ; null si aucune ne correspond.
 */
function rubriqueDuTexte(texte, rubriques) {
  const plat = (x) => sansAccent(String(x).replace(/\s+/g, ' ')).toUpperCase().trim();
  const m = /OBJET\s*:\s*([^]{0,120})/i.exec(String(texte || ''));
  if (!m) return null;
  const apres = plat(m[1]); let meilleure = null;
  for (const r of rubriques) { const p = plat(r); if (apres.startsWith(p) && (!meilleure || p.length > plat(meilleure).length)) meilleure = r; }
  return meilleure;
}

/** Cumul sur plusieurs délibérations : `ajouter(refs, annee)` pour chacune, puis `candidats({ min })`. */
function creerCumul() {
  const m = new Map();
  return {
    ajouter(refs, annee = null, rubrique = null) {
      for (const r of refs) {
        const e = m.get(r.cle) || { cle: r.cle, type: r.type, code: r.code, article: r.article, libelle: r.libelle, delibs: 0, premiere: null, derniere: null, exemple: r.exemple, rubriques: {} };
        e.delibs++;
        if (rubrique) e.rubriques[rubrique] = (e.rubriques[rubrique] || 0) + 1;
        if (annee) { e.premiere = e.premiere === null ? annee : Math.min(e.premiere, annee); e.derniere = e.derniere === null ? annee : Math.max(e.derniere, annee); }
        if (r.exemple.length < e.exemple.length) e.exemple = r.exemple;   // la formulation la plus courte : la plus lisible
        m.set(r.cle, e);
      }
    },
    candidats({ min = 2 } = {}) { return [...m.values()].filter((e) => e.delibs >= min).sort((a, b) => b.delibs - a.delibs || (a.cle < b.cle ? -1 : 1)); },
    get total() { return m.size; },
  };
}

/** Usage constaté d'un candidat dans l'historique (stocké dans `usage_stats` : factuel, jamais réécrit par l'IA). */
function statsUsage(c, total) {
  return {
    total, citations: c.delibs, de: c.premiere, a: c.derniere, formulation: c.exemple.slice(0, 400),
    rubriques: Object.entries(c.rubriques || {}).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, 8).map(([libelle, n]) => ({ libelle, n })),
  };
}

/** Ligne de la bibliothèque (visa_library) pour un candidat : jamais vérifiée, statut « en vigueur » par défaut (le juridique corrige). */
function entreeBibliotheque(c) {
  const periode = c.premiere ? (c.premiere === c.derniere ? ` en ${c.premiere}` : ` de ${c.premiere} à ${c.derniere}`) : '';
  return {
    cle: c.cle, type: c.type, code: c.code, article: c.article, intitule: c.libelle.charAt(0).toUpperCase() + c.libelle.slice(1), statut: 'en_vigueur',
    source: 'Historique des délibérations (AIRS)', note: `Citée dans ${c.delibs} délibération${c.delibs > 1 ? 's' : ''}${periode}. Jamais vérifiée : à contrôler à la source (Légifrance) avant usage.`,
  };
}

module.exports = { rubriqueDuTexte, statsUsage, reparerEspaces, paragraphesVu, referencesDuTexte, creerCumul, entreeBibliotheque, TYPES_BIBLIOTHEQUE };
