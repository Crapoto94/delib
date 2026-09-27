/**
 * Bureau en ligne — hôte **WOPI**, protocole de Collabora Online (côté moteur).
 *
 * ONLYOFFICE nous rappelle une route à chaque sauvegarde. Collabora, lui, connaît une adresse (`WOPISrc`) et vient
 * chercher le document, puis le rapporte : c'est nous qui sommes l'hôte WOPI. Cinq échanges suffisent :
 *
 *   CheckFileInfo   GET  /wopi/:cle            → qui est l'auteur, quelles capacités, quelle taille, quelle version
 *   GetFile         GET  /wopi/:cle/contents   → le document à éditer
 *   PutFile         POST /wopi/:cle/contents   → le document enregistré (X-WOPI-Override: PUT)
 *   LOCK / UNLOCK / REFRESH_LOCK / GET_LOCK    → le verrou d'écriture d'une session
 *
 * L'écriture emprunte EXACTEMENT le même chemin que le rappel d'ONLYOFFICE (`enregistrerDepuisMoteur`) : nouvelle
 * version, PDF régénéré, audit, réindexation, contrôle du gel après transmission. Changer de moteur ne change donc
 * rien à la traçabilité : cela ne change que le transport.
 *
 * Pas de limiteur de débit (comme les autres routes publiques du bureau) : Collabora appelle en boucle pendant une
 * session. La sécurité tient à la clé de session : 128 bits tirés au sort, en base, expirante, et que le moteur ne
 * connaît que parce qu'on le lui donne.
 */
const { E } = require('../../shared/errors');

/** Verrous d'écriture WOPI : le moteur en tient un par session ouverte, on les garde le temps de la session. */
const verrous = new Map();
const DUREE_VERROU_MS = 6 * 3600 * 1000;        // un verrou orphelin ne doit pas encombrer la mémoire du service
setInterval(() => {
  const maintenant = Date.now();
  for (const [cle, v] of verrous) if (v.expire < maintenant) verrous.delete(cle);
}, DUREE_VERROU_MS).unref?.();

module.exports = function creerWopi({ bureau, port }) {
  /** Garde d'accès : la clé de session EST le jeton d'accès (Collabora le relaie depuis le WOPISrc). */
  async function session(req) {
    const cle = String(req.valid?.params?.cle || '');
    const acces = port.verifierAcces(cle, req.query?.access_token);
    if (!acces.ok) throw E.forbidden('Jeton d’accès invalide');
    const s = await bureau.sessionWopi(cle);
    if (!s) throw E.notFound('Session introuvable ou expirée');
    return s;
  }

  const entetes = (res, extra = {}) => res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-WOPI-ServerVersion': 'vibedelib',
    ...extra,
  });

  /** 409 + le verrou qui bloque : c'est ainsi que le protocole dit « ce n'est pas ton verrou, réessaie ». */
  const conflit = (res, existant) => res.set({ 'X-WOPI-Lock': String(existant || '') }).status(409).text('');

  return {
    /** CheckFileInfo : l'état du document et ce que Collabora a le droit d'y faire. */
    async checkFileInfo(req, res) {
      const s = await session(req);
      entetes(res).json(await bureau.infoWopi(s));
    },

    /** GetFile : le document lui-même. */
    async getFile(req, res) {
      const s = await session(req);
      const f = await bureau.fichierWopi(s);
      entetes(res, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(f.buffer.length) }).send(f.buffer);
    },

    /**
     * PutFile : l'enregistrement. Le verrou doit être celui que nous avons rendu à LOCK (sinon 409, et Collabora
     * réessaiera). Réponse `{"Status":0}` en cas de succès, `{"Status":1,…}` sinon.
     */
    async putFile(req, res) {
      const s = await session(req);
      const attendu = String(req.get('x-wopi-lock') || '');
      const v = verrous.get(s.cle);
      if (!v || v.valeur !== attendu) return conflit(res, v?.valeur);
      const buffer = req.body;            // binaire brut : l'analyseur JSON global l'aurait ignoré (cf. app.js)
      if (!Buffer.isBuffer(buffer) || !buffer.length) return res.status(200).json({ Status: 1, Message: 'contenu vide' });
      const ecrit = await bureau.enregistrerDepuisMoteurWopi(s, buffer);
      if (ecrit.refuse) return res.status(200).json({ Status: 1, Message: ecrit.refuse });
      return entetes(res, { 'X-WOPI-ItemVersion': String(ecrit.version) }).status(200).json({ Status: 0 });
    },

    /** LOCK / UNLOCK / REFRESH_LOCK / GET_LOCK : le verrou d'écriture. */
    async verrou(req, res) {
      const s = await session(req);
      const action = String(req.get('x-wopi-override') || '').toUpperCase();
      const fourni = String(req.get('x-wopi-lock') || '');
      const v = verrous.get(s.cle);
      if (action === 'LOCK') {
        if (v && v.valeur !== fourni) return conflit(res, v.valeur);
        const valeur = fourni || port.nouveauNonce();
        verrous.set(s.cle, { valeur, expire: Date.now() + DUREE_VERROU_MS });
        return entetes(res, { 'X-WOPI-Lock': valeur }).status(200).text('');
      }
      if (action === 'REFRESH_LOCK') {
        if (!v || v.valeur !== fourni) return conflit(res, v?.valeur);
        v.expire = Date.now() + DUREE_VERROU_MS;
        return entetes(res, { 'X-WOPI-Lock': v.valeur }).status(200).text('');
      }
      if (action === 'UNLOCK') {
        if (!v || v.valeur !== fourni) return conflit(res, v?.valeur);
        verrous.delete(s.cle);
        return entetes(res).status(200).text('');
      }
      // GET_LOCK : 200 + le verrou s'il y en a un, 409 + verrou vide sinon (contrat du protocole).
      if (v) return entetes(res, { 'X-WOPI-Lock': v.valeur }).status(200).text('');
      return conflit(res, '');
    },

    /** GET_RANDOM_USER_ID : Collabora demande un identifiant d'utilisateur « aléatoire » pour son cache local. */
    async randomUserId(req, res) {
      await session(req);
      return entetes(res, { 'X-WOPI-UserId': port.nouveauNonce() }).status(200).text('');
    },

    /** Opérations que nous n'offrons pas : lien de partage, renommage, application mobile COBALT. */
    async nonSoute(req, res) {
      res.status(501).json({ Status: 1, Message: 'non pris en charge' });
    },
  };
};
