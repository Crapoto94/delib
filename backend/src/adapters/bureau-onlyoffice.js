/**
 * Bureau en ligne — adaptateur « serveur de documents » générique, implémenté ici pour ONLYOFFICE Docs (port `BureauPort`).
 *
 * Le moteur est un conteneur séparé (`onlyoffice/documentserver`) : il édite le document dans le navigateur de l'agent
 * (rien à installer sur le poste) et **appelle notre API** quand l'agent enregistre. Il rend aussi le même service pour
 * la conversion en PDF (POST /converter) : un seul moteur, un seul rendu entre ce que l'agent édite et ce que le
 * dossier contient. Le repli LibreOffice / Microsoft Office reste branché derrière (shared/convert.js).
 *
 * Trois adresses, trois sens de circulation — toutes dans le `.env`, aucune en dur :
 *   url              : le backend appelle le moteur (conversion) ;
 *   urlNavigateur    : le navigateur charge le moteur (`api.js`) — adresse ABSOLUE, le moteur occupant sa propre
 *                      origine (jamais un sous-chemin : voir open() ci-dessous et MANIFEST §35) ;
 *   urlRappel        : le moteur appelle le backend (téléchargement du fichier à ouvrir, puis sauvegarde).
 *
 * Le moteur est un service de confiance du réseau interne : il signe ses appels (HS256, secret partagé) et toutes les
 * URL qu'il nous renvoie sont filtrées sur son hôte.
 */
const jwt = require('jsonwebtoken');
const axios = require('axios');
const crypto = require('crypto');

/** Type d'éditeur OnlyOffice par extension (l'API JS dit `cell`, pas `cells`). */
const TYPES = {
  word: ['doc', 'docx', 'rtf', 'odt', 'txt', 'html', 'htm'],
  cell: ['xls', 'xlsx', 'csv', 'ods', 'xlsm'],
  slide: ['ppt', 'pptx', 'odp', 'pptm'],
};
const TYPE_PAR_EXT = Object.fromEntries(Object.entries(TYPES).flatMap(([type, liste]) => liste.map((e) => [e, type])));
const extDe = (nom) => String(nom || '').split('.').pop().toLowerCase();
const sansPointFinal = (s) => String(s || '').replace(/\/+$/, '');
const MAX_TELECHARGE = 64 * 1048576;   // garde-fou : on ne charge jamais plus de 64 Mio depuis le moteur

function createBureauOnlyOffice({ url, urlNavigateur, urlRappel, jwtSecret, publicBaseUrl, langue = 'fr-FR', delaiMs = 60000, sources, log }) {
  const serveur = sansPointFinal(url);
  const hote = serveur ? new URL(serveur).host : '';
  const formats = Object.keys(TYPE_PAR_EXT);
  // Adresse PUBLIQUE vue par le navigateur : c'est sous cette forme que le moteur annonce ses propres fichiers
  // (document, cache, PDF converti). Si le navigateur charge le moteur par un chemin de l'application
  // (`BUREAU_URL_NAVIGATEUR=/office-delib`), l'hôte public est celui de l'application (`PUBLIC_BASE_URL`).
  const absoluNavigateur = /^https?:\/\//i.test(String(urlNavigateur || ''));
  const hotePublic = absoluNavigateur
    ? new URL(urlNavigateur).host
    : (publicBaseUrl ? new URL(publicBaseUrl).host : '');
  const prefixePublic = absoluNavigateur ? '' : String(urlNavigateur || '').replace(/\/+$/, '');   // ex. « /office-delib »

  /** Un lien reçu du moteur n'est suivi que s'il pointe vers le moteur lui-même (anti-SSRF) : par son adresse
   *  interne (`BUREAU_URL`, ce que le backend appelle) ou par son adresse publique (`BUREAU_URL_NAVIGATEUR`, celle que
   *  le moteur annonce et que le navigateur utilise). Toute autre adresse est ignorée. */
  const deConfiance = (cible) => {
    try {
      const h = new URL(String(cible)).host;
      return (!!hote && h === hote) || (!!hotePublic && h === hotePublic);
    } catch { return false; }
  };

  /** Adresse de relecture côté serveur. Le moteur annonce ses fichiers sur son adresse PUBLIQUE
   *  (`https://<app>/office-delib/cache/…`) : le backend, lui, les relit par l'adresse INTERNE, en retirant le
   *  préfixe public. Cela évite au passage de dépendre du certificat du frontal et de sa mise en cache. */
  const urlInterne = (cible) => {
    const u = new URL(String(cible));
    if (u.host === hote || !hotePublic) return u.toString();          // déjà l'adresse interne
    const chemin = (prefixePublic && u.pathname.startsWith(`${prefixePublic}/`))
      ? u.pathname.slice(prefixePublic.length) : u.pathname;
    return new URL(`${chemin}${u.search}`, sansPointFinal(url)).toString();
  };

  const signer = (payload) => jwt.sign(payload, jwtSecret, { expiresIn: '2h' });

  return {
    moteur: 'onlyoffice',

    capabilities: () => ({ enabled: true, formats, mobile: true, moteur: 'onlyoffice' }),

    /**
     * Configuration d'éditeur à charger dans le navigateur. `cle` est la clé de session du moteur : elle est rendue
     * unique par version et par ouverture, donc le moteur ne réutilise jamais le cache d'une version antérieure.
     * `forcesave` fait remonter chaque enregistrement sans attendre la fermeture de l'agent.
     */
    open({ cle, nom, url: urlSource, user, mobile }) {
      const fileType = extDe(nom);
      const documentType = TYPE_PAR_EXT[fileType];
      if (!documentType) return null;
      const config = {
        documentType,
        type: mobile ? 'mobile' : 'desktop',
        width: '100%',
        height: '100%',
        document: {
          fileType, key: cle, title: nom, url: urlSource,
          permissions: { edit: true, download: true, print: true, comment: false },
          info: { owner: user?.username || '', uploaded: new Date().toUTCString() },
        },
        editorConfig: {
          mode: 'edit',
          lang: langue,
          callbackUrl: `${sansPointFinal(urlRappel)}/api/v1/public/bureau/rappel`,
          forcesave: true,
          user: { id: String(user?.id ?? user?.username ?? ''), name: user?.name || user?.username || '' },
          // `autosave: true` n'est pas un confort : c'est ce qui permet à « Sauvegarder et fermer » d'aboutir. Sans lui,
          // ONLYOFFICE passe en mode STRICT, où les frappes de l'agent ne sont intégrées au document qu'au moment où
          // LUI enregistre — notre commande serveur ne trouverait alors aucune modification à sauver (erreur 4).
          // Aucune version n'est créée par l'enregistrement automatique : seule une sauvegarde demandée rappelle notre API.
          customization: { compactHeader: true, compactToolbar: false, hideRightMenu: false, autosave: true, forcesave: true },
        },
      };
      // Le moteur DOIT être servi sur sa propre origine (port ou sous-domaine), pas sous un sous-chemin : placé sous
      // « /office/ », il construit certaines URL internes sans ce préfixe et l'éditeur finit par ouvrir autre chose
      // que le document (« le contenu ne correspond pas à l'extension »). Quand l'adresse du navigateur est absolue,
      // on la déclare donc explicitement au SDK — AVANT la signature : le jeton doit couvrir toute la configuration.
      if (/^https?:\/\//i.test(urlNavigateur)) config.documentServerUrl = sansPointFinal(urlNavigateur);
      config.token = signer(config);   // le moteur n'accepte la configuration que signée
      return { sdk: `${sansPointFinal(urlNavigateur)}/web-apps/apps/api/documents/api.js`, config };
    },

    /** Le rappel du moteur est anonyme (c'est lui qui appelle) : son jeton HS256 fait l'authentification. ONLYOFFICE
     *  l'envoie en en-tête (Authorization) et, si JWT_IN_BODY est actif, aussi dans le corps : on lit les deux. */
    verifyCallback(req) {
      const brut = String(req?.get?.('authorization') || req?.headers?.authorization || req?.body?.token || '').replace(/^Bearer\s+/i, '').trim();
      if (!brut) return { ok: false, code: 'jeton_absent' };
      try {
        let payload = jwt.verify(brut, jwtSecret);
        if (payload?.payload && typeof payload.payload === 'object') payload = payload.payload;   // enveloppe d'ONLYOFFICE 4.x
        if (!payload?.key) return { ok: false, code: 'cle_absente' };
        return { ok: true, payload, jeton: brut };   // le jeton du rappel est aussi l'identification de la source à relire
      } catch { return { ok: false, code: 'signature_invalide' }; }
    },

    /** Relit le document que le moteur nous renvoie. Le lien du rappel est signé par le moteur et expire (900 s par
     *  défaut) ; on ne le suit que s'il vient bien de notre moteur, et on borne la taille. Le téléchargement reprend le
     *  jeton du rappel : ONLYOFFICE n'accepte la source que si l'appel est authentifié, et il vérifie que le jeton
     *  porte bien l'URL demandée (or le jeton du rappel contient précisément cette URL). */
    async readBack({ url, filetype, jeton } = {}) {
      if (!url || !deConfiance(url)) { log?.warn?.({}, 'rappel du moteur : lien hors du moteur, ignoré'); return null; }
      const entetes = jeton ? { Authorization: `Bearer ${jeton}` } : {};
      const r = await axios.get(urlInterne(url), { headers: entetes, responseType: 'arraybuffer', timeout: delaiMs, maxBodyLength: MAX_TELECHARGE, maxContentLength: MAX_TELECHARGE, validateStatus: () => true });
      if (r.status !== 200 || !r.data?.length) { log?.warn?.({ status: r.status }, 'relecture du document impossible'); return null; }
      return { buffer: Buffer.from(r.data), ext: String(filetype || extDe(new URL(url).pathname) || '').toLowerCase() };
    },

    /**
     * Demande au moteur d'enregistrer MAINTENANT le document ouvert (service de commandes, POST /command). C'est ce qui
     * permet à « Sauvegarder et fermer » de tenir sa promesse : l'ordre part du serveur, pas du navigateur, donc fermer
     * l'onglet n'annule rien. Le moteur rappelle ensuite notre route de sauvegarde avec le document à jour.
     *
     * Réponses du moteur : 0 = accepté (le rappel va venir) ; 4 = « aucune modification à enregistrer », donc le
     * document est DÉJÀ enregistré — ce n'est pas un échec, il n'y a rien à faire de plus.
     */
    async forcerSauvegarde(cle) {
      if (!serveur || !cle) return { ok: false, erreur: 'moteur_absent' };
      try {
        const corps = { c: 'forcesave', key: String(cle) };
        const signature = signer(corps);
        const r = await axios.post(`${serveur}/command`, { ...corps, token: signature },
          { headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${signature}` }, timeout: delaiMs, validateStatus: () => true });
        const data = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
        if (r.status !== 200) return { ok: false, erreur: `moteur (${r.status})` };
        if (data.error === 4) return { ok: true, inchange: true };     // rien de neuf : déjà enregistré
        if (data.error !== undefined && data.error !== 0) { log?.warn?.({ erreur: data.error }, 'sauvegarde forcée refusée par le moteur'); return { ok: false, erreur: `moteur (${data.error})` }; }
        return { ok: true };
      } catch (e) { log?.warn?.({ err: e.message }, 'sauvegarde forcée impossible'); return { ok: false, erreur: 'moteur injoignable' }; }
    },

    /** Conversion PDF mutualisée avec l'édition : même moteur, donc le PDF du dossier ressemble à ce que l'agent édite.
     *  `sources(buffer, meta)` est injecté à la construction : il dépose le tampon et renvoie son jeton (voir
     *  shared/transitoire.js). Le moteur va le chercher à l'adresse que nous lui servons, en une requête. */
    async versPdf({ buffer, ext }) {
      if (!sources) return null;
      const e = String(ext || '').toLowerCase();
      if (!TYPES[TYPE_PAR_EXT[e]]) return null;
      const cle = `cvt-${crypto.randomBytes(6).toString('hex')}`;
      const depose = await sources(buffer, { nom: `source.${e}`, mime: 'application/octet-stream' });
      if (!depose?.jeton) return null;
      const urlSource = `${sansPointFinal(urlRappel)}/api/v1/public/bureau/source/${depose.jeton}`;
      try {
        const corps = { async: false, filetype: e, key: cle, outputtype: 'pdf', title: `source.${e}`, url: urlSource };
        const signature = signer(corps);
        // ONLYOFFICE valide le jeton dans le corps *et* dans l'en-tête (JWT_IN_BODY peut être désactivé) : on envoie les deux.
        const r = await axios.post(`${serveur}/converter`, { ...corps, token: signature },
          { headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${signature}` }, timeout: delaiMs, validateStatus: () => true });
        if (r.status !== 200) { log?.warn?.({ status: r.status }, 'conversion refusée par le moteur'); return null; }
        const data = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
        if (data.error !== undefined && data.error !== 0) { log?.warn?.({ erreur: data.error }, 'conversion en échec côté moteur'); return null; }
        const sortie = data.fileUrl || data.url;
        if (!sortie || !deConfiance(sortie)) return null;
        // Le PDF temporaire se retélécharge avec le même jeton : il porte le corps de la demande, dont l'URL générée.
        // Comme pour le rappel, on le relit par l'adresse INTERNE du moteur (il est annoncé sur l'adresse publique).
        const p = await axios.get(urlInterne(sortie), { headers: { Authorization: `Bearer ${signature}` }, responseType: 'arraybuffer', timeout: delaiMs, maxBodyLength: MAX_TELECHARGE, maxContentLength: MAX_TELECHARGE, validateStatus: () => true });
        if (p.status !== 200 || !p.data?.length) return null;
        return { buffer: Buffer.from(p.data), moteur: 'onlyoffice' };
      } catch (e) { log?.warn?.({ err: e.message }, 'conversion via le moteur impossible'); return null; }
    },
  };
}

module.exports = { createBureauOnlyOffice };
