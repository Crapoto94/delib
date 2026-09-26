/**
 * Contenus transitoires adressables par jeton (serveur de documents, une seule requête).
 *
 * La conversion PDF mutualisée doit pouvoir donner au moteur une adresse où aller chercher le fichier : le moteur
 * appelle notre API, il ne lit pas notre disque. On garde donc le tampon en mémoire, le temps de l'appel, plutôt que
 * d'écrire un fichier éphémère dans la GED (qu'il faudrait ensuite classer et purger). Le lien est à usage unique et
 * expire : si le backend redémarre au milieu d'une conversion, la conversion échoue proprement et l'appelant part
 * sur son moteur de repli — c'est le comportement voulu.
 */
const crypto = require('crypto');

const TTL_PAR_DEFAUT = 300000;   // 5 minutes
const POIDS_MAX = 96 * 1048576;  // 96 Mio au total : au-delà, on purge les plus anciens

function createTransitoire({ ttlMs = TTL_PAR_DEFAUT, poidsMax = POIDS_MAX } = {}) {
  const contenus = new Map();   // jeton -> { buffer, nom, mime, expire, poids }

  const purger = () => {
    const t = Date.now();
    for (const [jeton, c] of contenus) if (c.expire <= t) contenus.delete(jeton);
    let poids = 0; for (const c of contenus.values()) poids += c.poids;
    if (poids <= poidsMax) return;
    const tries = [...contenus.entries()].sort((a, b) => a[1].expire - b[1].expire);
    for (const [jeton, c] of tries) { if (poids <= poidsMax) break; poids -= c.poids; contenus.delete(jeton); }
  };

  return {
    /** Dépose un tampon et renvoie son jeton (128 bits) : c'est lui qui fait l'adresse. */
    mettre(buffer, { nom = 'document', mime = 'application/octet-stream', ttl } = {}) {
      purger();
      const jeton = crypto.randomBytes(16).toString('hex');
      contenus.set(jeton, { buffer, nom, mime, expire: Date.now() + (ttl || ttlMs), poids: buffer.length });
      return { jeton, nom, mime };
    },
    /** Lecture à usage unique : le lien ne sert qu'une fois. */
    prendre(jeton) {
      purger();
      const c = contenus.get(String(jeton || ''));
      if (!c || c.expire <= Date.now()) return null;
      contenus.delete(jeton);
      return { buffer: c.buffer, nom: c.nom, mime: c.mime };
    },
    get taille() { return contenus.size; },
  };
}

module.exports = { createTransitoire };
