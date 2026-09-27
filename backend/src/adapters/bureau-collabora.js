/**
 * Bureau en ligne — adaptateur `BureauPort` implémenté pour COLLABORA ONLINE (le second moteur possible).
 *
 * Collabora ne parle pas l'API d'ONLYOFFICE : c'est un hôte **WOPI**. Le contrat est donc inversé — au lieu de notre
 * serveur de rappeler une route à chaque enregistrement, c'est le moteur qui vient *tirer* le document (CheckFileInfo
 * puis GetFile) et qui *rapporte* la sauvegarde (PutFile) à l'adresse que nous lui donnons, en y joignant un jeton
 * d'accès. Tout l'échange passe donc par les routes `/api/v1/public/bureau/wopi/*` (voir `wopi.js`) ; cet adaptateur
 * ne fait que préparer l'adresse WOPI servie à l'iframe et préciser ce que le protocole autorise :
 *
 *   - pas de commande « enregistre maintenant » : Collabora enregistre tout seul (à intervalle régulier et à la
 *     fermeture de la session). « Sauvegarder et fermer » consiste donc à **terminer la session** — le moteur écrit
 *     alors le document — puis à attendre l'écriture (`forcerSauvegarde` → `{ ok, fermeture }`) ;
 *   - pas de service de conversion : Collabora n'a pas d'équivalent de `/converter`. Le PDF passe donc par le repli
 *     LibreOffice (shared/convert.js), comme quand aucun moteur n'est déployé. C'est le principal écart de rendu entre
 *     les deux moteurs, et il est assumé : le PDF du dossier est produit par LibreOffice, l'agent édite dans Collabora.
 *
 * L'adresse du moteur est la même des deux côtés que pour ONLYOFFICE (`url` pour le serveur, `urlNavigateur` pour le
 * navigateur) : le navigateur reçoit ici une `src` d'iframe au lieu d'un SDK à charger.
 */
const crypto = require('crypto');

/** Formats que Collabora sait ouvrir (LibreOffice + import OOXML) : les mêmes familles que l'autre moteur. */
const FORMATS = ['doc', 'docx', 'rtf', 'odt', 'txt', 'html', 'htm', 'xls', 'xlsx', 'xlsm', 'csv', 'ods', 'ppt', 'pptx', 'odp'];
const sansPointFinal = (s) => String(s || '').replace(/\/+$/, '');

function createBureauCollabora({ url, urlNavigateur, publicBaseUrl, langue = 'fr-FR', log } = {}) {
  const serveur = sansPointFinal(url);
  const navigateur = sansPointFinal(urlNavigateur);

  /**
   * Adresse du document pour Collabora (le `WOPISrc` de l'URL de l'éditeur).
   *
   * CONTRAIREMENT au rappel d'ONLYOFFICE — que le MOTEUR appelle depuis le réseau Docker — les appels WOPI
   * (CheckFileInfo, GetFile, PutFile) viennent du **navigateur** : c'est donc l'adresse **publique** du backend qui
   * convient, jamais l'adresse interne. Une adresse `http://10.x.x.x:3021` serait refusée par le navigateur pour
   * deux raisons: elle n'est pas joignable depuis le poste de l'agent, et le mélange http/https est bloqué.
   * Le jeton d'accès est la clé de session elle-même (128 bits tirés au sort, en base, expirante) : Collabora l'exige
   * dans le WOPISrc et le renvoie ensuite sur chaque appel. Aucune clé secrète supplémentaire à partager.
   */
  const urlWopi = (cle) => `${sansPointFinal(publicBaseUrl)}/api/v1/public/bureau/wopi/${cle}?access_token=${cle}`;

  return {
    moteur: 'collabora',

    capabilities: () => ({ enabled: !!navigateur, formats: FORMATS, mobile: true, moteur: 'collabora' }),

    /**
     * Collabora s'intègre par une iframe : on renvoie son URL, le reste du contrat (WOPI) est assuré par les
     * routes publiques. Le `lang` est celui de l'interface de Collabora ; `revisionhistory=false` évite d'afficher une
     * notion d'historique que nous fournissons ailleurs (l'historique des versions d'une annexe).
     *
     * Le préfixe `/collabora-delib` est celui du relais, et Collabora n'annonce que des URL **sous ce préfixe**
     * (`--o:net.service_root`) : c'est cohérent des deux côtés. Sans `PUBLIC_BASE_URL`, on ne peut pas servir de
     * WOPISrc au navigateur : mieux vaut refuser d'ouvrir que servir une adresse que le navigateur ne peut pas
     * appeler.
     */
    open({ cle, nom, user, urlRappel }) {
      if (!navigateur || !publicBaseUrl) {
        if (navigateur && !publicBaseUrl) log?.warn?.({}, 'Collabora installé mais PUBLIC_BASE_URL absent : aucune adresse WOPI servable au navigateur');
        return null;
      }
      const source = urlWopi(cle);
      const params = new URLSearchParams({
        WOPISrc: source,
        access_token_t: cle,          // jeton aussi dans l'URL du navigateur : Collabora le relaie au WOPISrc
        lang: langue,
        revisionhistory: 'false',
        closebutton: 'false',         // la fermeture est pilotée par notre barre d'outils (« Sauvegarder et fermer »)
        embedded: 'true',
        hideExport: 'false',
        userprofile: 'false',
      });
      return { src: `${navigateur}/browser/${cle}/cool.html?${params.toString()}`, config: { UserId: String(user?.username || '') } };
    },

    /**
     * Collabora n'appelle pas de route de rappel : il n'y a donc pas de jeton de rappel à vérifier. La méthode existe
     * pour que le contrat soit complet ; elle dit simplement « ce moteur ne publie rien de ce côté ».
     */
    verifyCallback() {
      return { ok: false, code: 'sans_rappel' };
    },

    /** Symétrique de `verifyCallback` pour Collabora : jamais de relecture, le contenu nous est rapporté (PutFile). */
    async readBack() {
      return null;
    },

    /**
     * Collabora n'expose aucune commande d'enregistrement côté serveur. La seule façon de l'obtenir est de terminer la
     * session d'édition : l'interface retire l'iframe, Collabora écrit alors le document chez nous, et l'écriture
     * arrive sur notre hôte WOPI. `{ fermeture: true }` dit au service d'attendre cette écriture au lieu d'exiger un
     * accusé du moteur.
     */
    async forcerSauvegarde(cle) {
      if (!cle) return { ok: false, erreur: 'session_absente' };
      return { ok: true, fermeture: true };
    },

    /** Pas de conversion côté Collabora : le repli LibreOffice prend le relais (renvoie `null` = « pas possible ici »). */
    async versPdf() {
      return null;
    },

    /** Coordonnées du moteur, pour les diagnostics (et l/admin). */
    infos: () => ({ moteur: 'collabora', url: serveur, navigateur, formats: FORMATS }),

    /**
     * Vérifie l'accès WOPI : la clé de session EST le jeton d'accès, il suffit qu'il corresponde.
     *
     * Collabora ne renvoie pas le jeton nu : il y accroche ses propres paramètres de diagnostic en ***
     * collant un point d'interrogation*** — sur une session réelle on reçoit
     * `access_token=<clé>?debug=0`. Le `?debug=0` fait donc partie de la valeur du jeton telle qu'elle arrive
     * dans `req.query`. On compare donc la clé seule ; la sécurité est inchangée (il faut toujours connaître
     * les 128 bits), mais on ne dépend plus d'une convention interne du moteur.
     */
    verifierAcces(cle, jeton) {
      const c = String(cle || '');
      if (!/^[0-9a-f]{32}$/.test(c)) return { ok: false, motif: 'cle_invalide' };
      if (jeton !== undefined) {
        const fourni = String(jeton || '').split(/[?&#]/)[0];
        if (fourni !== c) return { ok: false, motif: 'jeton_invalide' };
      }
      return { ok: true };
    },

    /** `nonce` de session d'édition : l'identifiant de session Collabora n'a pas à être devinable non plus. */
    nouveauNonce: () => crypto.randomBytes(4).toString('hex'),
  };
}

module.exports = { createBureauCollabora, FORMATS_COLLABORA: FORMATS };
