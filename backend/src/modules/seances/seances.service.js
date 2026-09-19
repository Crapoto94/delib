/**
 * Instances et séances (section 16.1) : dates clés pré-remplies par décalage paramétrable (NOT-01, NOT-02, SEA-02),
 * séance visée contrôlée à l'écriture, report à la séance suivante avec trace (SEA-05), liste « hors délai » (SEA-08).
 * L'ordre du jour et la numérotation sont dans odj.service.js.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const { addBusinessDays, parisParts, parisToDate } = require('../../shared/time');

const SEANCE_TYPES = ['ordinaire', 'extraordinaire', 'budgetaire', 'autre'];
const STATUTS = ['planifiee', 'convoquee', 'tenue', 'close', 'annulee'];
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
  jalonsExtra: r.jalons_extra, numbering: r.numbering, odjStatut: r.odj_statut, odjArreteAt: r.odj_arrete_at, odjArretePar: r.odj_arrete_par, createdAt: r.created_at,
  ...(r.nb_actes_attente !== undefined ? { actesEnAttente: r.nb_actes_attente } : {}),
});

function createSeances({ db, audit, actes, acl, settings, bus, late }) {
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
    /** Dates clés proposées d'après la date de séance et les décalages paramétrés (jours ouvrés, sauf convocation : jours francs). */
    async proposeDates(organismeId, dateSeance, typeActeId) {
      const cfg = await settings.resolve(organismeId, { typeActeId });
      const get = (k, d) => Number(cfg[k]?.value ?? d);
      const holidays = await holidaysOf(organismeId);
      const p = parisParts(new Date(dateSeance));
      const day = new Date(Date.UTC(p.y, p.m - 1, p.d));
      const eod = (dt) => parisToDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), 23, 59);
      const conv = new Date(day.getTime() - (get('seances.decalage.convocation', 5) + 1) * 86400000); // « jours francs » : veille comprise
      return {
        dateLimiteRedaction: eod(addBusinessDays(day, -get('seances.decalage.redaction', 30), holidays)),
        dateLimiteDgs: eod(addBusinessDays(day, -get('seances.decalage.dgs', 20), holidays)),
        dateLimiteMadCommissions: eod(addBusinessDays(day, -get('seances.decalage.mad', 12), holidays)),
        dateEnvoiConvocation: eod(conv),
      };
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
        `SELECT s.*, i.nom AS instance_nom, (SELECT count(*)::int FROM actes a WHERE a.seance_visee_id = s.id AND a.seance_id IS NULL AND a.statut NOT IN ('abandonne','retire')) AS nb_actes_attente
         FROM seances s JOIN instances i ON i.id = s.instance_id WHERE s.id = $1 AND s.organisme_id = $2`, [id, requireOrg(organismeId)]);
      if (!r) throw E.notFound('Séance introuvable');
      return { ...toS(r), jalons: await svc.jalons(r) };
    },

    async list(organismeId, { instanceId, statut, from, to, limit = 100, offset = 0 } = {}) {
      const org = requireOrg(organismeId);
      const p = [org]; const w = ['s.organisme_id = $1'];
      const add = (v) => { p.push(v); return `$${p.length}`; };
      if (instanceId) w.push(`s.instance_id = ${add(instanceId)}`);
      if (statut) w.push(`s.statut = ${add(statut)}`);
      if (from) w.push(`s.date_seance >= ${add(from)}`);
      if (to) w.push(`s.date_seance <= ${add(to)}`);
      const total = (await db.get(`SELECT count(*)::int AS n FROM seances s WHERE ${w.join(' AND ')}`, p)).n;
      const rows = await db.all(
        `SELECT s.*, i.nom AS instance_nom, (SELECT count(*)::int FROM actes a WHERE a.seance_visee_id = s.id AND a.seance_id IS NULL AND a.statut NOT IN ('abandonne','retire')) AS nb_actes_attente
         FROM seances s JOIN instances i ON i.id = s.instance_id WHERE ${w.join(' AND ')} ORDER BY s.date_seance DESC LIMIT ${add(limit)} OFFSET ${add(offset)}`, p);
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
      // la date limite a bougé : les rappels de tous les actes visant la séance sont recalculés d'eux-mêmes (NOT-05)
      await bus.emit('seance.updated', { organismeId: org, seanceId: id, before, after, ctx });
      return after;
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
