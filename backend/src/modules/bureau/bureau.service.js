/**
 * Bureau en ligne : éditer une annexe Word / Excel / présentation dans le navigateur, sans Word sur le poste (D39).
 *
 * Le principe : le serveur de documents est un service séparé qui édite le document et nous le **rapporte** à chaque
 * enregistrement. La mise à jour passe alors par le chemin ordinaire d'une annexe (`remplacerDepuisBureau` → version,
 * historique, PDF régénéré, recherche réindexée) : la traçabilité, le circuit et les droits du dossier ne sont pas
 * contournés, et le dépôt manuel reste disponible si le service est éteint.
 *
 * Deux moteurs sont branchés, et l'administrateur choisit lequel ouvre les documents, organisme par organisme :
 *   - ONLYOFFICE Docs (`bureau-onlyoffice.js`) : SDK JavaScript dans la page, rappel HTTP à chaque enregistrement ;
 *   - Collabora Online (`bureau-collabora.js`) : iframe, protocole WOPI — le moteur tire le document et le rapporte.
 * Les deux écrivent par `enregistrerDepuisMoteur` : même version, même PDF, même audit, mêmes droits.
 *
 * Le rappel est anonyme (c'est le moteur qui appelle). Il est authentifié par le port (jeton HS256 partagé, ou clé de
 * session elle-même pour WOPI), et la clé de session remise au moteur fait foi : elle dit quel acte, quelle annexe,
 * quel auteur et quelle version ont été ouverts. Une version qui a bougé entre-temps est refusée plutôt qu'écrasée.
 */
const crypto = require('crypto');
const { E } = require('../../shared/errors');
const { markdownVersDocx } = require('../render/docx.service');

const DUREE_SESSION_MIN = 30;      // le lien de téléchargement du moteur n'a pas à vivre plus longtemps
const PURGE_JOURS = 7;             // sessions inachevées (onglet fermé sans enregistrer) : on les oublie après une semaine
const DELAI_FERMETURE_MS = 12000; // Collabora écrit en fin de session : on attend sa venue avant de répondre
const MOTEURS = ['onlyoffice', 'collabora', 'simulateur'];
// Libellé d'un texte suivi, pour nommer le document Word remis au moteur (exposé, « Vu et considérant », délibéré).
const NOMS_TEXTE = { expose: 'Exposé des motifs', visas: 'Vu et considérant', dispositif: 'Délibéré' };
const nomFichierTexte = (t) => `${NOMS_TEXTE[t.kind] || 'Texte'}.docx`;
const MIMES_BUREAU = {             // extension attendue -> mime renvoyé au moteur
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  rtf: 'application/rtf', odt: 'application/vnd.oasis.opendocument.text', txt: 'text/plain',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
};
const extDe = (nom) => String(nom || '').split('.').pop().toLowerCase();

function createBureau({ db, audit, actes, annexes, access, settings, ports, config, transitoire, log, late }) {
  const urlRappel = () => String(config.bureau.urlRappel || '').replace(/\/+$/, '');
  // Enregistrements « forcés » en attente : la commande part vers le moteur, qui rappelle notre route pour livrer le
  // document. La promesse évite de fermer l'éditeur avant que la version existe réellement.
  const attentes = new Map();
  const DELAI_SAUVEGARDE_MS = 20000;

  /** Attend que le rappel du moteur ait enregistré la version demandée. `null` si le moteur ne répond pas à temps. */
  function attendreSauvegarde(cle, delaiMs = DELAI_SAUVEGARDE_MS) {
    return new Promise((resolve) => {
      const minuteur = setTimeout(() => { attentes.delete(cle); resolve(null); }, delaiMs);
      attentes.set(cle, (version) => { clearTimeout(minuteur); attentes.delete(cle); resolve(version); });
    });
  }

  /**
   * Moteur d'un organisme : le réglage `bureau.moteur` (choix de l'administrateur, portée organisme) s'il est connu et
   * déployé, sinon le moteur général du `.env`. Un moteur non déployé n'est jamais proposé : le service est alors
   * silently absent de la table, et l'on retombe sur le choix général.
   */
  async function portPour(organismeId) {
    const table = ports || {};
    const general = table[config.bureau.moteur] || table.simulateur;
    const nom = (await settings.resolve(organismeId))['bureau.moteur']?.value;
    if (nom && MOTEURS.includes(nom) && nom !== 'simulateur' && table[nom]) return table[nom];
    return general;
  }

  /** Purge des sessions inachevées : appelée à chaque ouverture, donc jamais de tâche planifiée à écrire. */
  async function purger() {
    await db.run(`DELETE FROM bureau_sessions WHERE ouverte_at < now() - ($1 || ' days')::interval`, [PURGE_JOURS]);
  }

  /**
   * Une écriture de plus dans le même onglet. `version` devient la version attendue pour le Ctrl+S suivant : OnlyOffice
   * émet un rappel à chaque sauvegarde, pas seulement à la fermeture. En cas de refus, on ne décale pas la version
   * attendue : le conflit reste donc visible, et l'agent doit rouvrir le document.
   */
  async function cloreSession(s, version) {
    await db.run('UPDATE bureau_sessions SET consomme_at = COALESCE(consomme_at, now()), version = $2 WHERE id = $1', [s.id, version]);
  }

  /**
   * « Sauvegarder et fermer » — le corps commun aux annexes et aux textes : la seule différence est la session visée.
   * Le sens de l'opération dépend du moteur (voir `enregistrer`) ; cette fonction ne fait qu'attendre la version.
   */
  async function fermerSession(s, port) {
    const attente = attendreSauvegarde(s.cle, port.moteur === 'collabora' ? DELAI_FERMETURE_MS : DELAI_SAUVEGARDE_MS);
    const demande = await port.forcerSauvegarde(s.cle);
    if (!demande?.ok) { attentes.delete(s.cle); return { enregistre: false, raison: 'Le serveur de documents n’a pas accepté la sauvegarde.' }; }
    // « Aucune modification à enregistrer » : le document est déjà à jour côté moteur. On laisse toutefois une courte
    // grâce à un enregistrement déjà lancé par l'éditeur (l'agent clique pendant que le navigateur envoie encore ses
    // dernières frappes) : s'il arrive, c'est cette version-là qui compte.
    if (demande.inchange) {
      const tard = await Promise.race([attente, new Promise((r) => setTimeout(() => r(null), 3000))]);
      attentes.delete(s.cle);
      return tard ? { enregistre: true, version: tard } : { enregistre: true, version: s.version, inchange: true };
    }
    // Fin de session (Collabora) : l'écriture peut ne pas venir du tout — rien n'avait été modifié depuis le dernier
    // enregistrement automatique. C'est une bonne nouvelle, pas un échec : on le dit explicitement.
    if (demande.fermeture) {
      const version = await attente;
      if (version) return { enregistre: true, version };
      const courant = await db.get('SELECT version FROM bureau_sessions WHERE cle = $1', [s.cle]);
      return { enregistre: true, version: courant?.version || s.version, inchange: true };
    }
    const version = await attente;
    if (!version) {
      // Le moteur n'a rien renvoyé dans le délai : l'agent ne doit pas rester bloqué, on lui rend la main.
      log?.warn?.({ session: s.id }, 'sauvegarde forcée sans réponse du moteur');
      return { enregistre: false, raison: 'Le serveur de documents n’a pas confirmé l’enregistrement.' };
    }
    return { enregistre: true, version };
  }

  /** Le document Word d'un texte suivi, à partir de son markdown. Mis en cache le temps de la session (CheckFileInfo puis GetFile). */
  const cacheTexte = new Map();
  async function docxDuTexte(s) {
    const t = await db.get('SELECT * FROM tracked_texts WHERE id = $1 AND acte_id = $2', [s.texte_id, s.acte_id]);
    if (!t) throw E.notFound('Texte introuvable');
    const enCache = cacheTexte.get(s.cle);
    if (enCache && enCache.version === t.version_no) return { buffer: enCache.buffer, t };
    // Texte déjà rédigé dans le bureau : on rouvre LE document enregistré (polices, tailles, styles conservés).
    // Sinon (première ouverture), on fabrique un Word à partir du markdown.
    const enregistre = await late.texts.bureauDocBytes(t);
    const buffer = enregistre ? enregistre.buffer : await markdownVersDocx(t.markdown);
    if (cacheTexte.size > 200) cacheTexte.clear();
    cacheTexte.set(s.cle, { version: t.version_no, buffer });
    return { buffer, t };
  }

  const svc = {
    /**
     * Conversion Word/Excel/PowerPoint → PDF via le moteur d'édition déjà déployé (ONLYOFFICE/Collabora), pour tout
     * appelant qui a juste besoin d'un PDF (gabarits `render.service.js`) — pas d'édition, pas de session, pas de
     * traçabilité d'annexe. `null` si aucun VRAI moteur n'est configuré pour cet organisme (jamais le simulateur : il
     * ne rend pas le document demandé, seulement un PDF de test) ; l'appelant se replie alors sur
     * `shared/convert.js` (LibreOffice / Microsoft Office).
     */
    async versPdf(organismeId, buffer, ext) {
      const port = await portPour(organismeId);
      const moteur = port?.capabilities?.()?.moteur;
      if (!port?.versPdf || moteur === 'fake' || moteur === 'simulateur') return null;
      return port.versPdf({ buffer, ext });
    },

    /** Ce que l'interface doit savoir : y a-t-il un bureau, quels formats, lequel, et pourquoi pas. */
    async capabilities(ctx, organismeId) {
      const port = await portPour(organismeId);
      const base = { ...(port.capabilities() || { enabled: false, formats: [] }), urlRappel: urlRappel() };
      // Les moteurs réellement déployés : c'est cette liste que l'administration propose par organisme.
      const table = ports || {};
      const deployes = Object.keys(table).filter((nom) => nom !== 'simulateur' && table[nom]?.capabilities?.().enabled);
      if (!base.enabled) return { ...base, moteurs: deployes, raison: 'Aucun serveur de documents déployé (conversion assurée par LibreOffice ou Office).' };
      const reglages = await settings.resolve(organismeId);
      if (reglages['bureau.edition_documents']?.value === false) {
        return { ...base, moteurs: deployes, enabled: false, raison: "L'édition en ligne est désactivée pour cet organisme." };
      }
      return { ...base, moteurs: deployes };
    },

    /**
     * Ouvre une annexe dans le navigateur. Le droit est celui du dépôt (`canAttach`) : même circuit, mêmes étapes, même
     * journal ; une annexe figée (acte transmis, signé) n'est donc pas éditable. Le PDF n'est jamais éditable : on n'a
     * pas de source à re-sauvegarder, et le circuit de l'acte l'est par construction.
     */
    async ouvrirAnxene(ctx, organismeId, acteId, annexeId, { mobile = false, userAgent = '' } = {}) {
      await purger();
      const port = await portPour(organismeId);
      // Le réglage d'organisme est appliqué ici aussi, pas seulement dans l'interface : un client qui appelle l'API
      // directement doit obtenir la même réponse que s'il cliquait sur le bouton.
      const capa = await svc.capabilities(ctx, organismeId);
      if (!capa.enabled) throw E.incomplete(capa.raison || 'Édition en ligne indisponible');
      const a = await actes.load(ctx, organismeId, acteId, { attach: true });
      const x = await db.get('SELECT x.id, x.version, x.titre, f.original_name, f.mime FROM annexes x JOIN files f ON f.id = x.file_id WHERE x.id = $1 AND x.acte_id = $2', [annexeId, a.id]);
      if (!x) throw E.notFound('Annexe introuvable');
      const ext = extDe(x.original_name);
      const formats = capa.formats || [];
      if (MIMES_BUREAU[ext] === undefined) throw E.badRequest(`Format non éditable en ligne (${ext.toUpperCase()})`);
      if (x.mime === 'application/pdf') throw E.badRequest('Un PDF n’a pas de source à rééditer');
      if (!formats.includes(ext)) throw E.badRequest(`Le serveur de documents n’accepte pas le format .${ext}`);
      const cle = crypto.randomBytes(16).toString('hex');
      const session = await db.get(
        `INSERT INTO bureau_sessions (cle, usage, organisme_id, acte_id, annexe_id, username, kind, version, user_agent, moteur, expire_at)
         VALUES ($1,'edition',$2,$3,$4,$5,$6,$7,$8,$9, now() + ($10 || ' minutes')::interval) RETURNING *`,
        [cle, a.organisme_id, a.id, x.id, ctx.username, ctx.kind || 'ad', x.version, String(userAgent || '').slice(0, 300), port.moteur || config.bureau.moteur, DUREE_SESSION_MIN]);
      const ouvert = port.open({
        cle, nom: x.original_name, mime: x.mime, urlRappel: urlRappel(),
        url: `${urlRappel()}/api/v1/public/bureau/fichier/${cle}`,
        user: { id: ctx.username, username: ctx.username, name: ctx.displayName || ctx.username },
        mobile,
      });
      if (!ouvert) { await db.run('DELETE FROM bureau_sessions WHERE id = $1', [session.id]); throw E.incomplete('Le serveur de documents ne peut pas ouvrir ce format'); }
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'bureau.ouvrir', entity: 'annexes', entityId: x.id, after: { version: x.version, format: ext, moteur: port.moteur } });
      return { ...ouvert, cle, version: x.version, nom: x.titre, moteur: port.moteur };
    },

    /**
     * Ouvre un texte suivi (exposé, « Vu et considérant », délibéré) dans le bureau en ligne. Le serveur de documents
     * reçoit un Word fabriqué à partir du markdown ; l'enregistrement rapporté est reconverti et enregistré par le
     * chemin ordinaire des textes. Le droit est celui de la rédaction (`edit: true`), donc le gel après transmission
     * s'applique comme pour une annexe.
     */
    async ouvrirTexte(ctx, organismeId, acteId, textId, { mobile = false, userAgent = '' } = {}) {
      await purger();
      const capa = await svc.capabilities(ctx, organismeId);
      if (!capa.enabled) throw E.incomplete(capa.raison || 'Édition en ligne indisponible');
      const port = await portPour(organismeId);
      const a = await actes.load(ctx, organismeId, acteId, { edit: true });
      const t = await db.get('SELECT * FROM tracked_texts WHERE id = $1 AND acte_id = $2', [textId, a.id]);
      if (!t) throw E.notFound('Texte introuvable');
      if (t.lock_user && t.lock_user !== ctx.username && new Date(t.lock_until) > new Date())
        throw E.conflict(`Texte en cours de modification par ${t.lock_user}`);
      const nom = nomFichierTexte(t);
      const cle = crypto.randomBytes(16).toString('hex');
      const session = await db.get(
        `INSERT INTO bureau_sessions (cle, usage, organisme_id, acte_id, annexe_id, texte_id, username, kind, version, user_agent, moteur, expire_at)
         VALUES ($1,'edition',$2,$3,NULL,$4,$5,$6,$7,$8,$9, now() + ($10 || ' minutes')::interval) RETURNING *`,
        [cle, a.organisme_id, a.id, t.id, ctx.username, ctx.kind || 'ad', t.version_no, String(userAgent || '').slice(0, 300), port.moteur || config.bureau.moteur, DUREE_SESSION_MIN]);
      const ouvert = port.open({
        cle, nom, mime: MIMES_BUREAU.docx, urlRappel: urlRappel(),
        url: `${urlRappel()}/api/v1/public/bureau/fichier/${cle}`,
        user: { id: ctx.username, username: ctx.username, name: ctx.displayName || ctx.username },
        mobile,
      });
      if (!ouvert) { await db.run('DELETE FROM bureau_sessions WHERE id = $1', [session.id]); throw E.incomplete('Le serveur de documents ne peut pas ouvrir ce format'); }
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'bureau.ouvrir_texte', entity: 'tracked_texts', entityId: t.id, after: { version: t.version_no, kind: t.kind, moteur: port.moteur } });
      return { ...ouvert, cle, version: t.version_no, nom, moteur: port.moteur };
    },

    /**
     * « Sauvegarder et fermer ». Le sens de l'opération dépend du moteur :
     *   - ONLYOFFICE : on lui ordonne d'enregistrer maintenant (POST /command) et on attend la version ;
     *   - Collabora : la commande n'existe pas. L'interface a déjà retiré l'iframe, ce qui termine la session : le
     *     moteur écrit alors le document chez nous. On attend donc cette écriture, et à défaut on répond qu'il n'y avait
     *     rien à enregistrer (l'agent avait déjà enregistré, ou n'avait rien modifié).
     */
    async enregistrer(ctx, organismeId, acteId, annexeId, cle) {
      const s = await db.get(
        `SELECT * FROM bureau_sessions WHERE cle = $1 AND usage = 'edition' AND organisme_id = $2 AND acte_id = $3
           AND annexe_id = $4 AND username = $5 AND expire_at > now()`,
        [String(cle || ''), organismeId, acteId, annexeId, ctx.username]);
      if (!s) throw E.notFound('Session d’édition introuvable ou expirée');
      return fermerSession(s, await portPour(organismeId));
    },

    /** Même « Sauvegarder et fermer », pour la session d'édition d'un texte suivi. */
    async enregistrerTexte(ctx, organismeId, acteId, textId, cle) {
      const s = await db.get(
        `SELECT * FROM bureau_sessions WHERE cle = $1 AND usage = 'edition' AND organisme_id = $2 AND acte_id = $3
           AND texte_id = $4 AND username = $5 AND expire_at > now()`,
        [String(cle || ''), organismeId, acteId, textId, ctx.username]);
      if (!s) throw E.notFound('Session d’édition introuvable ou expirée');
      return fermerSession(s, await portPour(organismeId));
    },

    /** Fichier source d'une session d'édition : c'est le moteur qui le demande, avec l'adresse opaque de la session. */
    async fichierDeSession(cle) {
      const s = await db.get(`SELECT * FROM bureau_sessions WHERE cle = $1 AND usage = 'edition' AND expire_at > now()`, [String(cle || '')]);
      if (!s) throw E.notFound('Session introuvable ou expirée');
      if (s.texte_id) {
        const { buffer, t } = await docxDuTexte(s);
        return { buffer, name: nomFichierTexte(t), mime: MIMES_BUREAU.docx };
      }
      const f = await annexes.contenuParId(s.annexe_id);
      return f;
    },

    /**
     * Rappel du moteur. Répond `{"error": 0}` (accepté, rien à faire) ou `{"error": 1}` (refusé) — c'est le contrat du
     * moteur : en cas de refus il réessaie, on préfère donc un refus explicite quand la version a changé.
     */
    async rappel(req) {
      const port = ports?.onlyoffice;
      if (!port) { log?.warn?.({}, 'rappel reçu alors qu’aucun moteur ONLYOFFICE n’est déployé'); return { error: 1 }; }
      const verif = port.verifyCallback(req);
      if (!verif.ok) { log?.warn?.({ code: verif.code }, 'rappel du moteur refusé'); return { error: 1 }; }
      const p = verif.payload;
      const s = await db.get(`SELECT * FROM bureau_sessions WHERE cle = $1 AND usage = 'edition'`, [String(p.key || '')]);
      if (!s) { log?.warn?.({}, 'rappel du moteur : clé inconnue'); return { error: 1 }; }
      const statut = Number(p.status);
      if (statut !== 2 && statut !== 6) {                       // 1 : en cours d'édition, 4 : fermé sans changement
        if (statut === 3 || statut === 7) log?.warn?.({ statut }, 'le moteur signale une erreur de sauvegarde');
        return { error: 0 };
      }
      const relu = await port.readBack({ url: p.url, filetype: p.filetype, jeton: verif.jeton });
      if (!relu) { log?.warn?.({}, 'rappel du moteur : document illisible'); return { error: 1 }; }
      const ecrit = await svc.enregistrerDepuisMoteur(s, relu.buffer, relu.ext);
      if (ecrit.refuse) {
        // Le contenu est déjà parti : on n'insiste pas, sinon le moteur réémet en boucle.
        await cloreSession(s, ecrit.version || s.version);
        return { error: 1 };
      }
      return { error: 0 };
    },

    /**
     * Écriture d'une version rapportée par le moteur — le chemin UNIQUE, quel que soit le moteur (rappel ONLYOFFICE,
     * PutFile Collabora). Le rappel est anonyme, mais la SESSION applicative de l'auteur existe encore : on la relit pour
     * lui réappliquer exactement le contrôle d'un dépôt manuel (droits, étape du circuit, gel après transmission). Si
     * l'agent a été révoqué entre-temps, l'écriture est refusée.
     */
    async enregistrerDepuisMoteur(s, buffer, ext) {
      if (s.texte_id) return enregistrerTexteDepuisMoteur(s, buffer);
      const nom = await nomDepuis(s.annexe_id, ext);
      let sortie;
      try {
        const auteur = await access.loadContext(s.username, s.kind || 'ad');
        sortie = await annexes.remplacerDepuisBureau({
          organismeId: s.organisme_id, acteId: s.acte_id, annexeId: s.annexe_id, ctx: auteur,
          username: s.username, versionAttendue: s.version,
          buffer, nom: nom.nom,
          sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        });
      } catch (e) {
        sortie = { refuse: e?.code === 403 ? 'droit' : 'erreur' };
        log?.warn?.({ annexeId: s.annexe_id, code: e?.code }, 'enregistrement du moteur refusé');
      }
      if (sortie.refuse) {
        await audit.log({ username: s.username }, { organismeId: s.organisme_id, action: `bureau.refuse.${sortie.refuse}`, entity: 'annexes', entityId: s.annexe_id, after: { versionOuverte: s.version } });
        log?.warn?.({ annexeId: s.annexe_id, ...sortie }, 'enregistrement du bureau refusé');
        return sortie;
      }
      await cloreSession(s, sortie.version);
      log?.info?.({ annexeId: s.annexe_id, version: sortie.version, moteur: s.moteur }, 'annexe enregistrée depuis le bureau en ligne');
      const attente = attentes.get(s.cle);      // une demande « Sauvegarder et fermer » attend peut-être cette version
      if (attente) attente(sortie.version);
      return sortie;
    },

    /** Adresse servie au moteur pour un contenu transitoire (conversion PDF) : à usage unique. */
    async publierSource(buffer, { nom, mime }) {
      const { jeton } = transitoire.mettre(buffer, { nom, mime });
      return { url: `${urlRappel()}/api/v1/public/bureau/source/${jeton}` };
    },

    async source(cle) {
      const c = transitoire.prendre(cle);
      if (!c) throw E.notFound('Contenu introuvable ou expiré');
      return c;
    },

    // ---- hôte WOPI (Collabora) : le moteur vient chercher le document, puis le rapporte.

    /**
     * Session visée par un appel WOPI. La colonne `moteur` est ce qui autorise Collabora à agir : une clé d'une session
     * ouverte par un autre moteur (ou une clé devinée) ne trouve rien à servir.
     */
    async sessionWopi(cle) {
      return db.get(
        `SELECT * FROM bureau_sessions WHERE cle = $1 AND usage = 'edition' AND moteur = 'collabora' AND expire_at > now()`,
        [String(cle || '')]);
    },

    /**
     * CheckFileInfo : l'identité du document et les capacités. `PostMessageOrigin` est l'origine de notre fenêtre —
     * c'est elle qui autorise l'éditeur à communiquer avec l'interface (« mode intégré »). `Version` suit la version de
     * l'annexe : Collabora s'en sert pour savoir que le document a changé depuis son dernier chargement.
     */
    async infoWopi(s) {
      if (s.texte_id) {
        const { buffer, t } = await docxDuTexte(s);
        const info = {
          BaseFileName: nomFichierTexte(t),
          Size: buffer.length,
          Version: `${t.version_no}.0`,
          UserId: s.username, UserFriendlyName: s.username, OwnerId: s.username,
          UserCanWrite: true, UserCanNotWriteRelative: true,
          SupportsUpdate: true, SupportsLocks: true, SupportsGetLock: true, SupportsExtendedLockLength: true,
          SupportsRename: false, SupportsCoauth: false, IsAnonymousUser: false, LicenseCheckForEditIsEnabled: false,
          LastModifiedTime: new Date(t.updated_at || Date.now()).toUTCString(),
          BreadcrumbBrandName: 'VibeDélib', BreadcrumbDocName: nomFichierTexte(t), BreadcrumbFolderName: '',
        };
        if (config.publicBaseUrl) info.PostMessageOrigin = new URL(config.publicBaseUrl).origin;
        return info;
      }
      const x = await db.get(
        `SELECT x.version, x.titre, f.original_name, f.size, f.created_at FROM annexes x JOIN files f ON f.id = x.file_id WHERE x.id = $1`,
        [s.annexe_id]);
      if (!x) throw E.notFound('Annexe introuvable');
      const info = {
        BaseFileName: x.original_name,
        Size: Number(x.size || 0),
        Version: `${x.version}.0`,
        UserId: s.username,
        UserFriendlyName: s.username,
        OwnerId: s.username,
        UserCanWrite: true,
        UserCanNotWriteRelative: true,
        SupportsUpdate: true,
        SupportsLocks: true,
        SupportsGetLock: true,
        SupportsExtendedLockLength: true,
        SupportsRename: false,
        SupportsCoauth: false,
        IsAnonymousUser: false,
        LicenseCheckForEditIsEnabled: false,
        LastModifiedTime: new Date(x.created_at || Date.now()).toUTCString(),
        BreadcrumbBrandName: 'VibeDélib',
        BreadcrumbDocName: x.titre || x.original_name,
        BreadcrumbFolderName: '',
      };
      if (config.publicBaseUrl) info.PostMessageOrigin = new URL(config.publicBaseUrl).origin;
      return info;
    },

    /** GetFile : le document à éditer, tel qu'il est dans le dossier. */
    async fichierWopi(s) {
      if (s.texte_id) {
        const { buffer, t } = await docxDuTexte(s);
        return { buffer, name: nomFichierTexte(t), mime: MIMES_BUREAU.docx };
      }
      const f = await annexes.contenuParId(s.annexe_id);
      return { buffer: f.buffer, name: f.name, mime: f.mime };
    },

    /** PutFile : Collabora garde l'extension qu'il a reçue (pas de « enregistrer sous »), on relit donc le nom courant. */
    async enregistrerDepuisMoteurWopi(s, buffer) {
      if (s.texte_id) return svc.enregistrerDepuisMoteur(s, buffer, 'docx');
      const x = await db.get('SELECT f.original_name FROM annexes a JOIN files f ON f.id = a.file_id WHERE a.id = $1', [s.annexe_id]);
      return svc.enregistrerDepuisMoteur(s, buffer, extDe(x?.original_name));
    },
  };

  /**
   * Écriture d'un texte suivi rapporté par le moteur : le .docx est reconverti en markdown, puis enregistré par le
   * chemin ordinaire des textes (version, suivi des modifications, audit). La version ouverte fait foi : si le texte a
   * changé entre-temps (édition interne, autre session), l'écriture est refusée plutôt qu'écrasée — comme pour une annexe.
   */
  async function enregistrerTexteDepuisMoteur(s, buffer) {
    try {
      const auteur = await access.loadContext(s.username, s.kind || 'ad');
      // Le .docx rapporté devient la source : polices, tailles et styles conservés (le markdown n'est qu'un secours).
      const r = await late.texts.commitBureau(auteur, s.organisme_id, s.acte_id, s.texte_id, { buffer, baseVersion: s.version });
      await cloreSession(s, r.version);
      log?.info?.({ textId: s.texte_id, version: r.version, moteur: s.moteur }, 'texte enregistré depuis le bureau en ligne');
      const attente = attentes.get(s.cle);      // une demande « Sauvegarder et fermer » attend peut-être cette version
      if (attente) attente(r.version);
      return { version: r.version, changed: r.changed };
    } catch (e) {
      const motif = e?.code === 403 ? 'droit' : e?.code === 409 ? 'conflit' : 'erreur';
      await audit.log({ username: s.username }, { organismeId: s.organisme_id, action: `bureau.refuse.${motif}`, entity: 'tracked_texts', entityId: s.texte_id, after: { versionOuverte: s.version } });
      log?.warn?.({ textId: s.texte_id, code: e?.code }, 'enregistrement du texte depuis le bureau refusé');
      return { refuse: motif };
    }
  }

  /** Le nom de fichier garde son identité : même nom, nouvelle version (ANN-04) ; l'extension suit ce que le moteur renvoie. */
  async function nomDepuis(annexeId, ext) {
    const x = await db.get('SELECT f.original_name FROM annexes a JOIN files f ON f.id = a.file_id WHERE a.id = $1', [annexeId]);
    const base = String(x?.original_name || 'annexe').replace(/\.[^.]+$/, '');
    const e = String(ext || '').toLowerCase() || 'docx';
    return { nom: `${base}.${e}`, mime: MIMES_BUREAU[e] || 'application/octet-stream' };
  }

  return svc;
}

module.exports = { createBureau, MIMES_BUREAU };
