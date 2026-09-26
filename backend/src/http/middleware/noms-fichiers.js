/**
 * Noms de fichiers reçus en multipart : les navigateurs envoient le nom en UTF-8, mais multer (busboy) le décode en
 * latin1. « Exposé des motifs.docx » arrive donc « ExposÃ© des motifs.docx » et resterait tel quel dans la base, les
 * documents et les écrans. On rétablit l'encodage une fois pour toutes, juste après la réception du fichier.
 *
 * La conversion n'est appliquée que si elle est SÛRE : réinterpréter les octets latin1 comme de l'UTF-8 ne doit
 * produire aucun caractère de remplacement (sinon le nom était déjà correct, ou l'on abîmerait un nom légitime).
 */
function reparerNom(nom) {
  const s = String(nom || '');
  if (!s) return s;
  // Un nom qui contient déjà un caractère hors latin1 (— … € œ, emoji…) est forcément correct : le « reconvertir »
  // tronquerait ce caractère à son octet bas (U+2014 deviendrait un caractère de contrôle). On n'y touche pas.
  for (const c of s) if (c.codePointAt(0) > 0xff) return s;
  const essai = Buffer.from(s, 'latin1').toString('utf8');
  return essai.includes('\ufffd') ? s : essai;
}

/** Middleware Express : à poser après multer. Corrige `req.file` et `req.files`. */
function nomsUtf8(req, res, next) {
  if (req.file) req.file.originalname = reparerNom(req.file.originalname);
  const liste = Array.isArray(req.files) ? req.files : Object.values(req.files || {});
  for (const f of liste.flat()) if (f) f.originalname = reparerNom(f.originalname);
  next();
}

module.exports = { nomsUtf8, reparerNom };
