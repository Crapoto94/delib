/**
 * Sites autorisés à intégrer les pages publiques (iframe) et à lire l'API publique depuis un navigateur (script d'intégration).
 * Réglage d'organisme `publication.sites_autorises` (Paramétrage › Mise à disposition et affichage) : une entrée par ligne, au format
 * `https://ivry94.fr`, `https://*.ivry94.fr` (tous les sous-domaines, pas le domaine nu) ou `http://*.ivry.local` ; port facultatif.
 *
 * C'est une protection de NAVIGATEUR (en-tête `frame-ancestors` et CORS) : un programme qui appelle l'API directement lit les mêmes données
 * publiques. Les entrées invalides sont ignorées à la lecture (jamais recopiées dans un en-tête : pas d'injection).
 */
const DEFAUT = ['https://ivry94.fr', 'https://*.ivry94.fr', 'https://*.ivry.local', 'http://*.ivry.local'];
const ENTREE = /^(https?):\/\/(\*\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\d{1,5}))?$/;
const TTL_MS = 30000;

/** Entrées valides, minuscules, sans doublon, d'un texte (lignes, espaces ou virgules) ou d'un tableau ; les autres sont renvoyées à part. */
function lire(valeur) {
  const brut = (Array.isArray(valeur) ? valeur : String(valeur ?? '').split(/[\s,;]+/)).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  const valides = []; const ignorees = [];
  for (const e of [...new Set(brut)]) (ENTREE.test(e) && valides.length < 50 ? valides : ignorees).push(e);
  return { valides, ignorees };
}

/** `origine` (valeur de l'en-tête Origin) est-elle couverte par la liste ? */
function autorise(origine, liste) {
  let u;
  try { u = new URL(origine); } catch { return false; }
  if (!['http:', 'https:'].includes(u.protocol)) return false;
  const schema = u.protocol.slice(0, -1); const hote = u.hostname.toLowerCase(); const port = u.port || '';
  return liste.some((e) => {
    const m = ENTREE.exec(e); if (!m) return false;
    const [, s, joker, domaine, p] = m;
    if (s !== schema || (p || '') !== port) return false;
    return joker ? hote.endsWith(`.${domaine}`) : hote === domaine;
  });
}

function createOrigines({ db, settings }) {
  let cache = null; // { quand, liste }
  const svc = {
    DEFAUT, lire, autorise,

    /** Liste effective (réglage de l'organisme par défaut, sinon la liste par défaut). */
    async liste() {
      if (cache && Date.now() - cache.quand < TTL_MS) return cache.liste;
      let liste = DEFAUT;
      try {
        const o = await db.get('SELECT id FROM organismes WHERE is_default AND actif');
        const v = o ? (await settings.resolve(o.id))['publication.sites_autorises']?.value : undefined;
        if (v !== undefined && v !== null && String(v).trim() !== '') liste = lire(v).valides;
      } catch { /* base indisponible : liste par défaut */ }
      cache = { quand: Date.now(), liste };
      return liste;
    },
    oublier() { cache = null; },

    /** Valeur de `frame-ancestors` : les sites autorisés, ou 'self' si la liste est vide (personne d'autre ne peut intégrer). */
    async frameAncestors() { const l = await svc.liste(); return l.length ? l.join(' ') : "'self'"; },
  };
  return svc;
}

module.exports = { createOrigines, lire, autorise, DEFAUT };
