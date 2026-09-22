/**
 * Parapheur (section 7c) : signature du maire pour les actes qui n'ont pas à passer au conseil (décisions, arrêtés).
 *
 * À la fin du circuit d'un acte dont le TYPE porte `signature: true`, le dossier passe à l'état « À signer » et le
 * document part au parapheur choisi par l'organisme (DSIHUB par défaut ; iParapheur prévu, non implémenté). Le circuit
 * reste inchangé : seule la fin diffère (au lieu de l'inscription au conseil).
 *
 *   - `mode` « dev » : tous les envois vont vers une adresse d'essai unique (`email_test`) ;
 *   - `mode` « prod » : l'envoi va au signataire paramétré (nom + e-mail).
 *
 * TOUT échange avec le parapheur est journalisé (ce qui est envoyé, ce qui revient) et consultable depuis la fiche du
 * dossier et l'administration. Le mot de passe du compte technique est chiffré au repos et jamais renvoyé par l'API.
 */
const { createSecretBox } = require('../../shared/secretbox');
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const INDISPONIBLE = 'Le parapheur iParapheur n’est pas encore disponible : choisissez le parapheur DSIHUB.';

function createParapheur({ db, audit, actes, render, bus, config, log, adapters, acl }) {
  const box = createSecretBox(config.jwt.secret, 'parapheur');
  const { chiffre, dechiffre } = box;
  const SYS = (org) => ({ username: 'parapheur', kind: 'system', isPlatformAdmin: true, organismes: [], orgIds: [org], roles: ['org_admin'], agent: null, displayName: 'Parapheur' });

  const row = async (org) => db.get('SELECT * FROM parapheur_config WHERE organisme_id = $1', [org]);
  const cfgOf = async (org) => {
    const r = await row(org);
    return {
      organismeId: org, fournisseur: r?.fournisseur || 'dsihub', actif: r ? !!r.actif : true, mode: r?.mode || 'dev',
      url: r?.url || '', utilisateur: r?.utilisateur || '', secret: r?.secret_chiffre ? dechiffre(r.secret_chiffre) : '',
      email_test: r?.email_test || '', signataire_nom: r?.signataire_nom || '', signataire_email: r?.signataire_email || '', signataire_qualite: r?.signataire_qualite || '',
      signature_mode: r?.signature_mode || 'securise', signataire_telephone: r?.signataire_telephone || '',
    };
  };
  const view = (cfg) => ({
    fournisseur: cfg.fournisseur, actif: cfg.actif, mode: cfg.mode, url: cfg.url, utilisateur: cfg.utilisateur, secretDefini: !!cfg.secret,
    email_test: cfg.email_test, signataire_nom: cfg.signataire_nom, signataire_email: cfg.signataire_email, signataire_qualite: cfg.signataire_qualite,
    signature_mode: cfg.signature_mode, signataire_telephone: cfg.signataire_telephone,
    modes_signature: [
      { code: 'securise', nom: 'Signature P12 (certificat)', description: 'Le signataire appose un certificat personnel (P12) : c’est le mode le plus fort, celui qui est proposé par défaut.', defaut: true },
      { code: 'simple', nom: 'Signature manuscrite (simple)', description: 'Le signataire appose sa signature manuscrite mémorisée dans le parapheur.' },
      { code: 'sms', nom: 'Signature par SMS', description: 'Un code de validation est envoyé par SMS au signataire ; son numéro de portable doit être renseigné.' },
    ],
    fournisseurs: [
      { code: 'dsihub', nom: 'Parapheur DSIHUB', editeur: 'Ville / DSI', description: 'Parapheur interne du Hub DSI (dossier envoyé dans le circuit de signature, liens sécurisés pour le signataire).', disponible: true, defaut: true },
      { code: 'iparapheur', nom: 'iParapheur', editeur: 'Libriciel', description: 'Parapheur tiers : reprise prévue, non implémentée pour le moment.', disponible: false, defaut: false },
    ],
  });

  /**
   * Le signataire remis au parapheur : adresse d'essai unique en « dev », signataire paramétré en « prod ».
   * `mode` : le mode de signature demandé au parapheur (securise par défaut) ; `telephone` : requis pour le SMS.
   */
  const signataireOf = (cfg) => (cfg.mode === 'dev'
    ? { nom: cfg.signataire_nom || 'Signataire (test)', email: cfg.email_test || null, qualite: cfg.signataire_qualite || null, mode: cfg.signature_mode || 'securise', telephone: cfg.signataire_telephone || null }
    : { nom: cfg.signataire_nom || null, email: cfg.signataire_email || null, qualite: cfg.signataire_qualite || null, mode: cfg.signature_mode || 'securise', telephone: cfg.signataire_telephone || null });

  /** Le contrôle du signataire selon le mode : l'e-mail est toujours requis ; le SMS exige aussi un portable. */
  const verifierSignataire = (cfg, signataire) => {
    if (!signataire.email) throw E.conflict(cfg.mode === 'dev' ? 'Renseignez l’adresse d’essai (mode dev) qui reçoit les documents' : 'Renseignez le signataire (nom et e-mail) dans le paramétrage du parapheur');
    if (signataire.mode === 'sms' && !signataire.telephone) throw E.conflict('La signature par SMS exige le numéro de portable du signataire (Paramétrages / Parapheur)');
  };

  /**
   * Métadonnées du dossier, lisibles dans le parapheur : le Hub DSI n'affiche que le titre et le message du dossier
   * (pas de champs dédiés). On y met donc les références utiles au signataire — direction, rédacteur, rubrique,
   * matière, séance, numéro — sans y porter le texte de l'acte.
   */
  const champsActe = async (a) => {
    const itIds = [a.type_id, a.rubrique_id, a.matiere_id, a.nature_id].filter(Boolean);
    const its = itIds.length ? await db.all('SELECT id, libelle FROM ref_items WHERE id = ANY($1::int[])', [itIds]) : [];
    const lib = (id) => its.find((x) => x.id === id)?.libelle || null;
    const redacteurNom = a.redacteur ? (await db.get('SELECT nom, prenom, display_name FROM agent_ref WHERE username = $1', [a.redacteur])) : null;
    const seance = a.seance_visee_id ? await db.get('SELECT s.date_seance, i.nom AS instance FROM seances s JOIN instances i ON i.id = s.instance_id WHERE s.id = $1', [a.seance_visee_id]) : null;
    return [
      ['Type', lib(a.type_id) || a.type_code || null],
      ['Rubrique', lib(a.rubrique_id)],
      ['Domaine', lib(a.matiere_id)],
      ['Nature', lib(a.nature_id)],
      ['Direction', a.direction_label],
      ['Service', a.service_label],
      ['Rédacteur', redacteurNom ? (`${redacteurNom.prenom ?? ''} ${redacteurNom.nom ?? ''}`).trim() || redacteurNom.display_name : a.redacteur],
      ['Séance', seance ? `${seance.instance} — ${new Date(seance.date_seance).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}` : null],
      ['N° de suivi', a.numero_suivi ? String(a.numero_suivi) : null],
      ['Incidence financière', a.incidence_financiere === true ? `Oui${a.montant ? ` — ${Number(a.montant).toLocaleString('fr-FR')} €` : ''}` : a.incidence_financiere === false ? 'Non' : null],
      ['Dossier', `#${a.numero_suivi}`],
    ].filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');
  };

  /** Message du dossier remis au parapheur : visible par le signataire, il porte les métadonnées de l'acte. */
  const messageActe = async (a, intro) => {
    const lignes = (await champsActe(a)).map(([k, v]) => `${k} : ${v}`);
    return [intro || `Signature demandée pour « ${a.titre} ».`, '', ...lignes].join('\n');
  };

  /** Adaptateur réel seulement si le Hub est configuré ; sinon simulateur (aucun envoi réel). */
  const adapterOf = (cfg) => {
    if (cfg.fournisseur === 'iparapheur') return null;
    if (cfg.fournisseur !== 'dsihub') return null;
    if (cfg.url && cfg.utilisateur && cfg.secret) return adapters.dsihub;
    return adapters.simulateur;
  };

  const j = (org, envoiId, acteId, sens, d = {}) => db.run(
    `INSERT INTO parapheur_journal (organisme_id, envoi_id, acte_id, sens, methode, url, http_status, resume, corps, reponse, erreur)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)`,
    [org, envoiId, acteId, sens, d.methode || null, d.url || null, d.httpStatus ?? null, d.resume || null,
      d.corps ? JSON.stringify(d.corps) : null, d.reponse ? JSON.stringify(d.reponse) : null, d.erreur || null]).catch((e) => log?.warn({ e: e.message }, 'journal parapheur non écrit'));

  const dernierEnvoi = (org, acteId) => db.get('SELECT * FROM parapheur_envois WHERE organisme_id = $1 AND acte_id = $2 ORDER BY id DESC LIMIT 1', [org, acteId]);

  const typeMetaOf = async (typeId) => (await db.get('SELECT code, meta FROM ref_items WHERE id = $1', [typeId])) || {};

  const svc = {
    // ---------------------------------------------------------------------------------------------------- paramétrage
    async config(organismeId) { return view(await cfgOf(requireOrg(organismeId))); },

    async setConfig(ctx, organismeId, b) {
      const org = requireOrg(organismeId); const cur = await cfgOf(org);
      const v = {
        fournisseur: b.fournisseur ?? cur.fournisseur, actif: b.actif ?? cur.actif, mode: b.mode ?? cur.mode,
        url: b.url !== undefined ? String(b.url).trim().replace(/\/+$/, '') : cur.url,
        utilisateur: b.utilisateur !== undefined ? String(b.utilisateur).trim() : cur.utilisateur,
        secret: b.motDePasse ? chiffre(b.motDePasse) : (cur.secret ? chiffre(cur.secret) : null),
        email_test: b.email_test !== undefined ? String(b.email_test).trim() : cur.email_test,
        signataire_nom: b.signataire_nom !== undefined ? String(b.signataire_nom).trim() : cur.signataire_nom,
        signataire_email: b.signataire_email !== undefined ? String(b.signataire_email).trim() : cur.signataire_email,
        signataire_qualite: b.signataire_qualite !== undefined ? String(b.signataire_qualite).trim() : cur.signataire_qualite,
        signature_mode: b.signature_mode ?? cur.signature_mode,
        signataire_telephone: b.signataire_telephone !== undefined ? String(b.signataire_telephone).trim() : cur.signataire_telephone,
      };
      if (v.fournisseur === 'iparapheur') throw E.conflict(INDISPONIBLE);
      if (!['securise', 'simple', 'sms'].includes(v.signature_mode)) throw E.badRequest('Mode de signature inconnu (securise, simple ou sms)');
      if (v.mode === 'dev' && !v.email_test) throw E.badRequest('Renseignez l’adresse d’essai (mode dev) qui reçoit les documents');
      if (v.mode === 'prod' && (!v.signataire_nom || !v.signataire_email)) throw E.badRequest('Renseignez le signataire (nom et e-mail) pour le mode production');
      if (v.signature_mode === 'sms' && !v.signataire_telephone) throw E.badRequest('La signature par SMS exige le numéro de portable du signataire');
      await db.run(
        `INSERT INTO parapheur_config (organisme_id, fournisseur, actif, mode, url, utilisateur, secret_chiffre, email_test, signataire_nom, signataire_email, signataire_qualite, signature_mode, signataire_telephone, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (organisme_id) DO UPDATE SET fournisseur = EXCLUDED.fournisseur, actif = EXCLUDED.actif, mode = EXCLUDED.mode, url = EXCLUDED.url,
           utilisateur = EXCLUDED.utilisateur, secret_chiffre = EXCLUDED.secret_chiffre, email_test = EXCLUDED.email_test, signataire_nom = EXCLUDED.signataire_nom,
           signataire_email = EXCLUDED.signataire_email, signataire_qualite = EXCLUDED.signataire_qualite, signature_mode = EXCLUDED.signature_mode,
           signataire_telephone = EXCLUDED.signataire_telephone, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [org, v.fournisseur, v.actif, v.mode, v.url || null, v.utilisateur || null, v.secret, v.email_test || null, v.signataire_nom || null, v.signataire_email || null, v.signataire_qualite || null, v.signature_mode, v.signataire_telephone || null, ctx.username]);
      await audit.log(ctx, { organismeId: org, action: 'parapheur.config', entity: 'parapheur_config', entityId: org,
        after: { fournisseur: v.fournisseur, actif: v.actif, mode: v.mode, url: v.url, utilisateur: v.utilisateur, signataire: v.signataire_email, signatureMode: v.signature_mode, motDePasseModifie: !!b.motDePasse } });
      return view(await cfgOf(org));
    },

    async tester(ctx, organismeId, essai = null) {
      const org = requireOrg(organismeId); let cfg = await cfgOf(org);
      if (essai) cfg = { ...cfg, ...Object.fromEntries(Object.entries({ mode: essai.mode, url: essai.url?.trim().replace(/\/+$/, ''), utilisateur: essai.utilisateur?.trim(), secret: essai.motDePasse || undefined }).filter(([, x]) => x !== undefined)) };
      if (cfg.fournisseur === 'iparapheur') return { ok: false, message: INDISPONIBLE };
      const ad = adapterOf(cfg);
      const r = ad ? await ad.testConnexion(cfg) : { ok: false, message: 'Aucun parapheur configuré' };
      await audit.log(ctx, { organismeId: org, action: 'parapheur.test', entity: 'parapheur_config', entityId: org, after: { fournisseur: cfg.fournisseur, ok: r.ok, message: r.message } });
      return { fournisseur: cfg.fournisseur, mode: cfg.mode, ...r };
    },

    /**
     * Envoie un document de TEST au parapheur, depuis les paramétrages : une pièce « SANS VALEUR », au gabarit de la
     * collectivité, qui suit exactement le même chemin qu'un vrai acte (adaptateur, signataire dev/prod, journal).
     * Elle n'est liée à aucun acte : le circuit et les dossiers ne sont pas touchés.
     */
    async envoyerEssai(ctx, organismeId, essai = null) {
      const org = requireOrg(organismeId); let cfg = await cfgOf(org);
      if (essai) cfg = { ...cfg, ...Object.fromEntries(Object.entries({ mode: essai.mode, url: essai.url?.trim().replace(/\/+$/, ''), utilisateur: essai.utilisateur?.trim(), secret: essai.motDePasse || undefined }).filter(([, x]) => x !== undefined)) };
      if (cfg.fournisseur === 'iparapheur') throw E.conflict(INDISPONIBLE);
      const ad = adapterOf(cfg);
      if (!ad) throw E.conflict('Aucun parapheur configuré');
      const signataire = signataireOf(cfg);
      verifierSignataire(cfg, signataire);
      const simulation = ad.fournisseur === 'simulateur';
      const orgNom = (await db.get('SELECT nom FROM organismes WHERE id = $1', [org]))?.nom || '';
      const titre = `Document de test — parapheur${orgNom ? ` (${orgNom})` : ''}`;
      const doc = await render.documentEssai(org, { titre, signataire: `${signataire.nom || ''}${signataire.email ? ` <${signataire.email}>` : ''}` });
      const modeLabel = view(cfg).modes_signature.find((m) => m.code === signataire.mode)?.nom || signataire.mode;
      const message = [
        'Essai technique : ce document ne correspond à aucun acte et peut être ignoré ou refusé.',
        '',
        'Type : document de test (parapheur)',
        `Mode : ${cfg.mode === 'dev' ? 'dev (adresse d’essai)' : 'prod (signataire)'}`,
        `Signature : ${modeLabel}${signataire.mode === 'sms' && signataire.telephone ? ` (${signataire.telephone})` : ''}`,
        `Destinataire : ${signataire.nom || '—'}${signataire.email ? ` <${signataire.email}>` : ''}`,
        `Document : ${doc.name}`,
      ].join('\n');
      const payload = { test: true, titre, signataire: signataire.email, mode: cfg.mode, fournisseur: cfg.fournisseur, signatureMode: signataire.mode, document: doc.name };
      if (simulation) {
        await j(org, null, null, 'sortant', { resume: 'Demande de signature (document de test)', corps: payload });
        return { ok: true, message: `Document de test « ${doc.name} » généré. Le parapheur est en simulation : aucun envoi réel.`, document: doc.name, fournisseur: cfg.fournisseur, mode: cfg.mode, signataire, simulateur: true };
      }
      try {
        const r = await ad.creer(cfg, { titre, message, mode: 'sequentiel', signataires: [signataire], documents: [{ nom: doc.name, buffer: doc.buffer, mime: 'application/pdf' }] });
        const e = r._echange || {};
        await j(org, null, null, 'sortant', { resume: 'Demande de signature (document de test)', corps: payload });
        await j(org, null, null, 'entrant', { methode: e.methode, url: e.url, httpStatus: e.httpStatus, resume: `Accusé d’enregistrement (${r.reference || r.id || 'sans référence'})`, reponse: e.reponse || r.brut });
        await audit.log(ctx, { organismeId: org, action: 'parapheur.test_envoi', entity: 'parapheur_config', entityId: org, after: { fournisseur: cfg.fournisseur, mode: cfg.mode, signataire: signataire.email, document: doc.name, ref: r.reference || r.id } });
        return { ok: true, message: `Document de test envoyé au parapheur${r.reference ? ` (référence ${r.reference})` : ''}.${cfg.mode === 'dev' ? ` Destinataire d’essai : ${signataire.email}.` : ''}`, document: doc.name, reference: r.reference || (r.id != null ? String(r.id) : null), fournisseur: cfg.fournisseur, mode: cfg.mode, signataire };
      } catch (err) {
        await j(org, null, null, 'sortant', { resume: 'Demande de signature (document de test)', corps: payload });
        await j(org, null, null, 'entrant', { resume: 'Échec de l’envoi du document de test', erreur: err.message });
        await audit.log(ctx, { organismeId: org, action: 'parapheur.test_envoi_echec', entity: 'parapheur_config', entityId: org, after: { message: err.message } });
        throw err;
      }
    },

    // ------------------------------------------------------------------------------------------------- envoi / suivi
    /**
     * Envoie (ou renvoie) un acte en signature. `auto` : déclenché par la fin du circuit (pas d'utilisateur).
     * `forcer` (réservé aux administrateurs et au SCC) : envoie un acte dont le circuit n'est pas terminé,
     * pour la signature du maire — la décision peut ainsi être signée sans attendre l'inscription au conseil.
     */
    async demanderEnvoi(ctx, organismeId, acteId, { auto = false, forcer = false } = {}) {
      const org = requireOrg(organismeId);
      const c = auto ? SYS(org) : ctx;
      const a = await actes.load(c, org, acteId); // contrôle de visibilité
      const meta = await typeMetaOf(a.type_id);
      const typeSigne = !!meta.meta?.signature;
      // Le privilège (administrer l'acte : administrateur ou SCC) est vérifié AVANT l'état, pour que le bouton sache s'il peut forcer.
      const peutForcer = !auto && forcer && acl.isAdmin(c, org);
      if (!typeSigne) throw E.conflict('Ce type d’acte ne passe pas par la signature du maire (il est inscrit au conseil).');
      if (!['a_signer', 'signature_refusee'].includes(a.statut)) {
        if (!peutForcer) throw E.conflict(`Un acte « ${a.statut} » n’est pas en attente de signature.`);
        // Envoi forcé : l'acte passe directement en signature, même si le circuit n'est pas terminé.
      }
      const cfg = await cfgOf(org);
      if (!cfg.actif) throw E.conflict('Le parapheur est désactivé pour cette collectivité (Paramétrages / Parapheur).');
      const ad = adapterOf(cfg);
      if (!ad) throw E.conflict(INDISPONIBLE);
      const signataire = signataireOf(cfg);
      verifierSignataire(cfg, signataire);

      const doc = await render.renderActe(c, org, acteId, { cible: 'deliberation', mode: 'propre', avecAnnexes: true });
      const typeLabel = meta.code === 'decision' ? 'Décision' : meta.code === 'arrete' ? 'Arrêté' : 'Acte';
      const titre = `${typeLabel} n° ${a.numero_suivi} — ${a.titre}`;
      const nomDoc = render.nomFichier(titre); // nom du PDF affiché par le parapheur
      const payload = { titre, signataire: signataire.email, mode: cfg.mode, fournisseur: cfg.fournisseur, signatureMode: signataire.mode, document: nomDoc };

      const envoi = await db.get(
        `INSERT INTO parapheur_envois (organisme_id, acte_id, fournisseur, mode, statut, signataire_nom, signataire_email, document_nom, payload)
         VALUES ($1,$2,$3,$4,'envoye',$5,$6,$7,$8::jsonb) RETURNING *`,
        [org, acteId, cfg.fournisseur, cfg.mode, signataire.nom, signataire.email, nomDoc, JSON.stringify(payload)]);
      await j(org, envoi.id, acteId, 'sortant', { resume: `Demande de signature (${signataire.mode})`, corps: payload });

      try {
        const r = await ad.creer(cfg, { titre, message: await messageActe(a), mode: 'sequentiel', signataires: [signataire], documents: [{ nom: nomDoc, buffer: doc.buffer, mime: 'application/pdf' }] });
        const e = r._echange || {};
        await j(org, envoi.id, acteId, 'entrant', { methode: e.methode, url: e.url, httpStatus: e.httpStatus, resume: `Accusé d’enregistrement (${r.reference || r.id || 'sans référence'})`, reponse: e.reponse || r.brut });
        await db.run("UPDATE parapheur_envois SET statut = 'a_signer', ref_externe = $2, lien_externe = $3, reponse = $4::jsonb, updated_at = now() WHERE id = $1",
          // L'API du Hub s'interroge par son id numérique : on le stocke dans `ref_externe` (la référence lisible,
          // « PARA-… », reste dans la réponse pour l'affichage). Sinon, interroger/annuler échoue (HTTP 500).
          [envoi.id, r.id != null ? String(r.id) : (r.reference || null), r.lien || null, JSON.stringify(r.brut || r)]);
        await db.run("UPDATE actes SET parapheur_envoi_id = $2, statut = 'a_signer' WHERE id = $1", [acteId, envoi.id]);
        await audit.log(ctx, { organismeId: org, action: peutForcer && !['a_signer', 'signature_refusee'].includes(a.statut) ? 'parapheur.envoi_force' : 'parapheur.envoi', entity: 'actes', entityId: acteId, before: { statut: a.statut }, after: { envoiId: envoi.id, fournisseur: cfg.fournisseur, mode: cfg.mode, signatureMode: signataire.mode, signataire: signataire.email, ref: r.reference || r.id } });
        await bus.emit('parapheur.envoye', { organismeId: org, acteId, envoiId: envoi.id, signataire: signataire.email });
        return { envoiId: envoi.id, statut: 'a_signer', fournisseur: cfg.fournisseur, mode: cfg.mode, simulateur: ad.fournisseur === 'simulateur', signataire };
      } catch (e) {
        await db.run("UPDATE parapheur_envois SET statut = 'erreur', motif = $2, updated_at = now() WHERE id = $1", [envoi.id, e.message]);
        await j(org, envoi.id, acteId, 'entrant', { resume: 'Échec de l’envoi', erreur: e.message });
        await audit.log(ctx, { organismeId: org, action: 'parapheur.envoi_echec', entity: 'actes', entityId: acteId, after: { envoiId: envoi.id, erreur: e.message } });
        throw e;
      }
    },

    /** Déclenché par `circuit.completed` : n'agit que pour un acte « à signer » (type signé) et si le parapheur est actif. */
    async demanderEnvoiAuto(organismeId, acteId) {
      const a = await db.get('SELECT * FROM actes WHERE id = $1 AND organisme_id = $2', [acteId, organismeId]);
      if (!a || a.statut !== 'a_signer') return null;
      const cfg = await cfgOf(organismeId);
      if (!cfg.actif) return null;
      try { return await svc.demanderEnvoi(null, organismeId, acteId, { auto: true }); }
      catch (e) { log?.warn({ acteId, e: e.message }, 'envoi automatique en signature impossible'); return null; }
    },

    /** Interroge le parapheur (sans webhook côté Hub) et met à jour l'état de l'acte. */
    async synchroniser(ctx, organismeId, acteId) {
      const org = requireOrg(organismeId);
      const c = ctx || SYS(org);
      await actes.load(c, org, acteId);
      const envoi = await dernierEnvoi(org, acteId);
      if (!envoi || !envoi.ref_externe) return { statut: envoi?.statut || null, envoi };
      const cfg = await cfgOf(org); const ad = adapterOf(cfg);
      if (!ad) return { statut: envoi.statut, envoi };
      const r = await ad.statut(cfg, envoi.ref_externe);
      const e = r._echange || {};
      await j(org, envoi.id, acteId, 'entrant', { methode: e.methode, url: e.url, httpStatus: e.httpStatus, resume: `État renvoyé par le parapheur : ${r.statut}`, reponse: e.reponse || r.brut });
      await svc._appliquerRetour(org, acteId, envoi.id, r);
      return { statut: r.statut, envoi: await dernierEnvoi(org, acteId) };
    },

    /** Applique un retour du parapheur (interne) : met à jour l'envoi ET l'état de l'acte. */
    async _appliquerRetour(org, acteId, envoiId, { statut, signeAt = null, motif = null }) {
      const mapEnvoi = { signe: 'signe', refuse: 'refuse', annule: 'annule', en_cours: 'a_signer' };
      const mapActe = { signe: 'signe', refuse: 'signature_refusee' };
      const stEnvoi = mapEnvoi[statut] || 'a_signer';
      await db.run("UPDATE parapheur_envois SET statut = $2, signe_at = CASE WHEN $2 = 'signe' THEN COALESCE($3::timestamptz, now()) ELSE signe_at END, refuse_at = CASE WHEN $2 = 'refuse' THEN now() ELSE refuse_at END, motif = COALESCE($4, motif), updated_at = now() WHERE id = $1",
        [envoiId, stEnvoi, signeAt, motif]);
      const stActe = mapActe[statut];
      if (stActe) {
        await db.run("UPDATE actes SET statut = $2, signe_at = CASE WHEN $2 = 'signe' THEN COALESCE($3::timestamptz, now()) ELSE signe_at END, signe_par = CASE WHEN $2 = 'signe' THEN (SELECT signataire_nom FROM parapheur_envois WHERE id = $4) ELSE signe_par END WHERE id = $1",
          [acteId, stActe, signeAt, envoiId]);
        await bus.emit(statut === 'signe' ? 'acte.signe' : 'acte.signature_refusee', { organismeId: org, acteId, motif });
      }
    },

    /** Retour simulé (mode dev uniquement) : complète le dossier sans parapheur réel. */
    async simulerRetour(ctx, organismeId, acteId, { statut = 'signe', motif = null } = {}) {
      const org = requireOrg(organismeId);
      const cfg = await cfgOf(org);
      if (cfg.mode !== 'dev') throw E.forbidden('La simulation du retour n’est possible qu’en mode dev.');
      if (!['signe', 'refuse'].includes(statut)) throw E.badRequest('Statut simulé attendu : signe ou refuse');
      await actes.load(ctx, org, acteId);
      const envoi = await dernierEnvoi(org, acteId);
      if (!envoi) throw E.conflict('Aucun envoi en signature pour ce dossier.');
      const ad = adapterOf(cfg);
      if (ad?.fournisseur === 'simulateur' && envoi.ref_externe) ad.retour(envoi.ref_externe, { statut, motif });
      await j(org, envoi.id, acteId, 'entrant', { resume: `Retour simulé : ${statut}${motif ? ` (${motif})` : ''}`, reponse: { statut, motif } });
      await svc._appliquerRetour(org, acteId, envoi.id, { statut, motif });
      await audit.log(ctx, { organismeId: org, action: 'parapheur.simulation_retour', entity: 'actes', entityId: acteId, after: { statut, motif } });
      return svc.etat(ctx, org, acteId);
    },

    /** Annule l'envoi en cours (l'acte repasse « à signer »). */
    async annuler(ctx, organismeId, acteId, motif) {
      const org = requireOrg(organismeId);
      await actes.load(ctx, org, acteId);
      const envoi = await dernierEnvoi(org, acteId);
      if (!envoi || !['envoye', 'a_signer'].includes(envoi.statut)) throw E.conflict('Aucun envoi en cours à annuler.');
      const cfg = await cfgOf(org); const ad = adapterOf(cfg);
      if (ad && envoi.ref_externe) { const e = (await ad.annuler(cfg, envoi.ref_externe))?._echange; await j(org, envoi.id, acteId, 'sortant', { resume: 'Annulation demandée', ...e }); }
      await db.run("UPDATE parapheur_envois SET statut = 'annule', motif = COALESCE($2, motif), updated_at = now() WHERE id = $1", [envoi.id, motif || null]);
      await db.run("UPDATE actes SET statut = 'a_signer' WHERE id = $1", [acteId]);
      await audit.log(ctx, { organismeId: org, action: 'parapheur.annulation', entity: 'actes', entityId: acteId, after: { envoiId: envoi.id, motif } });
      return svc.etat(ctx, org, acteId);
    },

    // -------------------------------------------------------------------------------------------------- consultation
    async etat(ctx, organismeId, acteId) {
      const org = requireOrg(organismeId);
      const a = await actes.load(ctx, org, acteId);
      const [envoi, journal, cfg] = await Promise.all([
        dernierEnvoi(org, acteId),
        db.all('SELECT id, sens, methode, url, http_status, resume, corps, reponse, erreur, at FROM parapheur_journal WHERE organisme_id = $1 AND acte_id = $2 ORDER BY id DESC LIMIT 100', [org, acteId]),
        cfgOf(org),
      ]);
      // Pourquoi l'envoi (normal) est impossible : sert à afficher le bouton « en surbrillance » et son explication.
      const enAttente = ['a_signer', 'signature_refusee'].includes(a.statut);
      const dejaEnCours = envoi && ['envoye', 'a_signer'].includes(envoi.statut);
      const blocage = a.statut === 'signe' ? 'Cet acte est déjà signé.'
        : !cfg.actif ? 'Le parapheur est désactivé pour cette collectivité.'
        : dejaEnCours ? null
        : !enAttente ? 'Le circuit n’est pas terminé : l’envoi en signature se fera à la fin du circuit.'
        : (!signataireOf(cfg).email) ? 'Renseignez le signataire (nom et e-mail) dans le paramétrage du parapheur.' : null;
      return { envoi: envoi ? { id: envoi.id, statut: envoi.statut, fournisseur: envoi.fournisseur, mode: envoi.mode, ref: envoi.reponse?.reference || envoi.ref_externe, refId: envoi.ref_externe, lien: envoi.lien_externe, signataireNom: envoi.signataire_nom, signataireEmail: envoi.signataire_email, document: envoi.document_nom, demandeAt: envoi.demande_at, signeAt: envoi.signe_at, refuseAt: envoi.refuse_at, motif: envoi.motif } : null,
        blocage,
        journal: journal.map((r) => ({ id: Number(r.id), sens: r.sens, methode: r.methode, url: r.url, httpStatus: r.http_status, resume: r.resume, corps: r.corps, reponse: r.reponse, erreur: r.erreur, at: r.at })),
        config: view(cfg), simulateur: adapterOf(cfg)?.fournisseur === 'simulateur' };
    },

    async journal(ctx, organismeId, { acteId = null, limit = 100 } = {}) {
      const org = requireOrg(organismeId);
      const rows = acteId
        ? await db.all('SELECT * FROM parapheur_journal WHERE organisme_id = $1 AND acte_id = $2 ORDER BY id DESC LIMIT $3', [org, acteId, limit])
        : await db.all('SELECT * FROM parapheur_journal WHERE organisme_id = $1 ORDER BY id DESC LIMIT $2', [org, limit]);
      return { items: rows.map((r) => ({ id: Number(r.id), acteId: r.acte_id, sens: r.sens, methode: r.methode, url: r.url, httpStatus: r.http_status, resume: r.resume, corps: r.corps, reponse: r.reponse, erreur: r.erreur, at: r.at })) };
    },
  };
  return svc;
}

module.exports = { createParapheur };
