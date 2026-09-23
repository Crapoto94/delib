/**
 * Instances et séances (section 16.1) : dates clés pré-remplies par décalage paramétrable (NOT-01, NOT-02, SEA-02),
 * séance visée contrôlée à l'écriture, report à la séance suivante avec trace (SEA-05), liste « hors délai » (SEA-08).
 * L'ordre du jour et la numérotation sont dans odj.service.js.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const { addBusinessDays, addCalendarDays, parisParts, parisToDate } = require('../../shared/time');

const SEANCE_TYPES = ['ordinaire', 'extraordinaire', 'budgetaire', 'autre'];
const STATUTS = ['planifiee', 'convoquee', 'tenue', 'close', 'annulee'];
/** Rétroplanning par défaut : chaque étape est à `jours` jours OUVRÉS de la suivante (la dernière = le conseil). */
const RETRO_DEFAUT = [
  { code: 'soumissions', label: 'Clôture des soumissions', jours: 7 },
  { code: 'modifications', label: 'Clôture des modifications', jours: 3 },
  { code: 'dga', label: 'Vérification DGA', jours: 3 },
  { code: 'dgs', label: 'Vérification DGS', jours: 3 },
  { code: 'commissions', label: 'Commissions', jours: 7 },
  { code: 'conseil', label: 'Conseil municipal', jours: 0 },
];
const NEXT = { planifiee: ['convoquee', 'annulee', 'tenue'], convoquee: ['planifiee', 'tenue', 'annulee'], tenue: ['close'], close: [], annulee: ['planifiee'] };
const VISEABLE = ['planifiee', 'convoquee'];

/** « 2026-10-14 » = fin de journée à Paris ; un horodatage complet est conservé tel quel. */
function asDeadline(v) {
  if (v === null || v === undefined || v === '') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return parisToDate(y, m, d, 23, 59); }
  return new Date(v);
}

const toI = (r) => ({ id: r.id, organismeId: r.organisme_id, code: r.code, nom: r.nom, kind: r.kind, commissionId: r.commission_id, numbering: r.numbering, actif: r.actif });
const toS = (r) => ({
  id: r.id, organismeId: r.organisme_id, instanceId: r.instance_id, instance: r.instance_nom, type: r.type, dateSeance: r.date_seance, lieu: r.lieu, statut: r.statut,
  dateLimiteRedaction: r.date_limite_redaction, dateLimiteDgs: r.date_limite_dgs, dateLimiteMadCommissions: r.date_limite_mad_commissions, dateEnvoiConvocation: r.date_envoi_convocation,
  kind: r.instance_kind, commissionId: r.commission_id, commission: r.commission_nom, dureeMinutes: r.duree_minutes,
  teams: r.teams_join_url ? { joinUrl: r.teams_join_url, auto: !!r.teams_event_id, invited: r.teams_invited } : null,
  jalonsExtra: r.jalons_extra, numbering: r.numbering, odjStatut: r.odj_statut, odjArreteAt: r.odj_arrete_at, odjArretePar: r.odj_arrete_par, createdAt: r.created_at,
  ...(r.nb_actes_attente !== undefined ? { actesEnAttente: r.nb_actes_attente } : {}),
});

function createSeances({ db, audit, actes, acl, settings, bus, late, meeting, log }) {
  const holidaysOf = async (orgId) => new Set((await db.all("SELECT to_char(day,'YYYY-MM-DD') AS d FROM holidays WHERE organisme_id IS NULL OR organisme_id = $1", [orgId])).map((r) => r.d));

  const svc = {
    STATUTS, SEANCE_TYPES, asDeadline,

    // ---------------------------------------------------------------------------------------- instances
    async instances(organismeId) { return (await db.all('SELECT * FROM instances WHERE organisme_id = $1 ORDER BY kind, nom', [requireOrg(organismeId)])).map(toI); },
    async createInstance(ctx, organismeId, b) {
      const org = requireOrg(organismeId);
      if (b.commissionId && !(await db.get('SELECT 1 AS x FROM commissions WHERE id = $1 AND organisme_id = $2', [b.commissionId, org]))) throw E.badRequest('Commission inconnue');
      try {
        const r = await db.get('INSERT INTO instances (organisme_id, code, nom, kind, commission_id, numbering) VALUES ($1,$2,$3,$4,$5,COALESCE($6::jsonb, \'{"pattern":"{ANNEE}-{N_SEANCE}-{ORDRE:03}"}\'::jsonb)) RETURNING *',
          [org, b.code, b.nom, b.kind || 'conseil', b.commissionId ?? null, b.numbering ? JSON.stringify(b.numbering) : null]);
        await audit.log(ctx, { organismeId: org, action: 'instance.create', entity: 'instances', entityId: r.id, after: toI(r) });
        return toI(r);
      } catch (e) { if (e.code === '23505') throw E.conflict('Une instance porte déjà ce code'); throw e; }
    },
    async updateInstance(ctx, organismeId, id, b) {
      const org = requireOrg(organismeId);
      const set = []; const p = [id, org];
      for (const [k, col, j] of [['nom', 'nom'], ['actif', 'actif'], ['numbering', 'numbering', true]]) if (b[k] !== undefined) { p.push(j ? JSON.stringify(b[k]) : b[k]); set.push(`${col} = $${p.length}${j ? '::jsonb' : ''}`); }
      if (!set.length) throw E.badRequest('Rien à modifier');
      const before = await db.get('SELECT * FROM instances WHERE id = $1 AND organisme_id = $2', [id, org]);
      if (!before) throw E.notFound('Instance introuvable');
      const r = await db.get(`UPDATE instances SET ${set.join(', ')} WHERE id = $1 AND organisme_id = $2 RETURNING *`, p);
      await audit.log(ctx, { organismeId: org, action: 'instance.update', entity: 'instances', entityId: id, before: toI(before), after: toI(r) });
      return toI(r);
    },
    async ensureDefaultInstance(orgId) {
      if ((await db.get('SELECT count(*)::int AS n FROM instances WHERE organisme_id = $1', [orgId])).n) return false;
      await db.run("INSERT INTO instances (organisme_id, code, nom, kind) VALUES ($1, 'conseil-municipal', 'Conseil municipal', 'conseil')", [orgId]);
      return true;
    },

    // ------------------------------------------------------------------------------------------ séances
    /** Rétroplanning de l'organisme (configuré, sinon les étapes par défaut) et son mode de calcul. */
    async retroplanning(organismeId) {
      const cfg = await settings.resolve(organismeId);
      return { etapes: svc.retroConfig(cfg) || RETRO_DEFAUT, defaut: !svc.retroConfig(cfg), calendaire: svc.retroCalendaire(cfg) };
    },

    /** Rétroplanning configuré (liste d'étapes) s'il existe, sinon null. */
    retroConfig(cfg) {
      const v = cfg['seances.retroplanning']?.value;
      const etapes = Array.isArray(v) ? v : v?.etapes;
      return Array.isArray(etapes) && etapes.length ? etapes : null;
    },

    /** Mode de calcul : `true` = jours calendaires (week-ends et jours fériés comptés), `false` (défaut) = jours ouvrés. */
    retroCalendaire(cfg) {
      const v = cfg['seances.retroplanning']?.value;
      return v?.calendaire === true || cfg['seances.retroplanning.calendaire']?.value === true;
    },

    /**
     * Dates clés proposées d'après la date de séance.
     *  - Si un rétroplanning est configuré (`seances.retroplanning`) : chaque étape est à J-x jours (OUVRÉS, ou CALENDAIRES
     *    si `calendaire: true`) de la suivante, la dernière étant le jour du conseil. Les codes `soumissions`/`redaction`,
     *    `dgs`, `commissions`/`mad`, `convocation` alimentent les champs fixes de la séance ; les autres deviennent des
     *    jalons complémentaires.
     *  - Sinon : les décalages historiques (`seances.decalage.*`).
     */
    async proposeDates(organismeId, dateSeance, typeActeId) {
      const cfg = await settings.resolve(organismeId, { typeActeId });
      const holidays = await holidaysOf(organismeId);
      const calendaire = svc.retroCalendaire(cfg);
      const addDays = (d, n) => (calendaire ? addCalendarDays(d, n) : addBusinessDays(d, n, holidays));
      const p = parisParts(new Date(dateSeance));
      const day = new Date(Date.UTC(p.y, p.m - 1, p.d));
      const eod = (dt) => parisToDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), 23, 59);
      const etapes = svc.retroConfig(cfg);
      if (etapes) {
        const jalons = [];
        let d = day;
        for (let i = etapes.length - 1; i >= 0; i--) {
          const e = etapes[i];
          if (i < etapes.length - 1) d = addDays(d, -Math.max(0, Number(e.jours) || 0));
          jalons[i] = { code: e.code, label: e.label, jours: Number(e.jours) || 0, date: eod(d) };
        }
        const byCode = (codes) => jalons.find((j) => codes.includes(j.code))?.date ?? null;
        return {
          jalons,
          dateLimiteRedaction: byCode(['soumissions', 'redaction', 'depot']),
          dateLimiteDgs: byCode(['dgs', 'verification_dgs']),
          dateLimiteMadCommissions: byCode(['commissions', 'mad', 'mad_commissions']),
          dateEnvoiConvocation: byCode(['convocation']),
        };
      }
      const get = (k, d) => Number(cfg[k]?.value ?? d);
      const conv = new Date(day.getTime() - (get('seances.decalage.convocation', 5) + 1) * 86400000); // « jours francs » : veille comprise
      const out = {
        dateLimiteRedaction: eod(addDays(day, -get('seances.decalage.redaction', 30))),
        dateLimiteDgs: eod(addDays(day, -get('seances.decalage.dgs', 20))),
        dateLimiteMadCommissions: eod(addDays(day, -get('seances.decalage.mad', 12))),
        dateEnvoiConvocation: eod(conv),
      };
      out.jalons = [
        { code: 'redaction', label: 'Clôture des soumissions (rédaction)', date: out.dateLimiteRedaction },
        { code: 'dgs', label: 'Vérification DGS', date: out.dateLimiteDgs },
        { code: 'mad_commissions', label: 'Commissions', date: out.dateLimiteMadCommissions },
        { code: 'convocation', label: 'Envoi de la convocation', date: out.dateEnvoiConvocation },
        { code: 'seance', label: 'Conseil municipal', date: eod(day) },
      ];
      return out;
    },

    async create(ctx, organismeId, b) {
      const org = requireOrg(organismeId);
      const inst = await db.get('SELECT * FROM instances WHERE id = $1 AND organisme_id = $2 AND actif', [b.instanceId, org]);
      if (!inst) throw E.badRequest('Instance inconnue ou inactive dans cet organisme');
      const date = new Date(b.dateSeance);
      const prop = await svc.proposeDates(org, date);
      const pick = (k) => (b[k] === undefined ? prop[k] : asDeadline(b[k]));
      const r = await db.get(
        `INSERT INTO seances (organisme_id, instance_id, type, date_seance, lieu, date_limite_redaction, date_limite_dgs, date_limite_mad_commissions, date_envoi_convocation, jalons_extra, numbering, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12) RETURNING *`,
        [org, inst.id, b.type || 'ordinaire', date, b.lieu ?? null, pick('dateLimiteRedaction'), pick('dateLimiteDgs'), pick('dateLimiteMadCommissions'), pick('dateEnvoiConvocation'),
          JSON.stringify(b.jalonsExtra || []), b.numbering ? JSON.stringify(b.numbering) : null, ctx.username]);
      await audit.log(ctx, { organismeId: org, action: 'seance.create', entity: 'seances', entityId: r.id, after: toS({ ...r, instance_nom: inst.nom }) });
      return svc.get(org, r.id);
    },

    async get(organismeId, id) {
      const r = await db.get(
        `SELECT s.*, i.nom AS instance_nom, i.kind AS instance_kind, i.commission_id, c.nom AS commission_nom,
                (SELECT count(*)::int FROM actes a WHERE a.seance_visee_id = s.id AND a.seance_id IS NULL AND a.statut NOT IN ('abandonne','retire')) AS nb_actes_attente
         FROM seances s JOIN instances i ON i.id = s.instance_id LEFT JOIN commissions c ON c.id = i.commission_id WHERE s.id = $1 AND s.organisme_id = $2`, [id, requireOrg(organismeId)]);
      if (!r) throw E.notFound('Séance introuvable');
      return { ...toS(r), jalons: await svc.jalons(r) };
    },

    async list(organismeId, { instanceId, statut, from, to, kind, commissionId, limit = 100, offset = 0 } = {}) {
      const org = requireOrg(organismeId);
      const p = [org]; const w = ['s.organisme_id = $1'];
      const add = (v) => { p.push(v); return `$${p.length}`; };
      if (instanceId) w.push(`s.instance_id = ${add(instanceId)}`);
      if (statut) w.push(`s.statut = ${add(statut)}`);
      if (from) w.push(`s.date_seance >= ${add(from)}`);
      if (to) w.push(`s.date_seance <= ${add(to)}`);
      if (kind) w.push(`i.kind = ${add(kind)}`);
      if (commissionId) w.push(`i.commission_id = ${add(commissionId)}`);
      const total = (await db.get(`SELECT count(*)::int AS n FROM seances s JOIN instances i ON i.id = s.instance_id WHERE ${w.join(' AND ')}`, p)).n;
      const rows = await db.all(
        `SELECT s.*, i.nom AS instance_nom, i.kind AS instance_kind, i.commission_id, c.nom AS commission_nom,
                (SELECT count(*)::int FROM actes a WHERE a.seance_visee_id = s.id AND a.seance_id IS NULL AND a.statut NOT IN ('abandonne','retire')) AS nb_actes_attente
         FROM seances s JOIN instances i ON i.id = s.instance_id LEFT JOIN commissions c ON c.id = i.commission_id WHERE ${w.join(' AND ')} ORDER BY s.date_seance DESC LIMIT ${add(limit)} OFFSET ${add(offset)}`, p);
      return { total, items: rows.map(toS) };
    },

    /** Jalons complémentaires et principaux, avec état (passé / à venir). */
    async jalons(r) {
      const now = Date.now();
      const base = [['redaction', 'Date limite de rédaction', r.date_limite_redaction], ['dgs', 'Date limite de validation DGS', r.date_limite_dgs],
        ['mad_commissions', 'Mise à disposition des commissions', r.date_limite_mad_commissions], ['convocation', 'Envoi de la convocation', r.date_envoi_convocation], ['seance', 'Séance', r.date_seance]];
      return [...base.map(([code, label, date]) => ({ code, label, date })), ...(r.jalons_extra || []).map((j) => ({ code: j.code, label: j.label, date: j.date }))]
        .filter((j) => j.date).sort((a, b) => new Date(a.date) - new Date(b.date)).map((j) => ({ ...j, passe: new Date(j.date).getTime() < now }));
    },

    async update(ctx, organismeId, id, b) {
      const org = requireOrg(organismeId);
      const before = await svc.get(org, id);
      if (['close', 'annulee'].includes(before.statut) && b.statut === undefined) throw E.conflict('Séance close ou annulée : non modifiable');
      const set = []; const p = [id, org];
      const add = (col, v, cast = '') => { p.push(v); set.push(`${col} = $${p.length}${cast}`); };
      if (b.dateSeance !== undefined) add('date_seance', new Date(b.dateSeance));
      if (b.type !== undefined) add('type', b.type);
      if (b.lieu !== undefined) add('lieu', b.lieu);
      if (b.dureeMinutes !== undefined) add('duree_minutes', b.dureeMinutes);
      for (const [k, col] of [['dateLimiteRedaction', 'date_limite_redaction'], ['dateLimiteDgs', 'date_limite_dgs'], ['dateLimiteMadCommissions', 'date_limite_mad_commissions'], ['dateEnvoiConvocation', 'date_envoi_convocation']]) {
        if (b[k] !== undefined) add(col, asDeadline(b[k]));
      }
      if (b.jalonsExtra !== undefined) add('jalons_extra', JSON.stringify(b.jalonsExtra), '::jsonb');
      if (b.numbering !== undefined) add('numbering', b.numbering ? JSON.stringify(b.numbering) : null, '::jsonb');
      if (b.statut !== undefined && b.statut !== before.statut) {
        if (!NEXT[before.statut].includes(b.statut)) throw E.conflict(`Transition « ${before.statut} » → « ${b.statut} » impossible`);
        if (b.statut === 'convoquee' && before.odjStatut === 'en_preparation') throw E.conflict("L'ordre du jour doit être arrêté avant la convocation");
        add('statut', b.statut);
      }
      if (!set.length) return before;
      await db.run(`UPDATE seances SET ${set.join(', ')} WHERE id = $1 AND organisme_id = $2`, p);
      const after = await svc.get(org, id);
      await audit.log(ctx, { organismeId: org, action: 'seance.update', entity: 'seances', entityId: id, before, after });
      if (after.kind === 'commission') {
        const dateChanged = b.dateSeance !== undefined || b.lieu !== undefined || b.dureeMinutes !== undefined;
        const row = await db.get('SELECT teams_event_id, date_seance, duree_minutes, lieu FROM seances WHERE id = $1', [id]);
        if (row?.teams_event_id && (dateChanged || b.statut === 'annulee')) {
          try {
            if (b.statut === 'annulee') await meeting.cancel(row.teams_event_id);
            else { const st = new Date(row.date_seance); await meeting.update(row.teams_event_id, { subject: after.instance, start: st.toISOString().replace('Z', ''), end: new Date(st.getTime() + (row.duree_minutes || 120) * 60000).toISOString().replace('Z', ''), lieu: row.lieu }); }
          } catch (e) { log.warn({ err: e.message }, 'synchronisation Teams : échec (la réunion Teams n\'a pas été mise à jour)'); }
        }
        if (dateChanged || b.statut === 'annulee') await svc.notifyReunion(id, b.statut === 'annulee' ? 'annulee' : 'modifiee', ctx);
      }
      // la date limite a bougé : les rappels de tous les actes visant la séance sont recalculés d'eux-mêmes (NOT-05)
      await bus.emit('seance.updated', { organismeId: org, seanceId: id, before, after, ctx });
      return after;
    },

    // ------------------------------------------------------------------------------ suppression
    /** Actes que la suppression d'une séance touche : ceux qui la visent ou sont à son ordre du jour, et ne sont pas terminés. */
    async _actesTouches(q, org, id) {
      return q.all(`SELECT id, numero_suivi, titre, statut, seance_id, seance_visee_id FROM actes
                    WHERE organisme_id = $1 AND (seance_id = $2 OR seance_visee_id = $2)
                      AND statut NOT IN ('adopte','rejete','abandonne','archive','executoire','publie','transmis','ar_recu') ORDER BY numero_suivi`, [org, id]);
    },

    /** Ce que produirait la suppression : actes concernés, séance suivante proposée pour les reporter, convocations envoyées. */
    async suppressionImpact(organismeId, id) {
      const org = requireOrg(organismeId);
      const s = await svc.get(org, id);
      const tenue = await db.get('SELECT statut FROM seance_tenue WHERE seance_id = $1', [id]);
      const suivante = await svc.next(org, id);
      const touches = await svc._actesTouches(db, org, id);
      const conv = await db.get('SELECT count(*)::int AS n FROM convocations WHERE seance_id = $1', [id]);
      const bloque = ['tenue', 'close'].includes(s.statut) || !!tenue ? "La séance a été tenue (ou son suivi ouvert) : elle ne peut pas être supprimée, elle reste au registre" : null;
      return {
        seance: { id: s.id, instance: s.instance, dateSeance: s.dateSeance, statut: s.statut }, supprimable: !bloque, raison: bloque,
        actes: touches.map((a) => ({ id: a.id, numeroSuivi: a.numero_suivi, titre: a.titre, statut: a.statut, alOrdreDuJour: a.seance_id === id })),
        suivante: suivante ? { id: suivante.id, dateSeance: suivante.date_seance, lieu: suivante.lieu } : null,
        convocations: conv.n,
      };
    },

    /**
     * Supprime une séance. Les actes qui la visent ou sont à son ordre du jour ne sont jamais perdus : `destination` = « prochaine »
     * (ils visent la séance suivante de l'instance, à affecter ensuite) ou « aucune » (ils reviennent « en attente d'affectation »).
     * Une séance tenue ne se supprime pas ; des convocations déjà envoyées demandent `forcer` (leur suivi est effacé avec la séance).
     */
    async remove(ctx, organismeId, id, { destination, motif, forcer = false }) {
      const org = requireOrg(organismeId);
      const imp = await svc.suppressionImpact(org, id);
      if (!imp.supprimable) throw E.conflict(imp.raison);
      if (imp.convocations && !forcer) throw E.conflict(`Des convocations ont déjà été envoyées (${imp.convocations}) : leur suivi serait effacé. Confirmez la suppression pour continuer`);
      let target = null;
      if (imp.actes.length) {
        if (!['prochaine', 'aucune'].includes(destination)) throw E.badRequest('Indiquez ce que deviennent les actes : « prochaine » (séance suivante) ou « aucune » (sans affectation)');
        if (destination === 'prochaine') {
          target = imp.suivante;
          if (!target) throw E.conflict("Il n'y a pas de séance suivante planifiée pour l'instance : créez-la, ou choisissez « sans affectation »");
        }
      }
      const before = await svc.get(org, id);
      const row = await db.get('SELECT teams_event_id FROM seances WHERE id = $1', [id]);
      if (row?.teams_event_id) { try { await meeting.cancel(row.teams_event_id); } catch (e) { log.warn({ err: e.message }, 'suppression de séance : la réunion Teams n\'a pas pu être annulée'); } }
      await db.tx(async (q) => {
        for (const a of await svc._actesTouches(q, org, id)) {
          if (a.seance_id === id) await q.run("UPDATE actes SET statut = CASE WHEN statut = 'inscrit_odj' THEN 'en_attente_scc' ELSE statut END WHERE id = $1", [a.id]);
          await q.run('UPDATE actes SET seance_id = NULL, seance_visee_id = $2 WHERE id = $1', [a.id, target?.id ?? null]);
          await q.run("INSERT INTO acte_seance_history (acte_id, kind, from_seance, to_seance, motif, actor) VALUES ($1, $2, $6, $3, $4, $5)",
            [a.id, target ? 'report' : 'retrait', target?.id ?? null, motif || `Séance du ${new Date(before.dateSeance).toISOString().slice(0, 10)} supprimée`, ctx.username, id]);
        }
        await q.run('DELETE FROM seances WHERE id = $1 AND organisme_id = $2', [id, org]);
      });
      await audit.log(ctx, { organismeId: org, action: 'seance.delete', entity: 'seances', entityId: id, before, after: { destination: target ? 'prochaine' : 'aucune', vers: target?.id ?? null, actes: imp.actes.length, motif: motif || null } });
      await bus.emit('seance.deleted', { organismeId: org, seanceId: id, before, actes: imp.actes.map((a) => a.id), to: target?.id ?? null, ctx });
      return { deleted: id, actes: imp.actes.length, destination: target ? 'prochaine' : 'aucune', vers: target?.id ?? null };
    },

    // ------------------------------------------------------------------------------ réunions de commission
    /** Instance propre à une commission (créée à la demande) : ses réunions sont des séances, avec ordre du jour = projets présentés. */
    async ensureCommissionInstance(commissionId) {
      const c = await db.get('SELECT * FROM commissions WHERE id = $1', [commissionId]);
      if (!c) throw E.notFound('Commission introuvable');
      const ex = await db.get('SELECT * FROM instances WHERE commission_id = $1', [commissionId]);
      if (ex) return toI(ex);
      const r = await db.get("INSERT INTO instances (organisme_id, code, nom, kind, commission_id, numbering) VALUES ($1,$2,$3,'commission',$4,'{\"pattern\":\"C{ANNEE}-{N_SEANCE}-{ORDRE:02}\"}'::jsonb) ON CONFLICT DO NOTHING RETURNING *",
        [c.organisme_id, `commission-${c.id}`, `Réunions — ${c.nom}`, c.id]);
      return toI(r || (await db.get('SELECT * FROM instances WHERE commission_id = $1', [commissionId])));
    },
    async ensureCommissionInstances(orgId) {
      for (const c of await db.all('SELECT id FROM commissions WHERE organisme_id = $1', [orgId])) await svc.ensureCommissionInstance(c.id);
    },

    async reunions(organismeId, commissionId) {
      const org = requireOrg(organismeId);
      const inst = await db.get('SELECT id FROM instances WHERE commission_id = $1 AND organisme_id = $2', [commissionId, org]);
      if (!inst) return [];
      const rows = await db.all(
        `SELECT s.*, i.nom AS instance_nom, i.kind AS instance_kind, i.commission_id, c.nom AS commission_nom,
                (SELECT count(*)::int FROM seance_items it WHERE it.seance_id = s.id AND it.kind = 'deliberation' AND it.statut = 'a_traiter') AS nb_projets
         FROM seances s JOIN instances i ON i.id = s.instance_id LEFT JOIN commissions c ON c.id = i.commission_id WHERE s.instance_id = $1 ORDER BY s.date_seance DESC`, [inst.id]);
      return rows.map((r) => ({ ...toS(r), projets: r.nb_projets }));
    },

    /** Planifie une réunion de commission (dates clés sans objet), avec Teams facultatif ; prévient les membres. */
    async createReunion(ctx, organismeId, commissionId, b) {
      const org = requireOrg(organismeId);
      const c = await db.get('SELECT * FROM commissions WHERE id = $1 AND organisme_id = $2 AND actif', [commissionId, org]);
      if (!c) throw E.badRequest('Commission inconnue ou inactive dans cet organisme');
      const inst = await svc.ensureCommissionInstance(commissionId);
      const r = await db.get(
        `INSERT INTO seances (organisme_id, instance_id, type, date_seance, lieu, duree_minutes, created_by) VALUES ($1,$2,'autre',$3,$4,$5,$6) RETURNING id`,
        [org, inst.id, new Date(b.dateSeance), b.lieu ?? null, b.dureeMinutes ?? 120, ctx.username]);
      await audit.log(ctx, { organismeId: org, action: 'reunion.create', entity: 'seances', entityId: r.id, after: { commission: c.nom, dateSeance: b.dateSeance, lieu: b.lieu } });
      if (b.teams && b.teams.mode !== 'aucun') await svc.setTeams(ctx, org, r.id, b.teams, { silent: true });
      await svc.notifyReunion(r.id, 'creee', ctx);
      return svc.get(org, r.id);
    },

    /** Visioconférence Teams : `auto` (création via Graph), `lien` (lien collé à la main) ou `aucun` (retire). */
    async setTeams(ctx, organismeId, seanceId, { mode, joinUrl, inviter = false }, { silent = false } = {}) {
      const org = requireOrg(organismeId);
      const s = await db.get('SELECT s.*, i.commission_id, i.nom AS instance_nom FROM seances s JOIN instances i ON i.id = s.instance_id WHERE s.id = $1 AND s.organisme_id = $2', [seanceId, org]);
      if (!s) throw E.notFound('Séance introuvable');
      const wasAuto = s.teams_event_id;
      if (mode === 'aucun') {
        if (wasAuto) await meeting.cancel(wasAuto).catch((e) => log.warn({ err: e.message }, 'annulation Teams : échec (réunion laissée sur le calendrier)'));
        await db.run('UPDATE seances SET teams_join_url = NULL, teams_event_id = NULL, teams_organizer = NULL, teams_invited = false WHERE id = $1', [seanceId]);
      } else if (mode === 'lien') {
        let u;
        try { u = new URL(joinUrl); } catch { throw E.badRequest('Lien invalide'); }
        if (u.protocol !== 'https:' || !/(^|\.)teams\.(microsoft|live)\.com$/.test(u.hostname)) throw E.badRequest('Le lien doit être un lien de réunion Microsoft Teams (https://teams.microsoft.com/…)');
        if (wasAuto) await meeting.cancel(wasAuto).catch(() => {});
        await db.run('UPDATE seances SET teams_join_url = $2, teams_event_id = NULL, teams_organizer = NULL, teams_invited = false WHERE id = $1', [seanceId, u.toString()]);
      } else {
        if (!meeting.available()) throw E.conflict("La création automatique de réunions Teams n'est pas configurée sur ce serveur : collez un lien Teams");
        const start = new Date(s.date_seance); const end = new Date(start.getTime() + (s.duree_minutes || 120) * 60000);
        let attendees = [];
        if (inviter && s.commission_id) {
          const rec = await late.commissions.recipients(s.commission_id);
          const elus = rec.elus.length ? await db.all('SELECT nom, prenom, email FROM elus WHERE id = ANY($1::int[]) AND email IS NOT NULL', [rec.elus.map((x) => Number(x.slice(4)))]) : [];
          const secs = rec.secretaires.length ? await db.all('SELECT display_name, email FROM agent_ref WHERE username = ANY($1::text[]) AND email IS NOT NULL', [rec.secretaires]) : [];
          attendees = [...elus.map((e) => ({ email: e.email, name: `${e.prenom} ${e.nom}`.trim() })), ...secs.map((a) => ({ email: a.email, name: a.display_name }))];
        }
        const payload = { subject: s.instance_nom, start: start.toISOString().replace('Z', ''), end: end.toISOString().replace('Z', ''), lieu: s.lieu, attendees, body: `Réunion ${s.instance_nom}` };
        const m = wasAuto ? (await meeting.update(wasAuto, payload), { id: wasAuto, joinUrl: s.teams_join_url, organizer: s.teams_organizer }) : await meeting.create(payload);
        await db.run('UPDATE seances SET teams_join_url = $2, teams_event_id = $3, teams_organizer = $4, teams_invited = $5 WHERE id = $1', [seanceId, m.joinUrl, m.id, m.organizer, attendees.length > 0]);
      }
      await audit.log(ctx, { organismeId: org, action: 'seance.teams', entity: 'seances', entityId: seanceId, after: { mode, invites: inviter } });
      if (!silent) await svc.notifyReunion(seanceId, 'modifiee', ctx);
      return svc.get(org, seanceId);
    },

    /** Préviens les membres et secrétaires d'une réunion de commission créée, modifiée ou annulée (avec le lien Teams). */
    async notifyReunion(seanceId, change, ctx) {
      const s = await db.get('SELECT s.*, i.commission_id, c.nom AS commission_nom FROM seances s JOIN instances i ON i.id = s.instance_id LEFT JOIN commissions c ON c.id = i.commission_id WHERE s.id = $1', [seanceId]);
      if (!s?.commission_id) return;
      await bus.emit('commission.reunion', { organismeId: s.organisme_id, seanceId, commissionId: s.commission_id, commissionNom: s.commission_nom, change, dateSeance: s.date_seance, lieu: s.lieu, teamsUrl: s.teams_join_url, ctx });
    },

    // ----------------------------------------------------------------------------- séance visée, report
    async assertViseable(organismeId, id) {
      const s = await db.get('SELECT statut, odj_statut FROM seances WHERE id = $1 AND organisme_id = $2', [id, requireOrg(organismeId)]);
      if (!s) throw E.badRequest('Séance inconnue dans cet organisme');
      if (!VISEABLE.includes(s.statut)) throw E.badRequest(`Cette séance est ${s.statut === 'annulee' ? 'annulée' : 'terminée'} : elle ne peut plus être visée`);
      return s;
    },

    /** Séance suivante de la même instance, encore visable. */
    async next(organismeId, seanceId) {
      const s = await db.get('SELECT * FROM seances WHERE id = $1 AND organisme_id = $2', [seanceId, requireOrg(organismeId)]);
      if (!s) throw E.notFound('Séance introuvable');
      return db.get("SELECT * FROM seances WHERE organisme_id = $1 AND instance_id = $2 AND date_seance > $3 AND statut IN ('planifiee','convoquee') ORDER BY date_seance LIMIT 1", [s.organisme_id, s.instance_id, s.date_seance]);
    },

    async assertActeVisible(ctx, organismeId, acteId) { await actes.load(ctx, organismeId, acteId); },

    async history(acteId) {
      return (await db.all('SELECT * FROM acte_seance_history WHERE acte_id = $1 ORDER BY id', [acteId])).map((h) => ({ id: Number(h.id), kind: h.kind, from: h.from_seance, to: h.to_seance, motif: h.motif, actor: h.actor, at: h.at }));
    },

    /** Reporte l'acte à la séance suivante (ou à celle indiquée). SCC / administrateur, ou rédacteur tant que l'acte n'est pas parti (NOT-04). */
    async report(ctx, organismeId, acteId, { motif, toSeanceId }) {
      const a = await actes.load(ctx, organismeId, acteId);
      const isDrafter = a.redacteur === ctx.username || (a.co_redacteurs || []).includes(ctx.username);
      if (!acl.isAdmin(ctx, a.organisme_id) && !(isDrafter && ['brouillon', 'modification_demandee'].includes(a.statut))) throw E.forbidden('Réservé au SCC, ou au rédacteur tant que l\'acte est en rédaction');
      if (!a.seance_visee_id && !a.seance_id) throw E.conflict("Cet acte ne vise aucune séance");
      const from = a.seance_id || a.seance_visee_id;
      const target = toSeanceId ? await db.get('SELECT * FROM seances WHERE id = $1 AND organisme_id = $2', [toSeanceId, a.organisme_id]) : await svc.next(a.organisme_id, from);
      if (!target) throw E.conflict('Aucune séance suivante planifiée : créez-la ou indiquez la séance cible');
      await svc.assertViseable(a.organisme_id, target.id);
      if (a.seance_id) await late.odj?.detachActe(ctx, a, { motif, reason: 'report' });
      await db.run('UPDATE actes SET seance_visee_id = $2, seance_id = NULL WHERE id = $1', [a.id, target.id]);
      await db.run("INSERT INTO acte_seance_history (acte_id, kind, from_seance, to_seance, motif, actor) VALUES ($1,'report',$2,$3,$4,$5)", [a.id, from, target.id, motif, ctx.username]);
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'acte.report', entity: 'actes', entityId: a.id, before: { seance: from }, after: { seance: target.id, motif } });
      await bus.emit('acte.seance_changed', { organismeId: a.organisme_id, acteId: a.id, from, to: target.id, report: true, motif, ctx });
      return { acteId: a.id, seanceViseeId: target.id, from };
    },

    /** Actes non traités d'une séance close : reportables en un geste (SEA-05). */
    async nonTraites(organismeId, seanceId) {
      const s = await svc.get(organismeId, seanceId);
      const rows = await db.all("SELECT id, numero_suivi, titre, statut FROM actes WHERE organisme_id = $1 AND (seance_visee_id = $2 OR seance_id = $2) AND statut NOT IN ('adopte','rejete','retire','abandonne','archive','executoire','publie','transmis','ar_recu','texte_definitif_pret','pret_a_transmettre')", [s.organismeId, seanceId]);
      return { seance: s, items: rows.map((r) => ({ id: r.id, numeroSuivi: r.numero_suivi, titre: r.titre, statut: r.statut })) };
    },

    /** Liste « hors délai » du SCC (SEA-08, NOT-08) : actes bloqués par la date limite et demandes de dérogation en attente. */
    async horsDelai(organismeId) {
      const org = requireOrg(organismeId);
      const blocked = await db.all(
        `SELECT a.id, a.numero_suivi, a.titre, a.statut, a.redacteur, a.direction_code, s.id AS seance_id, s.date_seance, s.date_limite_redaction,
                (SELECT count(*)::int FROM derogations d WHERE d.acte_id = a.id AND d.statut = 'demandee') AS demandes
         FROM actes a JOIN seances s ON s.id = a.seance_visee_id
         WHERE a.organisme_id = $1 AND a.statut IN ('brouillon','modification_demandee') AND s.date_limite_redaction < now() AND s.statut IN ('planifiee','convoquee')
         ORDER BY s.date_limite_redaction, a.id`, [org]);
      const items = [];
      for (const b of blocked) {
        const d = await late.deadlines.activeDerogation(b.id, b.seance_id);
        items.push({ acteId: b.id, numeroSuivi: b.numero_suivi, titre: b.titre, statut: b.statut, redacteur: b.redacteur, directionCode: b.direction_code, seanceId: b.seance_id, dateSeance: b.date_seance, dateLimiteRedaction: b.date_limite_redaction, demandesEnAttente: b.demandes, derogation: d ? { id: d.id, valideJusquAu: d.valide_jusqu_au, nouvelleDateLimite: d.nouvelle_date_limite } : null });
      }
      return { items };
    },
  };

  // l'historique garde la trace de la séance visée choisie ou modifiée (rédacteur, hiérarchie)
  bus.on('acte.seance_changed', async (p) => {
    if (p.report) return;
    await db.run("INSERT INTO acte_seance_history (acte_id, kind, from_seance, to_seance, actor) VALUES ($1,'visee',$2,$3,$4)", [p.acteId, p.from ?? null, p.to ?? null, p.ctx?.username || 'system']).catch(() => {});
  });
  return svc;
}

module.exports = { createSeances, asDeadline, STATUTS, SEANCE_TYPES };
