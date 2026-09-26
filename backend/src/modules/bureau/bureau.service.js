/**
 * Bureau en ligne : éditer une annexe Word / Excel dans le navigateur, sans Word sur le poste (D39).
 *
 * Le principe : le serveur de documents est un conteneur séparé qui édite le document et **nous rappelle** à chaque
 * enregistrement. La mise à jour passe alors par le chemin ordinaire d'une annexe (`remplacerDepuisBureau` → version,
 * historique, PDF régénéré, recherche réindexée) : la traçabilité, le circuit et les droits du dossier ne sont pas
 * contournés, et le dépôt manuel reste disponible si le conteneur est éteint.
 *
 * Le rappel est anonyme (c'est le moteur qui appelle). Il est authentifié par le port (jeton HS256 partagé), et la clé
 * de session remise au moteur fait foi : elle dit quel acte, quelle annexe, quel auteur et quelle version ont été
 * ouverts. Une version qui a bougé entre-temps est refusée plutôt qu'écrasée.
 */
const crypto = require('crypto');
const { E } = require('../../shared/errors');

const DUREE_SESSION_MIN = 30;      // le lien de téléchargement du moteur n'a pas à vivre plus longtemps
const PURGE_JOURS = 7;             // sessions inachevées (onglet fermé sans enregistrer) : on les oublie après une semaine
const MIMES_BUREAU = {             // extension attendue -> mime renvoyé au moteur
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  rtf: 'application/rtf', odt: 'application/vnd.oasis.opendocument.text', txt: 'text/plain',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
};
const extDe = (nom) => String(nom || '').split('.').pop().toLowerCase();

function createBureau({ db, audit, actes, annexes, access, settings, port, config, transitoire, log }) {
  const urlRappel = () => String(config.bureau.urlRappel || '').replace(/\/+$/, '');
  // Enregistrements « forcés » en attente : la commande part vers le moteur, qui rappelle notre route pour livrer le
  // document. La promesse évite de fermer l'éditeur avant que la version existe réellement.
  const attentes = new Map();
  const DELAI_SAUVEGARDE_MS = 20000;

  /** Attend que le rappel du moteur ait enregistré la version demandée. `null` si le moteur ne répond pas à temps. */
  function attendreSauvegarde(cle) {
    return new Promise((resolve) => {
      const minuteur = setTimeout(() => { attentes.delete(cle); resolve(null); }, DELAI_SAUVEGARDE_MS);
      attentes.set(cle, (version) => { clearTimeout(minuteur); attentes.delete(cle); resolve(version); });
    });
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

  const svc = {
    /** Ce que l'interface doit savoir : y a-t-il un bureau, quels formats, et pourquoi pas. */
    async capabilities(ctx, organismeId) {
      const base = { ...(port.capabilities() || { enabled: false, formats: [] }), urlRappel: urlRappel() };
      if (!base.enabled) return { ...base, raison: 'Aucun serveur de documents déployé (conversion assurée par LibreOffice ou Office).' };
      const reglages = await settings.resolve(organismeId);
      if (reglages['bureau.edition_documents']?.value === false) return { ...base, enabled: false, raison: "L'édition en ligne est désactivée pour cet organisme." };
      return base;
    },

    /**
     * Ouvre une annexe dans le navigateur. Le droit est celui du dépôt (`canAttach`) : même circuit, mêmes étapes, même
     * journal ; une annexe figée (acte transmis, signé) n'est donc pas éditable. Le PDF n'est jamais éditable : on n'a
     * pas de source à re-sauvegarder, et le circuit de l'acte l'est par construction.
     */
    async ouvrirAnxene(ctx, organismeId, acteId, annexeId, { mobile = false, userAgent = '' } = {}) {
      await purger();
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
        `INSERT INTO bureau_sessions (cle, usage, organisme_id, acte_id, annexe_id, username, kind, version, user_agent, expire_at)
         VALUES ($1,'edition',$2,$3,$4,$5,$6,$7,$8, now() + ($9 || ' minutes')::interval) RETURNING *`,
        [cle, a.organisme_id, a.id, x.id, ctx.username, ctx.kind || 'ad', x.version, String(userAgent || '').slice(0, 300), DUREE_SESSION_MIN]);
      const ouvert = port.open({
        cle, nom: x.original_name, mime: x.mime,
        url: `${urlRappel()}/api/v1/public/bureau/fichier/${cle}`,
        user: { id: ctx.username, username: ctx.username, name: ctx.displayName || ctx.username },
        mobile,
      });
      if (!ouvert) { await db.run('DELETE FROM bureau_sessions WHERE id = $1', [session.id]); throw E.incomplete('Le serveur de documents ne peut pas ouvrir ce format'); }
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'bureau.ouvrir', entity: 'annexes', entityId: x.id, after: { version: x.version, format: ext } });
      return { ...ouvert, cle, version: x.version, nom: x.titre };
    },

    /**
     * « Sauvegarder et fermer » : demande au moteur d'enregistrer la session tout de suite et attend que le document soit
     * réellement revenu (le moteur rappelle notre route de sauvegarde). La commande part du serveur : fermer l'onglet
     * ensuite n'annule rien, contrairement à un ordre envoyé par la page.
     */
    async enregistrer(ctx, organismeId, acteId, annexeId, cle) {
      const s = await db.get(
        `SELECT * FROM bureau_sessions WHERE cle = $1 AND usage = 'edition' AND organisme_id = $2 AND acte_id = $3
           AND annexe_id = $4 AND username = $5 AND expire_at > now()`,
        [String(cle || ''), organismeId, acteId, annexeId, ctx.username]);
      if (!s) throw E.notFound('Session d’édition introuvable ou expirée');
      const attente = attendreSauvegarde(s.cle);
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
      const version = await attente;
      if (!version) {
        // Le moteur n'a rien renvoyé dans le délai : l'agent ne doit pas rester bloqué, on lui rend la main.
        log?.warn?.({ annexeId: s.annexe_id }, 'sauvegarde forcée sans réponse du moteur');
        return { enregistre: false, raison: 'Le serveur de documents n’a pas confirmé l’enregistrement.' };
      }
      return { enregistre: true, version };
    },

    /** Fichier source d'une session d'édition : c'est le moteur qui le demande, avec l'adresse opaque de la session. */
    async fichierDeSession(cle) {
      const s = await db.get(`SELECT * FROM bureau_sessions WHERE cle = $1 AND usage = 'edition' AND expire_at > now()`, [String(cle || '')]);
      if (!s) throw E.notFound('Session introuvable ou expirée');
      const f = await annexes.contenuParId(s.annexe_id);
      return f;
    },

    /**
     * Rappel du moteur. Répond `{"error": 0}` (accepté, rien à faire) ou `{"error": 1}` (refusé) — c'est le contrat du
     * moteur : en cas de refus il réessaie, on préfère donc un refus explicite quand la version a changé.
     */
    async rappel(req) {
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
      const nom = await nomDepuis(s.annexe_id, relu.ext);
      // Le rappel est anonyme, mais la SESSION applicative de l'auteur, elle, existe encore : on la relit pour lui
      // réappliquer exactement le contrôle d'un dépôt manuel (droits, étape du circuit, gel après transmission). Si
      // l'agent a été révoqué entre-temps, l'écriture est refusée.
      let sortie;
      try {
        const auteur = await access.loadContext(s.username, s.kind || 'ad');
        sortie = await annexes.remplacerDepuisBureau({
          organismeId: s.organisme_id, acteId: s.acte_id, annexeId: s.annexe_id, ctx: auteur,
          username: s.username, versionAttendue: s.version,
          buffer: relu.buffer, nom: nom.nom,
          sha256: crypto.createHash('sha256').update(relu.buffer).digest('hex'),
        });
      } catch (e) {
        sortie = { refuse: e?.code === 403 ? 'droit' : 'erreur' };
        log?.warn?.({ annexeId: s.annexe_id, code: e?.code }, 'rappel du moteur refusé');
      }
      if (sortie.refuse) {
        await audit.log({ username: s.username }, { organismeId: s.organisme_id, action: `bureau.refuse.${sortie.refuse}`, entity: 'annexes', entityId: s.annexe_id, after: { versionOuverte: s.version } });
        log?.warn?.({ annexeId: s.annexe_id, ...sortie }, 'enregistrement du bureau refusé');
        // Le contenu est déjà parti : on n'insiste pas, sinon OnlyOffice réémet en boucle.
        await cloreSession(s, sortie.version || s.version);
        return { error: 1 };
      }
      await cloreSession(s, sortie.version);
      log?.info?.({ annexeId: s.annexe_id, version: sortie.version }, 'annexe enregistrée depuis le bureau en ligne');
      const attente = attentes.get(s.cle);      // une demande « Sauvegarder et fermer » attend peut-être cette version
      if (attente) attente(sortie.version);
      return { error: 0 };
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
  };

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
