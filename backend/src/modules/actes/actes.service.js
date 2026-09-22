/**
 * Fiche d'acte (dossier) : création, lecture, modification, abandon, duplication, délibérations, complétude.
 * Le rédacteur, la direction et le service sont déduits de l'identité RH ; la direction porteuse détermine le circuit (DRO-03).
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const { nextCounter } = require('../../shared/infra');

const DRIVERS = ['incidenceFinanciere', 'montant', 'typeId'];
const toActe = (r) => r && ({
  id: r.id, organismeId: r.organisme_id, numeroSuivi: r.numero_suivi, typeId: r.type_id, typeCode: r.type_code ?? null, typeLibelle: r.type_libelle ?? null,
  titre: r.titre, statut: r.statut,
  redacteur: r.redacteur, coRedacteurs: r.co_redacteurs,
  direction: { code: r.direction_code, label: r.direction_label }, service: r.service_code || r.service_label ? { code: r.service_code, label: r.service_label } : null,
  natureId: r.nature_id, matiereId: r.matiere_id, rubriqueId: r.rubrique_id, incidenceFinanciere: r.incidence_financiere,
  montant: r.montant === null ? null : Number(r.montant), rapporteurId: r.rapporteur_id, rapporteurComplId: r.rapporteur_compl_id,
  seanceViseeId: r.seance_visee_id, seanceId: r.seance_id, urgence: r.urgence, dateLimite: r.date_limite, confidentialite: r.confidentialite,
  commentaireInitial: r.commentaire_initial, custom: r.custom, currentStepKey: r.current_step_key, participants: r.participants,
  submittedAt: r.submitted_at, abandonedAt: r.abandoned_at, abandonMotif: r.abandon_motif, createdAt: r.created_at, updatedAt: r.updated_at,
  signeAt: r.signe_at ?? null, signePar: r.signe_par ?? null, parapheurEnvoiId: r.parapheur_envoi_id ?? null,
});
const toDelib = (r) => ({ id: r.id, acteId: r.acte_id, ordre: r.ordre, titre: r.titre });

function createActes({ db, audit, refs, redaction, dir, acl, bus, late }) {
  const svc = {
    toActe,

    /**
     * Ajoute à chaque acte de la liste sa séance visée (« seanceVisee » : { id, dateSeance, instance, inscrit }, ou null) — celle qu'il vise, à défaut celle où il est inscrit.
     * « inscrit » : l'acte est à l'ordre du jour de cette séance (point à traiter, non retiré), et pas seulement visé (SEA-18).
     * Deux requêtes pour toute la liste : à appeler sur tout ce qui s'affiche en tableau (dossiers, à traiter, équipe, validés).
     */
    async attachSeance(list) {
      const ids = [...new Set(list.map((a) => a?.seanceViseeId ?? a?.seanceId).filter(Boolean))];
      const rows = ids.length ? await db.all('SELECT s.id, s.date_seance, i.nom AS instance FROM seances s JOIN instances i ON i.id = s.instance_id WHERE s.id = ANY($1::int[])', [ids]) : [];
      const actes = [...new Set(list.map((a) => a?.id).filter(Boolean))];
      const odj = ids.length && actes.length ? await db.all("SELECT DISTINCT seance_id, acte_id FROM seance_items WHERE statut = 'a_traiter' AND seance_id = ANY($1::int[]) AND acte_id = ANY($2::int[])", [ids, actes]) : [];
      const inscrits = new Set(odj.map((r) => `${r.seance_id}:${r.acte_id}`));
      const by = new Map(rows.map((r) => [r.id, { id: r.id, dateSeance: r.date_seance, instance: r.instance }]));
      for (const a of list) {
        const s = a ? by.get(a.seanceViseeId ?? a.seanceId) : null;
        if (a) a.seanceVisee = s ? { ...s, inscrit: inscrits.has(`${s.id}:${a.id}`) } : null;
      }
      return list;
    },

    async raw(organismeId, id) {
      const a = await db.get(
        `SELECT a.*, t.code AS type_code, t.libelle AS type_libelle FROM actes a LEFT JOIN ref_items t ON t.id = a.type_id
         WHERE a.id = $1 AND a.organisme_id = $2`, [id, requireOrg(organismeId)]);
      if (!a) throw E.notFound('Acte introuvable');
      return a;
    },

    /** Charge un acte et vérifie que l'utilisateur peut le voir (404 sinon : on ne révèle pas l'existence). */
    async load(ctx, organismeId, id, { edit = false } = {}) {
      const a = await svc.raw(organismeId, id);
      if (!(await acl.canView(ctx, a))) throw E.notFound('Acte introuvable');
      if (edit && !(await acl.canEdit(ctx, a))) throw E.forbidden("Vous ne pouvez pas modifier cet acte à ce stade");
      return a;
    },

    async labels(directionCode, serviceCode, agent) {
      let dl = null; let sl = null;
      try {
        const d = (await dir.directions()).find((x) => x.code === directionCode);
        dl = d?.label || null; sl = d?.services.find((s) => s.code === serviceCode)?.label || null;
        if (!d && (await dir.directions()).length) throw E.badRequest(`Direction inconnue de l'organigramme : ${directionCode}`);
      } catch (e) { if (e.status === 400) throw e; }
      if (!dl && agent?.direction_code === directionCode) dl = agent.direction_label;
      if (!sl && agent?.service_code === serviceCode) sl = agent.service_label;
      return { directionLabel: dl, serviceLabel: sl };
    },

    /** Références vers les élus (rapporteurs) et la séance visée : elles doivent appartenir à l'organisme (isolation). */
    async checkRefs(org, b) {
      if (b.rapporteurId) await late.elus.assertExists(org, b.rapporteurId);
      if (b.rapporteurComplId) await late.elus.assertExists(org, b.rapporteurComplId);
      if (b.seanceViseeId) await late.seances.assertViseable(org, b.seanceViseeId);
    },

    async create(ctx, organismeId, b) {
      const org = requireOrg(organismeId);
      const type = await refs.require('type_acte', b.typeId, org);
      const directionCode = b.directionCode || ctx.agent?.direction_code;
      if (!directionCode) throw E.badRequest('Direction porteuse à préciser (aucune direction connue pour votre profil)');
      const own = ctx.agent?.direction_code === directionCode;
      const serviceCode = b.serviceCode ?? (own ? ctx.agent.service_code : null);
      if (!serviceCode && !own && !ctx.isPlatformAdmin) throw E.badRequest("Service porteur à préciser (vous n'appartenez pas à cette direction, DRO-08)");
      const perm = await redaction.canDraft(ctx, org, directionCode, serviceCode);
      if (!perm.ok) throw E.forbidden("Vous n'êtes pas autorisé à rédiger pour cette direction");
      const { directionLabel, serviceLabel } = await svc.labels(directionCode, serviceCode, ctx.agent);
      const serviceLabelFinal = b.serviceLabel?.trim() || serviceLabel; // champ libre : précise le service porteur (ex. chargé de mission)

      const natureId = b.natureId ? (await refs.require('nature', b.natureId, org)).id
        : (type.meta?.natureCode ? (await refs.byCode('nature', type.meta.natureCode, org))?.id ?? null : null);
      const matiereId = b.matiereId ? (await refs.require('matiere', b.matiereId, org, { leaf: true })).id : null;
      const rubriqueId = b.rubriqueId ? (await refs.require('rubrique', b.rubriqueId, org)).id : null;

      await svc.checkRefs(org, b);
      if (b.custom && late.champs) b.custom = await late.champs.valider(ctx, { organisme_id: org, type_id: type.id, statut: 'brouillon', redacteur: ctx.username, co_redacteurs: [] }, b.custom, {});
      const acte = await db.tx(async (q) => {
        // Les actes importés d'AIRS ont des numéros de suivi élevés : le compteur ne doit jamais les dépasser par le bas.
        const maxSuivi = (await q.get('SELECT COALESCE(max(numero_suivi), 0)::int AS m FROM actes WHERE organisme_id = $1', [org])).m;
        const numero = await nextCounter(q, org, 'acte', { plancher: maxSuivi });
        const a = await q.get(
          `INSERT INTO actes (organisme_id, numero_suivi, type_id, titre, redacteur, direction_code, direction_label, service_code, service_label,
             nature_id, matiere_id, rubrique_id, incidence_financiere, montant, rapporteur_id, rapporteur_compl_id, seance_visee_id,
             urgence, date_limite, confidentialite, commentaire_initial, custom)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb) RETURNING *`,
          [org, numero, type.id, b.titre, ctx.username, directionCode, directionLabel, serviceCode, serviceLabelFinal, natureId, matiereId, rubriqueId,
            b.incidenceFinanciere ?? null, b.montant ?? null, b.rapporteurId ?? null, b.rapporteurComplId ?? null, b.seanceViseeId ?? null,
            !!b.urgence, b.dateLimite ?? null, b.confidentialite || 'normale', b.commentaire ?? null, JSON.stringify(b.custom || {})]);
        const n = Math.max(1, type.meta?.minDeliberations ?? 1);
        for (let i = 1; i <= n; i++) await q.run('INSERT INTO deliberations (acte_id, ordre, titre) VALUES ($1,$2,$3)', [a.id, i, n === 1 ? b.titre : `${b.titre} (${i})`]);
        return a;
      });
      await audit.log(ctx, { organismeId: org, action: 'acte.create', entity: 'actes', entityId: acte.id, after: { numeroSuivi: acte.numero_suivi, titre: acte.titre, direction: directionCode, via: perm.via } });
      await bus.emit('acte.created', { organismeId: org, acteId: acte.id, ctx });
      return toActe(acte);
    },

    async deliberations(acteId) { return (await db.all('SELECT * FROM deliberations WHERE acte_id = $1 ORDER BY ordre, id', [acteId])).map(toDelib); },

    // ---- liens « délibérations d'autorisation » (décisions prises par délégation) --------------------------------------
    /** Délibérations liées à cet acte (qui l'autorisent). Renvoie titre, numéro et type de la cible. */
    async liens(acteId) {
      return db.all(
        `SELECT l.id, l.cible_acte_id AS "cibleActeId", l.kind, l.created_at AS "createdAt",
                a.titre, a.numero_suivi AS "numeroSuivi", a.statut, t.code AS "typeCode", t.libelle AS "typeLibelle"
         FROM acte_liens l JOIN actes a ON a.id = l.cible_acte_id LEFT JOIN ref_items t ON t.id = a.type_id
         WHERE l.acte_id = $1 ORDER BY l.created_at`, [acteId]);
    },
    /** États d'une délibération déjà passée (elle peut autoriser une décision). */
    async ajouterLien(ctx, organismeId, acteId, cibleActeId) {
      const a = await svc.load(ctx, organismeId, acteId, { edit: true });
      if (a.id === Number(cibleActeId)) throw E.badRequest('Un acte ne peut pas s\'autoriser lui-même');
      const cible = await svc.raw(organismeId, cibleActeId);
      if (!(await acl.canView(ctx, cible))) throw E.notFound('Délibération introuvable');
      if (cible.type_code !== 'deliberation') throw E.badRequest('Seule une délibération peut autoriser une décision');
      const PASSEES = ['adopte', 'transmis', 'ar_recu', 'publie', 'executoire', 'archive', 'texte_definitif_pret', 'pret_a_transmettre'];
      if (!PASSEES.includes(cible.statut)) throw E.badRequest('La délibération liée doit être adoptée (passée au conseil)');
      try {
        const l = await db.get('INSERT INTO acte_liens (organisme_id, acte_id, cible_acte_id, kind, created_by) VALUES ($1,$2,$3,\'autorisation\',$4) RETURNING id', [requireOrg(organismeId), a.id, cible.id, ctx.username]);
        await audit.log(ctx, { organismeId: a.organisme_id, action: 'acte.lien.ajout', entity: 'acte_liens', entityId: l.id, after: { acteId: a.id, cibleActeId: cible.id } });
        await bus.emit('acte.lien_changed', { organismeId: a.organisme_id, acteId: a.id, ctx });
        return { id: l.id, items: await svc.liens(a.id) };
      } catch (e) { if (e.code === '23505') throw E.conflict('Cette délibération est déjà liée'); throw e; }
    },
    async retirerLien(ctx, organismeId, acteId, lienId) {
      const a = await svc.load(ctx, organismeId, acteId, { edit: true });
      const r = await db.get('DELETE FROM acte_liens WHERE id = $1 AND acte_id = $2 RETURNING cible_acte_id', [lienId, a.id]);
      if (!r) throw E.notFound('Lien introuvable');
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'acte.lien.retrait', entity: 'acte_liens', entityId: lienId, before: { cibleActeId: r.cible_acte_id } });
      await bus.emit('acte.lien_changed', { organismeId: a.organisme_id, acteId: a.id, ctx });
      return { items: await svc.liens(a.id) };
    },

    async get(ctx, organismeId, id) {
      const a = await svc.load(ctx, organismeId, id);
      const [delibs, editable] = await Promise.all([svc.deliberations(a.id), acl.canEdit(ctx, a)]);
      const comp = await svc.completeness(a);
      const champs = late.champs ? await late.champs.pourActe(ctx, a) : [];
      const typeInfo = { code: a.type_code ?? null, libelle: a.type_libelle ?? null, meta: (await db.get('SELECT meta FROM ref_items WHERE id = $1', [a.type_id]))?.meta || {} };
      const acte = (await svc.attachSeance([toActe(a)]))[0]; // séance visée (date et instance) pour la fiche
      return { ...acte, typeInfo, champs, deliberations: delibs, liens: await svc.liens(a.id),
        droits: { modifier: editable, administrer: acl.isAdmin(ctx, a.organisme_id) }, completude: comp, odj: late.odj ? await late.odj.positionsOf(a.id) : [] };
    },

    async list(ctx, organismeId, f = {}) {
      const org = requireOrg(organismeId);
      const vis = await acl.visibilitySql(ctx, org, 2);
      const p = [org, ...vis.params]; const w = ['a.organisme_id = $1', vis.where];
      const add = (v) => { p.push(v); return `$${p.length}`; };
      if (f.statut) w.push(`a.statut = ${add(f.statut)}`);
      if (f.typeId) w.push(`a.type_id = ${add(f.typeId)}`);
      if (f.directionCode) w.push(`a.direction_code = ${add(f.directionCode)}`);
      if (f.seanceId) w.push(`(a.seance_id = ${add(f.seanceId)} OR a.seance_visee_id = $${p.length})`);
      if (f.scope === 'mine') w.push(`(a.redacteur = ${add(ctx.username)} OR a.co_redacteurs ? $${p.length})`);
      if (f.scope === 'following') w.push(`a.participants ? ${add(ctx.username)}`);
      if (f.q) w.push(`(a.titre ILIKE ${add('%' + f.q.replace(/[%_]/g, '\\$&') + '%')} OR a.numero_suivi::text = ${add(f.q)})`);
      if (!f.includeAbandoned) w.push("a.statut <> 'abandonne'");
      const where = w.join(' AND ');
      const total = (await db.get(`SELECT count(*)::int AS n FROM actes a WHERE ${where}`, p)).n;
      const rows = await db.all(`SELECT a.*, t.code AS type_code, t.libelle AS type_libelle FROM actes a LEFT JOIN ref_items t ON t.id = a.type_id WHERE ${where} ORDER BY a.updated_at DESC, a.id DESC LIMIT ${add(f.limit || 50)} OFFSET ${add(f.offset || 0)}`, p);
      return { total, limit: f.limit || 50, offset: f.offset || 0, items: await svc.attachSeance(rows.map(toActe)) };
    },

    async update(ctx, organismeId, id, patch) {
      const before = await svc.load(ctx, organismeId, id);
      const org = before.organisme_id;
      const seanceOnly = Object.keys(patch).every((k) => k === 'seanceViseeId');
      let allowed = await acl.canEdit(ctx, before);
      // CRE-09 : tout valideur de la hiérarchie peut modifier la séance visée pendant le circuit
      if (!allowed && seanceOnly && (before.participants.includes(ctx.username) || acl.isAdmin(ctx, org))) allowed = true;
      if (!allowed) throw E.forbidden('Vous ne pouvez pas modifier cet acte à ce stade');
      if (before.statut === 'abandonne') throw E.conflict('Acte abandonné');

      await svc.checkRefs(org, patch);
      const set = []; const p = [id]; const add = (col, v, cast = '') => { p.push(v); set.push(`${col} = $${p.length}${cast}`); };
      if (patch.titre !== undefined) add('titre', patch.titre);
      if (patch.typeId !== undefined) add('type_id', (await refs.require('type_acte', patch.typeId, org)).id);
      if (patch.natureId !== undefined) add('nature_id', patch.natureId === null ? null : (await refs.require('nature', patch.natureId, org)).id);
      if (patch.matiereId !== undefined) add('matiere_id', patch.matiereId === null ? null : (await refs.require('matiere', patch.matiereId, org, { leaf: true })).id);
      if (patch.rubriqueId !== undefined) add('rubrique_id', patch.rubriqueId === null ? null : (await refs.require('rubrique', patch.rubriqueId, org)).id);
      if (patch.incidenceFinanciere !== undefined) add('incidence_financiere', patch.incidenceFinanciere);
      if (patch.montant !== undefined) add('montant', patch.montant);
      if (patch.rapporteurId !== undefined) add('rapporteur_id', patch.rapporteurId);
      if (patch.rapporteurComplId !== undefined) add('rapporteur_compl_id', patch.rapporteurComplId);
      if (patch.seanceViseeId !== undefined) add('seance_visee_id', patch.seanceViseeId);
      if (patch.urgence !== undefined) add('urgence', patch.urgence);
      if (patch.dateLimite !== undefined) add('date_limite', patch.dateLimite);
      if (patch.confidentialite !== undefined) add('confidentialite', patch.confidentialite);
      if (patch.commentaireInitial !== undefined) add('commentaire_initial', patch.commentaireInitial);
      if (patch.custom !== undefined) {
        const c = late.champs ? await late.champs.valider(ctx, before, patch.custom, before.custom) : { ...patch.custom };
        if (before.custom?.entrainement) c.entrainement = true; else delete c.entrainement; // le marqueur du bac à sable ne s'enlève ni ne s'ajoute à la main
        add('custom', JSON.stringify(c), '::jsonb');
      }
      if (patch.coRedacteurs !== undefined) {
        if (before.redacteur !== ctx.username && !acl.isAdmin(ctx, org)) throw E.forbidden('Seul le rédacteur désigne ses co-rédacteurs');
        add('co_redacteurs', JSON.stringify([...new Set(patch.coRedacteurs.map((u) => u.toLowerCase()))].filter((u) => u !== before.redacteur)), '::jsonb');
      }
      if (patch.serviceCode !== undefined) {
        if (!(await redaction.canDraft(ctx, org, before.direction_code, patch.serviceCode)).ok) throw E.forbidden('Service non autorisé');
        const l = await svc.labels(before.direction_code, patch.serviceCode, ctx.agent);
        add('service_code', patch.serviceCode); add('service_label', l.serviceLabel);
      }
      if (!set.length) return toActe(before);
      const after = await db.get(`UPDATE actes SET ${set.join(', ')} WHERE id = $1 RETURNING *`, p);
      await audit.log(ctx, { organismeId: org, action: 'acte.update', entity: 'actes', entityId: id, before: toActe(before), after: toActe(after) });
      const drivers = DRIVERS.filter((k) => patch[k] !== undefined && JSON.stringify(toActe(before)[k]) !== JSON.stringify(toActe(after)[k]));
      if (drivers.length) await bus.emit('acte.driver_changed', { organismeId: org, acteId: id, drivers, ctx });
      if (patch.seanceViseeId !== undefined && before.seance_visee_id !== after.seance_visee_id) await bus.emit('acte.seance_changed', { organismeId: org, acteId: id, from: before.seance_visee_id, to: after.seance_visee_id, ctx });
      return toActe(after);
    },

    /**
     * Mode « dossier assisté » : un guide pas à pas accompagne la rédaction. L'état vit dans `custom.assiste`
     * (comme le marqueur `custom.entrainement`) : `actif`, étapes conseillées passées (`passees`), accueil vu.
     * Seuls `assiste` et les autres clés existantes sont touchées : les champs personnalisés ne sont jamais écrasés.
     */
    async setAssiste(ctx, organismeId, id, { actif, passees, bienvenue } = {}) {
      const a = await svc.load(ctx, organismeId, id, { edit: true });
      const custom = { ...(a.custom || {}) };
      const cur = custom.assiste && typeof custom.assiste === 'object' && !Array.isArray(custom.assiste) ? custom.assiste : {};
      const next = { ...cur };
      if (actif !== undefined) next.actif = !!actif;
      if (passees !== undefined) next.passees = [...new Set(passees)];
      if (bienvenue !== undefined) next.bienvenue = !!bienvenue;
      custom.assiste = next;
      const after = await db.get('UPDATE actes SET custom = $2::jsonb WHERE id = $1 RETURNING *', [id, JSON.stringify(custom)]);
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'acte.assiste', entity: 'actes', entityId: id, after: { actif: next.actif, passees: next.passees } });
      return toActe(after);
    },

    // ---- délibérations d'un dossier (D5) ------------------------------------------------------------------------------
    async addDeliberation(ctx, organismeId, acteId, { titre }) {
      const a = await svc.load(ctx, organismeId, acteId, { edit: true });
      const ordre = (await db.get('SELECT COALESCE(MAX(ordre), 0) + 1 AS n FROM deliberations WHERE acte_id = $1', [a.id])).n;
      const d = await db.get('INSERT INTO deliberations (acte_id, ordre, titre) VALUES ($1,$2,$3) RETURNING *', [a.id, ordre, titre]);
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'deliberation.add', entity: 'deliberations', entityId: d.id, after: toDelib(d) });
      await bus.emit('deliberation.added', { organismeId: a.organisme_id, acteId: a.id, deliberationId: d.id, ctx });
      return toDelib(d);
    },
    async updateDeliberation(ctx, organismeId, acteId, id, { titre, ordre }) {
      const a = await svc.load(ctx, organismeId, acteId, { edit: true });
      const d = await db.get('UPDATE deliberations SET titre = COALESCE($3, titre), ordre = COALESCE($4, ordre) WHERE id = $1 AND acte_id = $2 RETURNING *', [id, a.id, titre ?? null, ordre ?? null]);
      if (!d) throw E.notFound('Délibération introuvable');
      return toDelib(d);
    },
    async deleteDeliberation(ctx, organismeId, acteId, id) {
      const a = await svc.load(ctx, organismeId, acteId, { edit: true });
      const type = await db.get('SELECT meta FROM ref_items WHERE id = $1', [a.type_id]);
      const n = (await db.get('SELECT count(*)::int AS n FROM deliberations WHERE acte_id = $1', [a.id])).n;
      if (n <= Math.max(1, type?.meta?.minDeliberations ?? 1)) throw E.conflict('Un dossier doit conserver au moins une délibération');
      const d = await db.get('DELETE FROM deliberations WHERE id = $1 AND acte_id = $2 RETURNING *', [id, a.id]);
      if (!d) throw E.notFound('Délibération introuvable');
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'deliberation.delete', entity: 'deliberations', entityId: id, before: toDelib(d) });
    },

    // ---- abandon / réactivation / duplication ---------------------------------------------------------------------------
    async abandon(ctx, organismeId, id, motif) {
      const a = await svc.load(ctx, organismeId, id);
      const mayAbandon = a.redacteur === ctx.username || acl.isAdmin(ctx, a.organisme_id) || (a.participants || []).includes(ctx.username);
      if (!mayAbandon) throw E.forbidden("Vous ne pouvez pas abandonner cet acte");
      if (['abandonne', 'adopte', 'rejete', 'transmis', 'ar_recu', 'publie', 'executoire', 'archive'].includes(a.statut)) throw E.conflict(`Un acte « ${a.statut} » ne peut pas être abandonné`);
      const r = await db.get("UPDATE actes SET statut = 'abandonne', abandoned_at = now(), abandon_motif = $2 WHERE id = $1 RETURNING *", [id, motif]);
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'acte.abandon', entity: 'actes', entityId: id, before: { statut: a.statut }, after: { statut: 'abandonne', motif } });
      await bus.emit('acte.abandoned', { organismeId: a.organisme_id, acteId: id, motif, previousStatut: a.statut, ctx });
      return toActe(r);
    },
    async reactivate(ctx, organismeId, id) {
      const a = await svc.raw(organismeId, id);
      if (!acl.isAdmin(ctx, a.organisme_id)) throw E.forbidden("Réservé à l'administrateur ou au SCC");
      if (a.statut !== 'abandonne') throw E.conflict("L'acte n'est pas abandonné");
      const r = await db.get("UPDATE actes SET statut = 'brouillon', abandoned_at = NULL, abandon_motif = NULL, current_step_key = NULL, path = NULL, participants = '[]'::jsonb WHERE id = $1 RETURNING *", [id]);
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'acte.reactivate', entity: 'actes', entityId: id });
      return toActe(r);
    },
    /** Un acte est « dans le circuit » s'il a une étape courante. */
    async _circuitActif(acteId) { return !!(await db.get("SELECT 1 AS x FROM step_instances WHERE acte_id = $1 AND status = 'current'", [acteId])); },

    /** Supprime un acte HORS circuit (confirmation côté interface). Un acte déjà passé au conseil n'est supprimable que par l'administrateur ou le SCC. */
    async supprimer(ctx, organismeId, id) {
      const a = await svc.load(ctx, organismeId, id);
      const PASSE_CM = ['adopte', 'archive', 'executoire', 'publie', 'transmis', 'ar_recu', 'rejete', 'retire'];
      if (PASSE_CM.includes(a.statut)) {
        if (!acl.isAdmin(ctx, a.organisme_id)) throw E.forbidden("Seuls l'administrateur et le SCC peuvent supprimer un acte déjà passé au conseil");
      } else if (!(a.redacteur === ctx.username || acl.isAdmin(ctx, a.organisme_id))) {
        throw E.forbidden('Vous ne pouvez pas supprimer cet acte');
      }
      if (await svc._circuitActif(a.id)) throw E.conflict("Cet acte est dans le circuit : utilisez « Rappeler » (avec motif), la suppression casserait le circuit");
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'acte.delete', entity: 'actes', entityId: id, before: { titre: a.titre, statut: a.statut } });
      try { await db.run('DELETE FROM actes WHERE id = $1 AND organisme_id = $2', [id, a.organisme_id]); }
      catch (e) { if (e.code === '23503') throw E.conflict('Cet acte est référencé ailleurs : il ne peut pas être supprimé'); throw e; }
      await bus.emit('acte.deleted', { organismeId: a.organisme_id, acteId: id, ctx });
      return { supprime: id };
    },

    /** Rappelle un acte DANS le circuit : motif obligatoire, casse le circuit et prévient les intervenants. Nouvel état « rappele ». */
    async rappeler(ctx, organismeId, id, motif) {
      const a = await svc.load(ctx, organismeId, id);
      if (!(a.redacteur === ctx.username || acl.isAdmin(ctx, a.organisme_id))) throw E.forbidden('Vous ne pouvez pas rappeler cet acte');
      const m = String(motif || '').trim(); if (!m) throw E.badRequest('Un motif de rappel est obligatoire');
      if (!(await svc._circuitActif(a.id))) throw E.conflict("Cet acte n'est pas dans le circuit : il peut être supprimé directement");
      await db.tx(async (q) => {
        await q.run("UPDATE step_instances SET status = 'returned', reason = $2, acted_by = $3, acted_at = now() WHERE acte_id = $1 AND status = 'current'", [a.id, m, ctx.username]);
        await q.run("UPDATE actes SET statut = 'rappele', current_step_key = NULL, rappel_motif = $2, rappel_at = now() WHERE id = $1", [a.id, m]);
      });
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'acte.rappele', entity: 'actes', entityId: id, before: { statut: a.statut, etape: a.current_step_key }, after: { statut: 'rappele', motif: m } });
      await bus.emit('acte.rappele', { organismeId: a.organisme_id, acteId: id, motif: m, ctx });
      return toActe(await db.get('SELECT * FROM actes WHERE id = $1', [id]));
    },

    async duplicate(ctx, organismeId, id) {
      const src = await svc.load(ctx, organismeId, id);
      const copy = await svc.create(ctx, src.organisme_id, {
        typeId: src.type_id, titre: `${src.titre} (copie)`, directionCode: src.direction_code, serviceCode: src.service_code, natureId: src.nature_id,
        matiereId: src.matiere_id, rubriqueId: src.rubrique_id, incidenceFinanciere: src.incidence_financiere, montant: src.montant === null ? undefined : Number(src.montant),
        confidentialite: src.confidentialite, custom: src.custom,
      });
      await bus.emit('acte.duplicated', { organismeId: src.organisme_id, sourceId: src.id, acteId: copy.id, ctx });
      return copy;
    },

    /**
     * Crée un dossier en reprenant TOUT d'une délibération passée (modèle) : champs, textes (exposé, visas, dispositif),
     * délibérations et annexes. Les fichiers d'annexes sont partagés (contenu immuable) : aucune copie inutile.
     * La direction reste celle du rédacteur (on ne peut pas rédiger pour une autre direction) ; les mots-clés sont mémorisés.
     */
    async creerDepuisModele(ctx, organismeId, { modeleId, typeId, titre, serviceLabel, motsCles } = {}) {
      const org = requireOrg(organismeId);
      const modele = await svc.load(ctx, org, modeleId);
      const custom = { ...(modele.custom || {}) };
      const liste = (Array.isArray(motsCles) ? motsCles : String(motsCles || '').split(/[,;]+/)).map((m) => String(m).trim()).filter(Boolean).slice(0, 20);
      if (liste.length) custom.motsCles = liste;
      const titreNew = String(titre || '').trim() || modele.titre;
      const copy = await svc.create(ctx, org, {
        typeId: typeId ?? modele.type_id, titre: titreNew.slice(0, 500),
        ...(serviceLabel?.trim() ? { serviceLabel: serviceLabel.trim() } : {}),
        natureId: modele.nature_id, matiereId: modele.matiere_id, rubriqueId: modele.rubrique_id,
        incidenceFinanciere: modele.incidence_financiere,
        montant: modele.montant === null || modele.montant === undefined ? undefined : Number(modele.montant),
        confidentialite: modele.confidentialite, custom,
      });
      const srcDelibs = await db.all('SELECT ordre, titre FROM deliberations WHERE acte_id = $1 ORDER BY ordre, id', [modele.id]);
      const dst = await db.all('SELECT id FROM deliberations WHERE acte_id = $1 ORDER BY ordre, id', [copy.id]);
      for (let i = dst.length; i < srcDelibs.length; i++) await db.run('INSERT INTO deliberations (acte_id, ordre, titre) VALUES ($1,$2,$3)', [copy.id, srcDelibs[i].ordre, srcDelibs[i].titre]);
      await late.texts.copyTexts(modele.id, copy.id);
      await db.run(
        `INSERT INTO annexes (acte_id, titre, ordre, file_id, publiable, communicable, transmissible, created_by)
         SELECT $1, titre, ordre, file_id, publiable, communicable, transmissible, $2 FROM annexes WHERE acte_id = $3`,
        [copy.id, ctx.username, modele.id]);
      await bus.emit('acte.duplicated', { organismeId: org, sourceId: modele.id, acteId: copy.id, ctx });
      await audit.log(ctx, { organismeId: org, action: 'acte.depuis_modele', entity: 'actes', entityId: copy.id, after: { modeleId: modele.id, motsCles: liste } });
      return copy;
    },

    /** Contrôle de complétude (CRE-02) : ce qui manque avant l'envoi au circuit. */
    async completeness(a) {
      const type = await db.get('SELECT meta FROM ref_items WHERE id = $1', [a.type_id]);
      const missing = [];
      const need = (ok, code, label) => { if (!ok) missing.push({ code, label }); };
      need(!!a.titre?.trim(), 'titre', 'Titre');
      need(!!a.matiere_id, 'matiere', 'Matière');
      need(a.incidence_financiere !== null && a.incidence_financiere !== undefined, 'incidence_financiere', 'Incidence financière');
      need(!!a.rubrique_id, 'rubrique', 'Rubrique');
      need(!!a.nature_id, 'nature', 'Nature');
      if (!type?.meta?.signature) need(!!a.rapporteur_id, 'rapporteur', 'Élu rapporteur'); // décision / arrêté : pas d'élu rapporteur
      const n = (await db.get('SELECT count(*)::int AS n FROM deliberations WHERE acte_id = $1', [a.id])).n;
      need(n >= Math.max(1, type?.meta?.minDeliberations ?? 1), 'deliberation', 'Au moins une délibération');
      if (type?.meta?.autorisations) {
        const nl = (await db.get('SELECT count(*)::int AS n FROM acte_liens WHERE acte_id = $1', [a.id])).n;
        need(nl > 0, 'autorisation', 'Au moins une délibération d\'autorisation liée');
      }
      if (late.texts) for (const m of await late.texts.missingTexts(a, type?.meta)) missing.push(m);
      if (late.champs) for (const m of await late.champs.manquants(a)) missing.push(m);
      return { complete: missing.length === 0, missing };
    },
  };
  return svc;
}

module.exports = { createActes, toActe, DRIVERS };
