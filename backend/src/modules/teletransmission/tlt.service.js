/**
 * Télétransmission au contrôle de légalité (S²LOW, module ACTES — section 19.5, TLT-01 à TLT-19, D82).
 * Chaîne complète : lot de la séance (délibérations ADOPTÉES) → contrôles préalables → préparation (numéro transmis, PDF, classification)
 * → envoi (mode A direct, mode B préparation puis confirmation) → suivi des statuts S²LOW → ARActe et date d'AR de l'acte →
 * documents de la préfecture (tâche prioritaire du SCC, réponse) → bordereau et acte tamponné.
 * L'accès à S²LOW n'est pas encore obtenu (D20) : tant que `tlt.mode` vaut « simulation » (défaut), tout passe par le simulateur
 * (adaptateur `s2low-simulateur.js`), qui rejoue les réponses de S²LOW, dont les retours de la préfecture, pour tester toute la chaîne.
 * Les autres modes sont refusés avec un message clair jusqu'à l'obtention du certificat et de l'instance de test.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const { NUMERO, SCENARIOS, STATUS } = require('../../adapters/s2low-simulateur');

const NATURE_CODES = { delib: 1, reglementaires: 2, individuels: 3, contrats: 4, budgetaire: 5, autres: 6 };
const TYPE_SEANCE = { ordinaire: 'CM', extraordinaire: 'CE', budgetaire: 'CB', autre: 'CX' };
const TYPE_PJ = { convention: '99_CO', plan: '99_PL', annexe: '22_AN' };
const DEFAULT_MOTIF = '{ANNEE}{TYPE_SEANCE}{N_SEANCE:02}_{ORDRE:03}';
const ADOPTES = ['adopte_unanimite', 'adopte_majorite', 'adopte_preponderante'];
const FINAUX = [-1, 0, 4, 5, 6];
const ACTE_TRANSMIS = ['adopte', 'texte_definitif_pret', 'pret_a_transmettre'];

const fmt = (pattern, vars) => String(pattern).replace(/\{(\w+)(?::(\d+))?\}/g, (m, k, w) => String(vars[k] ?? '').padStart(Number(w) || 0, '0')).toUpperCase();
const day = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

function createTeletransmission({ db, audit, actes, render, tenue, settings, storage, bus, adapter, log }) {
  const need = (ctx, org, acl) => acl; void need;

  async function cfgOf(org) {
    const c = await settings.resolve(org);
    const v = (k, d) => (c[k]?.value === undefined || c[k]?.value === null || c[k]?.value === '' ? d : c[k].value);
    return {
      mode: v('tlt.mode', 'simulation'), modeEnvoi: v('tlt.mode_envoi', 'B') === 'A' ? 'A' : 'B', scenario: SCENARIOS[v('tlt.scenario', 'nominal')] ? v('tlt.scenario', 'nominal') : 'nominal',
      siren: String(v('tlt.siren', '')), departement: String(v('tlt.departement', '094')), arrondissement: String(v('tlt.arrondissement', '')),
      motif: String(v('tlt.motif_numero', DEFAULT_MOTIF)), doubleValidation: v('tlt.double_validation', false) === true,
    };
  }
  const assertMode = (cfg) => {
    if (cfg.mode !== 'simulation') throw E.conflict("L'accès à S²LOW n'est pas encore configuré (certificat et instance de test à obtenir) : seul le mode « simulation » est disponible pour le moment");
  };
  const journal = (transactionId, actor, type, detail = null) => db.run('INSERT INTO tlt_journal (transaction_id, type, detail, actor) VALUES ($1,$2,$3::jsonb,$4)', [transactionId, type, detail ? JSON.stringify(detail) : null, actor]);
  const toTx = (r, extra = {}) => ({
    id: r.id, acteId: r.acte_id, seanceId: r.seance_id, itemId: r.item_id, numeroTransmis: r.numero_transmis, mode: r.mode, etat: r.etat, remoteId: r.remote_id, status: r.status,
    statusLabel: r.status_label, scenario: r.package?.scenario ?? null, enAttente: !!r.package?.enAttente, subject: r.package?.subject, decisionDate: r.package?.decisionDate,
    preparePar: r.prepared_by, prepareLe: r.prepared_at, envoyePar: r.sent_by, envoyeLe: r.sent_at, arLe: r.ar_at, arId: r.ar_id, erreur: r.error, ...extra,
  });

  /** Numéro transmis d'une délibération : motif paramétrable, 15 caractères au plus, majuscules, chiffres et « _ » (TLT-03). */
  async function proposerNumero(cfg, s, ordre) {
    const rank = (await db.get(`SELECT count(*)::int + 1 AS n FROM seances WHERE instance_id = $1 AND statut <> 'annulee' AND date_seance < $2
                                 AND EXTRACT(year FROM date_seance AT TIME ZONE 'Europe/Paris') = EXTRACT(year FROM $2::timestamptz AT TIME ZONE 'Europe/Paris')`, [s.instanceId, s.dateSeance])).n;
    return fmt(cfg.motif, { ANNEE: day(s.dateSeance).slice(0, 4), TYPE_SEANCE: TYPE_SEANCE[s.type] || 'CM', N_SEANCE: rank, ORDRE: ordre });
  }

  /** Ce qui sera posté pour une délibération, tel que S²LOW l'attend (TLT-02). */
  async function paquet(org, s, item, acte, delib, cfg, numero) {
    const [nature, matiere] = await Promise.all([
      acte.nature_id ? db.get('SELECT code FROM ref_items WHERE id = $1', [acte.nature_id]) : null,
      acte.matiere_id ? db.get('SELECT code, libelle FROM ref_items WHERE id = $1', [acte.matiere_id]) : null,
    ]);
    const annexes = await db.all(`SELECT a.id, a.titre, t.code AS type_code, f.original_name, f.mime, f.size, f.id AS file_id FROM annexes a JOIN files f ON f.id = a.file_id LEFT JOIN ref_items t ON t.id = a.type_id
                                  WHERE a.acte_id = $1 AND a.transmissible ORDER BY a.ordre, a.id`, [acte.id]);
    return {
      natureCode: nature ? NATURE_CODES[nature.code] ?? null : null, natureLibelle: nature?.code ?? null,
      matiere: matiere ? { code: matiere.code, libelle: matiere.libelle } : null, classif: matiere ? String(matiere.code).split('.').filter(Boolean).slice(0, 5) : [],
      number: numero, decisionDate: day(s.dateSeance), subject: String(delib?.titre || acte.titre || '').trim(), typeActe: '99_DE',
      annexes: annexes.map((a) => ({ fileId: a.file_id, name: a.original_name, mime: a.mime, size: a.size, typePj: TYPE_PJ[a.type_code] || '99_AU', titre: a.titre })),
      siren: cfg.siren, departement: cfg.departement, arrondissement: cfg.arrondissement,
    };
  }

  /** Contrôles préalables (TLT-06) : bloquants (l'envoi est refusé) et avertissements. */
  async function controles(org, cfg, p, { acteId, txId } = {}) {
    const out = []; const add = (niveau, message) => out.push({ niveau, message });
    if (!NUMERO.test(p.number || '')) add('bloquant', `Numéro transmis « ${p.number || ''} » invalide : 15 caractères au plus, majuscules, chiffres ou « _ »`);
    else if (await db.get("SELECT 1 AS x FROM tlt_transactions WHERE organisme_id = $1 AND numero_transmis = $2 AND etat <> 'annule' AND id <> COALESCE($3, 0) AND acte_id <> COALESCE($4, 0)", [org, p.number, txId ?? null, acteId ?? null])) add('bloquant', `Le numéro transmis ${p.number} est déjà utilisé`);
    if (!p.subject) add('bloquant', 'Objet de l’acte absent'); else if (p.subject.length > 500) add('bloquant', `Objet de ${p.subject.length} caractères : 500 au maximum`);
    if (!p.natureCode) add('bloquant', 'Nature de l’acte absente de la classification (délibération, acte réglementaire…)');
    if (p.classif.length < 2) add('bloquant', 'Matière absente ou trop peu détaillée : la classification doit comporter au moins deux niveaux');
    if (p.annexes.some((a) => !/(pdf|jpe?g|png)/i.test(a.mime || ''))) add('bloquant', 'Une annexe n’est ni un PDF, ni une image JPG ou PNG');
    if (!cfg.siren) add('avertissement', 'SIREN de la collectivité non renseigné (Paramètres de télétransmission)');
    if (p.annexes.some((a) => a.typePj === '99_AU')) add('avertissement', 'Des annexes n’ont pas de type précis : le type « autre document » sera utilisé');
    return out;
  }

  async function storePdf(org, ctx, buffer, name) {
    const put = await storage.put(buffer, { organismeId: org, ext: 'pdf' });
    return (await db.get(`INSERT INTO files (organisme_id, storage_key, original_name, mime, size, sha256, created_by) VALUES ($1,$2,$3,'application/pdf',$4,$5,$6) RETURNING id`, [org, put.key, name, put.size, put.sha256, ctx.username])).id;
  }

  const svc = {
    SCENARIOS, STATUS,

    // ------------------------------------------------------------------------------------------ paramètres
    async config(organismeId) {
      const org = requireOrg(organismeId); const cfg = await cfgOf(org);
      return { ...cfg, scenarios: Object.entries(SCENARIOS).map(([code, s]) => ({ code, label: s.label })), classification: await adapter.classification(), connexion: cfg.mode === 'simulation' ? await adapter.testConnexion() : { ok: false, message: 'Accès à S²LOW non configuré' } };
    },
    async setConfig(ctx, organismeId, b) {
      const org = requireOrg(organismeId);
      const map = { mode: 'tlt.mode', modeEnvoi: 'tlt.mode_envoi', scenario: 'tlt.scenario', siren: 'tlt.siren', departement: 'tlt.departement', arrondissement: 'tlt.arrondissement', motif: 'tlt.motif_numero', doubleValidation: 'tlt.double_validation' };
      if (b.motif !== undefined) {
        const essai = fmt(b.motif, { ANNEE: '2026', TYPE_SEANCE: 'CM', N_SEANCE: 4, ORDRE: 12 });
        if (!NUMERO.test(essai)) throw E.badRequest(`Ce motif produit « ${essai} » : le numéro transmis doit compter 15 caractères au plus, en majuscules, chiffres ou « _ »`);
      }
      for (const [k, key] of Object.entries(map)) if (b[k] !== undefined) await settings.put(ctx, { scope: 'organisme', organismeId: org, key, val: b[k] });
      return svc.config(org);
    },

    // ------------------------------------------------------------------------------------------ lot d'une séance
    /** Délibérations de la séance : adoptées (transmissibles), les autres exclues avec leur raison (TLT-01), avec numéro transmis et contrôles. */
    async lot(ctx, organismeId, seanceId) {
      const org = requireOrg(organismeId); const cfg = await cfgOf(org);
      const d = await tenue.donnees(ctx, org, seanceId);
      if (!d) return { seance: null, cfg: { mode: cfg.mode, modeEnvoi: cfg.modeEnvoi }, items: [], message: "Le suivi de séance n'a pas été ouvert : il n'y a pas de résultat de vote à transmettre." };
      const s = d.seance; const items = []; let ordre = 0;
      for (const p of d.points.filter((x) => x.kind === 'deliberation' && x.statut === 'a_traiter')) {
        ordre++;
        const tx = await db.get("SELECT * FROM tlt_transactions WHERE acte_id = $1 AND etat IN ('prepare','poste') ORDER BY id DESC LIMIT 1", [p.acte.id]);
        const base = { itemId: p.id, acteId: p.acte.id, numeroSuivi: p.acte.numeroSuivi, numero: p.numero, titre: p.titre, etatPoint: p.etat, resultat: p.resultat };
        if (tx) { items.push({ ...base, statut: 'en_cours', raison: null, transaction: toTx(tx), controles: [] }); continue; }
        if (p.etat !== 'traite') { items.push({ ...base, statut: 'exclu', raison: p.etat === 'en_cours' ? 'Point en cours de traitement' : p.etat === 'a_traiter' ? 'Point non traité' : p.etat === 'retire' ? 'Point retiré' : p.etat === 'ajourne' ? 'Point ajourné' : 'Point clos sans vote', transaction: null, controles: [] }); continue; }
        if (!ADOPTES.includes(p.resultat)) { items.push({ ...base, statut: 'exclu', raison: 'Délibération rejetée : elle n’est pas transmise', transaction: null, controles: [] }); continue; }
        const acte = await db.get('SELECT * FROM actes WHERE id = $1', [p.acte.id]);
        const delib = await db.get('SELECT * FROM deliberations WHERE id = (SELECT deliberation_id FROM seance_items WHERE id = $1)', [p.id]);
        const numero = await proposerNumero(cfg, s, ordre);
        const pk = await paquet(org, s, p, acte, delib, cfg, numero);
        const ctl = await controles(org, cfg, pk, { acteId: acte.id });
        if (d.tenue.statut !== 'close') ctl.push({ niveau: 'avertissement', message: 'La séance n’est pas encore close' });
        items.push({ ...base, statut: 'a_preparer', raison: null, numeroTransmis: numero, matiere: pk.matiere, natureCode: pk.natureCode, classif: pk.classif, annexes: pk.annexes.length, transaction: null, controles: ctl });
      }
      return { seance: { id: s.id, instance: s.instance, dateSeance: s.dateSeance, statut: s.statut, tenue: d.tenue.statut }, cfg: { mode: cfg.mode, modeEnvoi: cfg.modeEnvoi, scenario: cfg.scenario, doubleValidation: cfg.doubleValidation }, items };
    },

    // ------------------------------------------------------------------------------------------ préparation et envoi
    /** Prépare la transmission : numéro transmis, PDF de la délibération, classification, annexes typées. Aucun envoi à ce stade. */
    async preparer(ctx, organismeId, seanceId, { itemIds, scenario }) {
      const org = requireOrg(organismeId); const cfg = await cfgOf(org); assertMode(cfg);
      const lot = await svc.lot(ctx, org, seanceId);
      const d = await tenue.donnees(ctx, org, seanceId);
      const crees = []; const refuses = [];
      for (const id of itemIds) {
        const it = lot.items.find((x) => x.itemId === id);
        if (!it) { refuses.push({ itemId: id, raisons: ['Point introuvable dans cette séance'] }); continue; }
        if (it.statut !== 'a_preparer') { refuses.push({ itemId: id, raisons: [it.raison || 'Déjà préparée ou transmise'] }); continue; }
        const bloquants = it.controles.filter((c) => c.niveau === 'bloquant').map((c) => c.message);
        if (bloquants.length) { refuses.push({ itemId: id, raisons: bloquants }); continue; }
        const acte = await db.get('SELECT * FROM actes WHERE id = $1', [it.acteId]);
        const delib = await db.get('SELECT * FROM deliberations WHERE id = (SELECT deliberation_id FROM seance_items WHERE id = $1)', [id]);
        const pk = await paquet(org, d.seance, it, acte, delib, cfg, it.numeroTransmis);
        const pdf = await render.renderActe(ctx, org, acte.id, { cible: 'deliberation', deliberationId: delib.id, mode: 'propre', watermark: '' });
        const fileId = await storePdf(org, ctx, pdf.buffer, `deliberation-${it.numeroTransmis}.pdf`);
        const pkg = { ...pk, file: { fileId, name: `deliberation-${it.numeroTransmis}.pdf`, size: pdf.buffer.length }, scenario: SCENARIOS[scenario] ? scenario : cfg.scenario, enAttente: cfg.modeEnvoi === 'B' };
        const r = await db.get(`INSERT INTO tlt_transactions (organisme_id, acte_id, seance_id, item_id, numero_transmis, mode, package, file_id, prepared_by)
                                VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING *`, [org, acte.id, seanceId, id, it.numeroTransmis, cfg.mode, JSON.stringify(pkg), fileId, ctx.username]);
        await db.run("UPDATE actes SET statut = 'pret_a_transmettre' WHERE id = $1 AND statut IN ('adopte','texte_definitif_pret')", [acte.id]);
        await journal(r.id, ctx.username, 'prepare', { numero: r.numero_transmis, scenario: pkg.scenario });
        await audit.log(ctx, { organismeId: org, action: 'tlt.prepare', entity: 'tlt_transactions', entityId: r.id, after: { acteId: acte.id, numero: r.numero_transmis } });
        crees.push(toTx(r));
      }
      return { crees, refuses };
    },

    async _get(org, id) {
      const r = await db.get('SELECT * FROM tlt_transactions WHERE id = $1 AND organisme_id = $2', [id, org]);
      if (!r) throw E.notFound('Transaction introuvable');
      return r;
    },

    /** Envoi à S²LOW. Mode A : posté tout de suite ; mode B : posté « en attente », à confirmer (l'irréversible est fait par une personne identifiée). */
    async envoyer(ctx, organismeId, id) {
      const org = requireOrg(organismeId); const cfg = await cfgOf(org); assertMode(cfg);
      const tx = await svc._get(org, id);
      if (tx.etat !== 'prepare') throw E.conflict(tx.etat === 'poste' ? 'Cette transaction a déjà été postée' : `Cette transaction est « ${tx.etat} » : préparez-la de nouveau`);
      if (cfg.doubleValidation && tx.prepared_by === ctx.username) throw E.forbidden('Double validation : l’envoi doit être fait par une autre personne que celle qui a préparé la transmission');
      const pkg = tx.package; const enAttente = cfg.modeEnvoi === 'B';
      const r = await adapter.creer({ organismeId: org, ...pkg, enAttente });
      if (!r.ok) {
        await db.run("UPDATE tlt_transactions SET etat = 'erreur', error = $2, updated_at = now() WHERE id = $1", [id, r.message]);
        await journal(id, ctx.username, 'echec', { message: r.message });
        throw E.conflict(`S²LOW a refusé la transaction : ${r.message}`);
      }
      const status = enAttente ? 17 : 1;
      const row = await db.get(`UPDATE tlt_transactions SET etat = 'poste', remote_id = $2, status = $3, status_label = $4, sent_by = $5, sent_at = now(), error = NULL, package = package || $6::jsonb, updated_at = now() WHERE id = $1 RETURNING *`,
        [id, r.id, status, STATUS[status], ctx.username, JSON.stringify({ enAttente })]);
      if (!enAttente) await db.run("UPDATE actes SET statut = 'transmis' WHERE id = $1 AND statut IN ('adopte','texte_definitif_pret','pret_a_transmettre')", [tx.acte_id]);
      await journal(id, ctx.username, 'poste', { remoteId: r.id, mode: enAttente ? 'B' : 'A' });
      await audit.log(ctx, { organismeId: org, action: 'tlt.envoi', entity: 'tlt_transactions', entityId: id, after: { remoteId: r.id, numero: tx.numero_transmis, mode: enAttente ? 'B' : 'A' } });
      return toTx(row);
    },

    /** Mode B : confirmation sur S²LOW (simulée ici) de la transaction « en attente d'être postée ». */
    async confirmer(ctx, organismeId, id) {
      const org = requireOrg(organismeId); const cfg = await cfgOf(org); assertMode(cfg);
      const tx = await svc._get(org, id);
      if (tx.etat !== 'poste' || tx.status !== 17) throw E.conflict('Cette transaction n’est pas en attente de confirmation');
      const r = await adapter.confirmer(tx.remote_id);
      if (!r.ok) throw E.conflict(`S²LOW : ${r.message}`);
      const row = await db.get('UPDATE tlt_transactions SET status = 1, status_label = $2, updated_at = now() WHERE id = $1 RETURNING *', [id, STATUS[1]]);
      await db.run("UPDATE actes SET statut = 'transmis' WHERE id = $1 AND statut IN ('adopte','texte_definitif_pret','pret_a_transmettre')", [tx.acte_id]);
      await journal(id, ctx.username, 'confirme');
      await audit.log(ctx, { organismeId: org, action: 'tlt.confirmation', entity: 'tlt_transactions', entityId: id, after: { remoteId: tx.remote_id } });
      return toTx(row);
    },

    async annuler(ctx, organismeId, id, motif) {
      const org = requireOrg(organismeId); const cfg = await cfgOf(org); assertMode(cfg);
      const tx = await svc._get(org, id);
      if (tx.etat === 'prepare') {
        const row = await db.get("UPDATE tlt_transactions SET etat = 'annule', updated_at = now() WHERE id = $1 RETURNING *", [id]);
        await db.run("UPDATE actes SET statut = 'adopte' WHERE id = $1 AND statut = 'pret_a_transmettre'", [tx.acte_id]);
        await journal(id, ctx.username, 'annule', { motif });
        return toTx(row);
      }
      if (tx.etat !== 'poste') throw E.conflict('Cette transaction ne peut pas être annulée');
      const r = await adapter.annuler(tx.remote_id);
      if (!r.ok) throw E.conflict(`S²LOW : ${r.message}`);
      const row = await db.get("UPDATE tlt_transactions SET etat = 'annule', status = 0, status_label = $2, updated_at = now() WHERE id = $1 RETURNING *", [id, STATUS[0]]);
      await db.run("UPDATE actes SET statut = 'adopte' WHERE id = $1 AND statut IN ('transmis', 'pret_a_transmettre')", [tx.acte_id]);
      await journal(id, ctx.username, 'annule', { motif });
      await audit.log(ctx, { organismeId: org, action: 'tlt.annulation', entity: 'tlt_transactions', entityId: id, after: { motif: motif || null } });
      return toTx(row);
    },

    // ------------------------------------------------------------------------------------------ suivi (TLT-07, TLT-08)
    /** Interroge S²LOW : statuts des transactions vivantes, ARActe, puis documents de la préfecture (marqués lus après enregistrement). */
    async suivre(organismeId, actor = 'systeme') {
      const org = requireOrg(organismeId); const cfg = await cfgOf(org);
      if (cfg.mode !== 'simulation') return { statuts: 0, documents: 0, ignore: 'mode' };
      let statuts = 0; let documents = 0;
      for (const tx of await db.all("SELECT * FROM tlt_transactions WHERE organisme_id = $1 AND etat = 'poste' AND remote_id IS NOT NULL", [org])) {
        const st = await adapter.statut(tx.remote_id);
        if (!st || st.status === tx.status) continue;
        const ar = st.status === 4 && st.ar ? st.ar : null;
        const row = await db.get(`UPDATE tlt_transactions SET status = $2, status_label = $3, error = $4, ar_id = COALESCE($5, ar_id), ar_at = COALESCE($6::timestamptz, ar_at), ar_content = COALESCE($7, ar_content), updated_at = now() WHERE id = $1 RETURNING *`,
          [tx.id, st.status, st.label, [-1, 6].includes(st.status) ? st.message : null, ar?.id ?? null, ar?.date ?? null, ar ? `Accusé de réception (simulation) — identifiant unique de l’acte : ${ar.id}` : null]);
        await journal(tx.id, actor, 'statut', { de: tx.status, vers: st.status, label: st.label });
        statuts++;
        if ([1, 2, 3].includes(st.status)) await db.run("UPDATE actes SET statut = 'transmis' WHERE id = $1 AND statut IN ('adopte','texte_definitif_pret','pret_a_transmettre')", [tx.acte_id]);
        if (ar) { // l'AR renseigne d'office l'état de l'acte (TLT-07)
          await db.run("UPDATE actes SET statut = 'ar_recu' WHERE id = $1 AND statut IN ('adopte','texte_definitif_pret','pret_a_transmettre','transmis')", [tx.acte_id]);
          await bus.emit('tlt.ar', { organismeId: org, acteId: tx.acte_id, transactionId: tx.id, arId: ar.id });
        }
        void row;
      }
      for (const doc of await adapter.documentsPrefecture(org)) {
        const tx = await db.get('SELECT * FROM tlt_transactions WHERE organisme_id = $1 AND remote_id = $2', [org, doc.remoteId]);
        if (!tx) continue;
        await db.run('INSERT INTO tlt_documents (organisme_id, transaction_id, remote_id, type, titre, contenu, received_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (transaction_id, remote_id) DO NOTHING', [org, tx.id, doc.id, doc.type, doc.titre, doc.contenu, doc.date]);
        await adapter.marquerLu(doc.id); // obligatoire : sinon le document revient à chaque interrogation
        await journal(tx.id, actor, 'document', { type: doc.type, titre: doc.titre });
        documents++;
        if ([3, 4, 5].includes(doc.type)) await bus.emit('tlt.document', { organismeId: org, acteId: tx.acte_id, transactionId: tx.id, type: doc.type, titre: doc.titre, motif: doc.titre });
      }
      return { statuts, documents };
    },

    /** Réponse à la préfecture (type_envoie 4 : envoi de pièces ; 3 : refus d'envoi). */
    async repondre(ctx, organismeId, docId, { typeEnvoie, message }) {
      const org = requireOrg(organismeId); const cfg = await cfgOf(org); assertMode(cfg);
      const doc = await db.get('SELECT * FROM tlt_documents WHERE id = $1 AND organisme_id = $2', [docId, org]);
      if (!doc) throw E.notFound('Document introuvable');
      if (doc.statut !== 'a_traiter') throw E.conflict('Ce document a déjà été traité');
      if (doc.type !== 3) throw E.conflict('Seule une demande de pièces complémentaires appelle une réponse dans l’outil');
      const tx = await svc._get(org, doc.transaction_id);
      const r = await adapter.repondre(tx.remote_id, { typeEnvoie, message });
      if (!r.ok) throw E.conflict(`S²LOW : ${r.message}`);
      await db.run("UPDATE tlt_documents SET statut = 'repondu', reponse = $2::jsonb, traite_par = $3, traite_at = now() WHERE id = $1", [docId, JSON.stringify({ typeEnvoie, message: message || null }), ctx.username]);
      await journal(tx.id, ctx.username, 'reponse', { typeEnvoie, message: message || null });
      await svc.suivre(org, ctx.username);
      return (await svc.documents(ctx, org)).items.find((d) => d.id === docId);
    },
    async clore(ctx, organismeId, docId) {
      const org = requireOrg(organismeId);
      const r = await db.get("UPDATE tlt_documents SET statut = 'clos', traite_par = $3, traite_at = now() WHERE id = $1 AND organisme_id = $2 AND statut = 'a_traiter' RETURNING id", [docId, org, ctx.username]);
      if (!r) throw E.conflict('Document introuvable ou déjà traité');
      return { id: docId, statut: 'clos' };
    },

    // ------------------------------------------------------------------------------------------ consultation
    async liste(ctx, organismeId, { seanceId } = {}) {
      const org = requireOrg(organismeId); const p = [org]; let w = '';
      if (seanceId) { p.push(seanceId); w = 'AND t.seance_id = $2'; }
      const rows = await db.all(`SELECT t.*, a.titre AS acte_titre, a.numero_suivi, a.statut AS acte_statut FROM tlt_transactions t JOIN actes a ON a.id = t.acte_id WHERE t.organisme_id = $1 ${w} ORDER BY t.id DESC LIMIT 300`, p);
      return { items: rows.map((r) => toTx(r, { titre: r.acte_titre, numeroSuivi: r.numero_suivi, acteStatut: r.acte_statut })) };
    },
    async detail(ctx, organismeId, id) {
      const org = requireOrg(organismeId); const tx = await svc._get(org, id);
      const j = await db.all('SELECT id, type, detail, actor, at FROM tlt_journal WHERE transaction_id = $1 ORDER BY id', [id]);
      return { ...toTx(tx), package: tx.package, journal: j.map((x) => ({ id: Number(x.id), type: x.type, detail: x.detail, actor: x.actor, at: x.at })) };
    },
    async documents(ctx, organismeId) {
      const org = requireOrg(organismeId);
      const rows = await db.all(`SELECT d.*, t.numero_transmis, t.acte_id, a.titre AS acte_titre FROM tlt_documents d JOIN tlt_transactions t ON t.id = d.transaction_id JOIN actes a ON a.id = t.acte_id WHERE d.organisme_id = $1 ORDER BY (d.statut = 'a_traiter') DESC, d.id DESC LIMIT 200`, [org]);
      return { items: rows.map((d) => ({ id: d.id, transactionId: d.transaction_id, numeroTransmis: d.numero_transmis, acteId: d.acte_id, acteTitre: d.acte_titre, type: d.type, titre: d.titre, contenu: d.contenu, recuLe: d.received_at, statut: d.statut, reponse: d.reponse, traitePar: d.traite_par, traiteLe: d.traite_at, prioritaire: [3, 4, 5].includes(d.type) })) };
    },
    /** Tableau de bord (TLT-16). */
    async tableau(ctx, organismeId) {
      const org = requireOrg(organismeId);
      const n = async (sql) => (await db.get(sql, [org])).n;
      const cfg = await cfgOf(org);
      return {
        mode: cfg.mode, modeEnvoi: cfg.modeEnvoi,
        aPreparer: await n("SELECT count(*)::int AS n FROM actes a WHERE a.organisme_id = $1 AND a.statut = 'adopte' AND EXISTS (SELECT 1 FROM seance_items i WHERE i.acte_id = a.id AND i.seance_id = a.seance_id)"),
        preparees: await n("SELECT count(*)::int AS n FROM tlt_transactions WHERE organisme_id = $1 AND etat = 'prepare'"),
        enAttenteConfirmation: await n("SELECT count(*)::int AS n FROM tlt_transactions WHERE organisme_id = $1 AND etat = 'poste' AND status = 17"),
        enAttenteAr: await n("SELECT count(*)::int AS n FROM tlt_transactions WHERE organisme_id = $1 AND etat = 'poste' AND status IN (1, 2, 3)"),
        acquittees: await n("SELECT count(*)::int AS n FROM tlt_transactions WHERE organisme_id = $1 AND etat = 'poste' AND status IN (4, 5)"),
        enErreur: await n("SELECT count(*)::int AS n FROM tlt_transactions WHERE organisme_id = $1 AND (etat = 'erreur' OR status IN (-1, 6))"),
        documentsATraiter: await n("SELECT count(*)::int AS n FROM tlt_documents WHERE organisme_id = $1 AND statut = 'a_traiter' AND type IN (3, 4, 5)"),
      };
    },

    // ------------------------------------------------------------------------------------------ pièces (TLT-10)
    async bordereau(ctx, organismeId, id) {
      const org = requireOrg(organismeId); const tx = await svc._get(org, id);
      if (!tx.ar_id) throw E.conflict('Pas encore d’accusé de réception : le bordereau n’existe pas');
      const buf = await adapter.bordereau(tx.remote_id);
      if (!buf) throw E.conflict('Bordereau indisponible');
      return { buffer: buf, name: `bordereau-${tx.numero_transmis}.pdf` };
    },
    /** Acte tamponné avec la date de publication (`tampon=true&date_affichage=`). */
    async acteTamponne(ctx, organismeId, id, dateAffichage) {
      const org = requireOrg(organismeId); const tx = await svc._get(org, id);
      if (!tx.ar_id) throw E.conflict('Pas encore d’accusé de réception : l’acte ne peut pas être tamponné');
      const f = await db.get('SELECT storage_key FROM files WHERE id = $1', [tx.file_id]);
      const src = await storage.get(f.storage_key);
      const buffer = await adapter.tampon(src, { dateAffichage: dateAffichage || new Date().toISOString(), ar: { id: tx.ar_id, date: tx.ar_at } });
      return { buffer, name: `acte-tamponne-${tx.numero_transmis}.pdf` };
    },

    // ------------------------------------------------------------------------------------------ simulation
    async simulation(ctx, organismeId) {
      const org = requireOrg(organismeId); const cfg = await cfgOf(org);
      return { actif: cfg.mode === 'simulation', serveur: cfg.mode === 'simulation' ? await adapter.etat(org) : [], scenarios: Object.entries(SCENARIOS).map(([code, s]) => ({ code, label: s.label, etapes: s.steps.length })) };
    },
    /** Fait avancer le serveur factice (une étape par défaut, ou `pas`), puis rejoue le suivi : l'outil reçoit les statuts et les documents. */
    async avancer(ctx, organismeId, { transactionId, remoteId, pas = 1 } = {}) {
      const org = requireOrg(organismeId); const cfg = await cfgOf(org); assertMode(cfg);
      const tx = transactionId ? await svc._get(org, transactionId) : null;
      if (transactionId && !tx.remote_id) throw E.conflict('Cette transaction n’a pas encore été postée');
      const changes = await adapter.avancer({ organismeId: org, remoteId: remoteId || tx?.remote_id, pas });
      const suivi = await svc.suivre(org, ctx.username);
      await audit.log(ctx, { organismeId: org, action: 'tlt.simulation', entity: 'tlt_transactions', entityId: transactionId ?? null, after: { pas, changes: changes.length } });
      return { changes, suivi };
    },
  };
  void log;
  return svc;
}

module.exports = { createTeletransmission, ADOPTES, FINAUX, ACTE_TRANSMIS, DEFAULT_MOTIF, fmt };
