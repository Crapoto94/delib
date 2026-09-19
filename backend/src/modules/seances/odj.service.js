/**
 * Ordre du jour, classement et numérotation (section 16.2, D10, D18).
 *  - lignes : délibération (issue d'un acte), point libre, chapitre ; le SCC les classe (le tableau reçu du glisser-déposer
 *    fait foi), avec verrou d'édition souple et historique complet ;
 *  - numéro propre à CHAQUE délibération, motif personnalisable ({ANNEE} {N_SEANCE} {ORDRE:03} {RUBRIQUE}), compteur par séance ;
 *  - en préparation : numéros provisoires calculés à la volée ; à l'arrêt : figés ; ensuite modification avec motif, sans
 *    renumérotation (ajout = numéro suivant ou « bis », retrait = numéro conservé et marqué retiré, déplacement = ordre seul).
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const { parisParts } = require('../../shared/time');

const VARS = ['ANNEE', 'N_SEANCE', 'ORDRE', 'RUBRIQUE'];
const DEFAULT_PATTERN = '{ANNEE}-{N_SEANCE}-{ORDRE:03}';
const LOCK_MIN = 10;
const ELIGIBLE_STATUT = 'en_attente_scc';
const CLOSED = ['tenue', 'close', 'annulee'];

const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/** Valide un motif de numérotation : variables connues, {ORDRE} obligatoire (garantit l'unicité), longueur raisonnable. */
function checkPattern(pattern) {
  const found = [...String(pattern).matchAll(/\{([A-Z_]+)(?::(\d{1,2}))?\}/g)];
  const unknown = found.filter((m) => !VARS.includes(m[1])).map((m) => m[0]);
  if (unknown.length) throw E.badRequest(`Variable(s) inconnue(s) : ${unknown.join(', ')} (autorisées : ${VARS.map((v) => `{${v}}`).join(' ')})`);
  if (!found.some((m) => m[1] === 'ORDRE')) throw E.badRequest('Le motif doit contenir {ORDRE} : sans lui, deux délibérations auraient le même numéro');
  const leftover = String(pattern).replace(/\{[A-Z_]+(?::\d{1,2})?\}/g, '');
  if (/[{}]/.test(leftover)) throw E.badRequest('Accolade non fermée dans le motif');
  if (String(pattern).length > 80) throw E.badRequest('Motif trop long');
}

function formatNumero(pattern, vars) {
  return pattern.replace(/\{([A-Z_]+)(?::(\d{1,2}))?\}/g, (m, name, pad) => {
    const v = vars[name];
    return pad ? String(v ?? '').padStart(Number(pad), '0') : String(v ?? '');
  });
}

function createOdj({ db, audit, actes, acl, titulaires, settings, bus, late }) {
  const seanceOf = async (q, org, id, lock = false) => {
    const s = await q.get(`SELECT s.*, i.nom AS instance_nom, i.numbering AS instance_numbering FROM seances s JOIN instances i ON i.id = s.instance_id WHERE s.id = $1 AND s.organisme_id = $2${lock ? ' FOR UPDATE OF s' : ''}`, [id, requireOrg(org)]);
    if (!s) throw E.notFound('Séance introuvable');
    return s;
  };
  const patternOf = (s) => s.numbering?.pattern || s.instance_numbering?.pattern || DEFAULT_PATTERN;

  /** Variables communes de la séance : année et rang dans l'année (par instance). */
  async function seanceVars(q, s) {
    const annee = parisParts(new Date(s.date_seance)).y;
    const rank = (await q.get(
      `SELECT count(*)::int + 1 AS n FROM seances WHERE instance_id = $1 AND statut <> 'annulee' AND date_seance < $2
         AND EXTRACT(year FROM date_seance AT TIME ZONE 'Europe/Paris') = $3`, [s.instance_id, s.date_seance, annee])).n;
    return { ANNEE: annee, N_SEANCE: rank };
  }

  async function rubriqueOf(q, acteId) {
    if (!acteId) return '';
    const r = await q.get('SELECT i.code, i.libelle FROM actes a JOIN ref_items i ON i.id = a.rubrique_id WHERE a.id = $1', [acteId]);
    return r ? strip(r.code || r.libelle).slice(0, 4) : '';
  }

  const rowsOf = (q, seanceId) => q.all(
    `SELECT it.*, a.titre AS acte_titre, a.numero_suivi, a.statut AS acte_statut, a.direction_label, a.redacteur, a.rubrique_id, ru.libelle AS rubrique,
            trim(e.prenom || ' ' || e.nom) AS rapporteur, d.titre AS delib_titre, d.ordre AS delib_ordre
     FROM seance_items it LEFT JOIN actes a ON a.id = it.acte_id LEFT JOIN ref_items ru ON ru.id = a.rubrique_id
          LEFT JOIN elus e ON e.id = a.rapporteur_id LEFT JOIN deliberations d ON d.id = it.deliberation_id
     WHERE it.seance_id = $1 ORDER BY it.position, it.id`, [seanceId]);

  const isNumbered = (it) => it.kind === 'deliberation' || (it.kind === 'libre' && it.numerote);

  /** Numéros affichés : figés après l'arrêt, provisoires (recalculés à chaque lecture) avant. */
  async function displayNumbers(q, s, rows) {
    if (s.odj_statut !== 'en_preparation') return new Map(rows.map((r) => [r.id, r.numero]));
    const pattern = patternOf(s); const base = await seanceVars(q, s);
    const out = new Map(); let n = 0;
    for (const it of rows) {
      if (it.statut === 'retire' || !isNumbered(it)) continue;
      n++;
      out.set(it.id, formatNumero(pattern, { ...base, ORDRE: n, RUBRIQUE: strip(it.rubrique).slice(0, 4) }));
    }
    return out;
  }

  const toItem = (r, numeros, i) => ({
    id: r.id, position: r.position, kind: r.kind, titre: r.kind === 'deliberation' ? (r.delib_titre || r.acte_titre) : r.titre, numerote: r.numerote,
    numero: numeros.get(r.id) ?? r.numero ?? null, provisoire: !r.numero, statut: r.statut, retireMotif: r.retire_motif, ajouteApresArret: r.ajoute_apres_arret,
    acte: r.acte_id ? { id: r.acte_id, numeroSuivi: r.numero_suivi, titre: r.acte_titre, statut: r.acte_statut, direction: r.direction_label, redacteur: r.redacteur, rubrique: r.rubrique, rapporteur: r.rapporteur } : null,
    deliberationId: r.deliberation_id, groupe: r.acte_id ? `a${r.acte_id}` : null, ordreDeliberation: r.delib_ordre ?? null, index: i,
  });

  async function lockOf(q, seanceId) {
    const l = await q.get('SELECT * FROM seance_locks WHERE seance_id = $1 AND until > now()', [seanceId]);
    return l ? { username: l.username, until: l.until } : null;
  }

  async function canEdit(ctx, org) {
    if (acl.isAdmin(ctx, org)) return true;
    return (await titulaires.resolve(org, 'dgs', {})).some((t) => t.username === ctx.username || t.suppleant === ctx.username);
  }

  const hist = (q, seanceId, ctx, action, { itemId = null, before = null, after = null, motif = null } = {}) =>
    q.run('INSERT INTO seance_item_history (seance_id, item_id, actor, action, before, after, motif) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',
      [seanceId, itemId, ctx.username, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, motif]);

  /**
   * Toute modification : droits, verrou d'édition, séance non terminée ; après l'arrêt, motif obligatoire (ODJ-06).
   * `fn(q, seance, afterArret)` renvoie ce qu'il faut renvoyer / notifier.
   */
  async function mutate(ctx, org, seanceId, { motif } = {}, fn) {
    if (!(await canEdit(ctx, org))) throw E.forbidden("L'ordre du jour est géré par le SCC (ou le DGS après son arrêt)");
    const out = await db.tx(async (q) => {
      const s = await seanceOf(q, org, seanceId, true);
      if (CLOSED.includes(s.statut)) throw E.conflict(`Séance ${s.statut === 'annulee' ? 'annulée' : 'terminée'} : l'ordre du jour n'est plus modifiable`);
      const lock = await lockOf(q, s.id);
      if (lock && lock.username !== ctx.username) throw E.conflict(`Ordre du jour en cours de modification par ${lock.username}`, { lock });
      const afterArret = s.odj_statut !== 'en_preparation';
      if (afterArret && (!motif || motif.trim().length < 3)) throw E.badRequest("Après l'arrêt de l'ordre du jour, un motif est obligatoire");
      const r = await fn(q, s, afterArret);
      return { s, afterArret, ...r };
    });
    if (out.afterArret && out.changed?.length) for (const c of out.changed) await bus.emit('odj.modifie', { organismeId: org, acteId: c.acteId, seanceId, change: c.change, motif, ctx });
    return out;
  }

  async function nextPosition(q, seanceId) { return (await q.get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM seance_items WHERE seance_id = $1', [seanceId])).p; }

  async function shift(q, seanceId, from) { await q.run('UPDATE seance_items SET position = position + 1 WHERE seance_id = $1 AND position >= $2', [seanceId, from]); }

  /** Numéro attribué à un ajout après l'arrêt : suivant (défaut) ou « bis » du précédent. */
  async function numeroAjout(q, s, org, prevItem, rubrique) {
    const cfg = await settings.resolve(org);
    const mode = cfg['odj.ajout_apres_arret']?.value === 'bis' ? 'bis' : 'suivant';
    const base = await seanceVars(q, s); const pattern = patternOf(s);
    if (mode === 'bis' && prevItem?.numero) {
      let cand = `${prevItem.numero}bis`; let k = 2;
      while (await q.get('SELECT 1 AS x FROM seance_items WHERE seance_id = $1 AND numero = $2', [s.id, cand])) cand = `${prevItem.numero}bis${k++}`;
      return { numero: cand, seq: prevItem.numero_seq };
    }
    const seq = ((await q.get('SELECT COALESCE(MAX(numero_seq), 0) + 1 AS n FROM seance_items WHERE seance_id = $1', [s.id])).n);
    return { numero: formatNumero(pattern, { ...base, ORDRE: seq, RUBRIQUE: rubrique }), seq };
  }

  const svc = {
    VARS, DEFAULT_PATTERN, formatNumero, checkPattern,

    async get(ctx, organismeId, seanceId) {
      const s = await seanceOf(db, organismeId, seanceId);
      const rows = await rowsOf(db, s.id);
      const numeros = await displayNumbers(db, s, rows);
      const items = rows.map((r, i) => toItem(r, numeros, i));
      const warnings = [];
      for (const it of items) if (it.kind === 'deliberation' && it.statut === 'a_traiter' && it.acte && it.acte.statut !== 'inscrit_odj') warnings.push({ itemId: it.id, message: `L'acte n° ${it.acte.numeroSuivi} est « ${it.acte.statut} » : à traiter` });
      return {
        seance: { id: s.id, instance: s.instance_nom, dateSeance: s.date_seance, statut: s.statut }, statut: s.odj_statut, arreteAt: s.odj_arrete_at, arretePar: s.odj_arrete_par,
        pattern: patternOf(s), lock: await lockOf(db, s.id), canEdit: await canEdit(ctx, s.organisme_id), items, warnings,
        totals: { deliberations: items.filter((i) => i.kind === 'deliberation' && i.statut === 'a_traiter').length, retires: items.filter((i) => i.statut === 'retire').length },
      };
    },

    /** Actes prêts à être affectés (circuit terminé, pas encore à l'ordre du jour), avec filtres (ODJ-01). */
    async pending(organismeId, seanceId, { visee = 'toutes', rubriqueId, rapporteurId, q } = {}) {
      const org = requireOrg(organismeId);
      const p = [org, ELIGIBLE_STATUT, seanceId]; const w = ['a.organisme_id = $1', 'a.statut = $2', 'a.current_step_key IS NULL', 'a.seance_id IS NULL'];
      if (visee === 'cette') w.push('a.seance_visee_id = $3'); else if (visee === 'aucune') w.push('a.seance_visee_id IS NULL'); else w.push('($3::int IS NOT NULL)');
      if (rubriqueId) { p.push(rubriqueId); w.push(`a.rubrique_id = $${p.length}`); }
      if (rapporteurId) { p.push(rapporteurId); w.push(`a.rapporteur_id = $${p.length}`); }
      if (q) { p.push(`%${q}%`); w.push(`(a.titre ILIKE $${p.length} OR a.numero_suivi::text = $${p.length - 0})`); }
      const rows = await db.all(
        `SELECT a.id, a.numero_suivi, a.titre, a.direction_label, a.seance_visee_id, ru.libelle AS rubrique, trim(e.prenom || ' ' || e.nom) AS rapporteur,
                (SELECT count(*)::int FROM deliberations d WHERE d.acte_id = a.id) AS nb_delib,
                (SELECT count(*)::int FROM acte_commissions c WHERE c.acte_id = a.id AND c.retiree_at IS NULL AND c.avis IS NOT NULL) AS avis_rendus,
                (SELECT count(*)::int FROM acte_commissions c WHERE c.acte_id = a.id AND c.retiree_at IS NULL) AS nb_commissions
         FROM actes a LEFT JOIN ref_items ru ON ru.id = a.rubrique_id LEFT JOIN elus e ON e.id = a.rapporteur_id WHERE ${w.join(' AND ')} ORDER BY a.numero_suivi`, p);
      return rows.map((r) => ({ id: r.id, numeroSuivi: r.numero_suivi, titre: r.titre, direction: r.direction_label, seanceViseeId: r.seance_visee_id, rubrique: r.rubrique, rapporteur: r.rapporteur, deliberations: r.nb_delib, commissions: r.nb_commissions, avisRendus: r.avis_rendus }));
    },

    async affecter(ctx, organismeId, seanceId, { acteIds, motif }) {
      const org = requireOrg(organismeId);
      const res = await mutate(ctx, org, seanceId, { motif }, async (q, s, after) => {
        const changed = []; const added = [];
        for (const acteId of acteIds) {
          const a = await q.get('SELECT * FROM actes WHERE id = $1 AND organisme_id = $2 FOR UPDATE', [acteId, org]);
          if (!a) throw E.notFound(`Acte ${acteId} introuvable`);
          if (a.statut !== ELIGIBLE_STATUT || a.current_step_key || a.seance_id) throw E.conflict(`L'acte n° ${a.numero_suivi} n'est pas prêt à être affecté (circuit terminé et non encore inscrit)`);
          const delibs = await q.all('SELECT * FROM deliberations WHERE acte_id = $1 ORDER BY ordre, id', [a.id]);
          const rub = await rubriqueOf(q, a.id);
          for (const d of delibs) {
            const pos = await nextPosition(q, s.id);
            let numero = null; let seq = null;
            if (after) ({ numero, seq } = await numeroAjout(q, s, org, null, rub));
            const it = await q.get(
              `INSERT INTO seance_items (organisme_id, seance_id, position, kind, acte_id, deliberation_id, numero, numero_seq, ajoute_apres_arret, created_by)
               VALUES ($1,$2,$3,'deliberation',$4,$5,$6,$7,$8,$9) RETURNING id`, [org, s.id, pos, a.id, d.id, numero, seq, after, ctx.username]);
            added.push(it.id);
            await hist(q, s.id, ctx, 'ajout', { itemId: it.id, after: { acteId: a.id, deliberationId: d.id, numero }, motif });
          }
          await q.run("UPDATE actes SET statut = 'inscrit_odj', seance_id = $2, seance_visee_id = COALESCE(seance_visee_id, $2) WHERE id = $1", [a.id, s.id]);
          await q.run("INSERT INTO acte_seance_history (acte_id, kind, from_seance, to_seance, motif, actor) VALUES ($1,'affectation',$2,$3,$4,$5)", [a.id, a.seance_visee_id, s.id, motif ?? null, ctx.username]);
          changed.push({ acteId: a.id, change: 'ajout' });
        }
        return { added, changed };
      });
      await audit.log(ctx, { organismeId: org, action: 'odj.affecter', entity: 'seances', entityId: seanceId, after: { acteIds, motif } });
      for (const id of acteIds) await bus.emit('acte.seance_changed', { organismeId: org, acteId: id, from: null, to: seanceId, ctx, motif: 'Inscrit à l\'ordre du jour' });
      return svc.get(ctx, org, seanceId);
    },

    /** Retire un acte de l'ordre du jour : supprimé avant l'arrêt, marqué « retiré » (numéro conservé) après. */
    async retirerActe(ctx, organismeId, seanceId, acteId, { motif } = {}) {
      const org = requireOrg(organismeId);
      await mutate(ctx, org, seanceId, { motif }, async (q, s, after) => {
        const items = await q.all("SELECT * FROM seance_items WHERE seance_id = $1 AND acte_id = $2 AND statut = 'a_traiter'", [s.id, acteId]);
        if (!items.length) throw E.notFound("Cet acte n'est pas à l'ordre du jour");
        for (const it of items) {
          if (after) await q.run("UPDATE seance_items SET statut = 'retire', retire_motif = $2 WHERE id = $1", [it.id, motif]);
          else await q.run('DELETE FROM seance_items WHERE id = $1', [it.id]);
          await hist(q, s.id, ctx, 'retrait', { itemId: it.id, before: { numero: it.numero, position: it.position }, motif });
        }
        await q.run("UPDATE actes SET statut = 'en_attente_scc', seance_id = NULL WHERE id = $1 AND statut = 'inscrit_odj'", [acteId]);
        await q.run("INSERT INTO acte_seance_history (acte_id, kind, from_seance, motif, actor) VALUES ($1,'retrait',$2,$3,$4)", [acteId, s.id, motif ?? null, ctx.username]);
        return { changed: [{ acteId, change: 'retrait' }] };
      });
      return svc.get(ctx, org, seanceId);
    },

    /** Appelé par le report d'un acte (SEA-05) : la ligne quitte l'ordre du jour de la séance d'origine. */
    async detachActe(ctx, acte, { motif }) {
      const s = await db.get('SELECT * FROM seances WHERE id = $1', [acte.seance_id]);
      if (!s) return;
      const after = s.odj_statut !== 'en_preparation';
      const items = await db.all("SELECT * FROM seance_items WHERE seance_id = $1 AND acte_id = $2 AND statut = 'a_traiter'", [s.id, acte.id]);
      for (const it of items) {
        if (after) await db.run("UPDATE seance_items SET statut = 'retire', retire_motif = $2 WHERE id = $1", [it.id, motif || 'report']);
        else await db.run('DELETE FROM seance_items WHERE id = $1', [it.id]);
        await hist(db, s.id, ctx, 'retrait', { itemId: it.id, motif: motif || 'report' });
      }
      await db.run("UPDATE actes SET statut = 'en_attente_scc' WHERE id = $1 AND statut = 'inscrit_odj'", [acte.id]);
    },

    async addPoint(ctx, organismeId, seanceId, { kind = 'libre', titre, numerote = false, afterItemId, motif }) {
      const org = requireOrg(organismeId);
      const res = await mutate(ctx, org, seanceId, { motif }, async (q, s, after) => {
        let pos;
        if (afterItemId) {
          const ref = await q.get('SELECT position FROM seance_items WHERE id = $1 AND seance_id = $2', [afterItemId, s.id]);
          if (!ref) throw E.badRequest('Point de référence introuvable');
          pos = ref.position + 1; await shift(q, s.id, pos);
        } else pos = await nextPosition(q, s.id);
        const isNum = kind === 'libre' && numerote;
        let numero = null; let seq = null;
        if (after && isNum) ({ numero, seq } = await numeroAjout(q, s, org, null, ''));
        const it = await q.get(
          `INSERT INTO seance_items (organisme_id, seance_id, position, kind, titre, numerote, numero, numero_seq, ajoute_apres_arret, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [org, s.id, pos, kind, titre, isNum, numero, seq, after, ctx.username]);
        await hist(q, s.id, ctx, 'ajout', { itemId: it.id, after: { kind, titre, numero }, motif });
        return { id: it.id };
      });
      return { id: res.id, ...(await svc.get(ctx, org, seanceId)) };
    },

    async updatePoint(ctx, organismeId, seanceId, itemId, { titre, numerote, motif }) {
      const org = requireOrg(organismeId);
      await mutate(ctx, org, seanceId, { motif }, async (q, s) => {
        const it = await q.get('SELECT * FROM seance_items WHERE id = $1 AND seance_id = $2', [itemId, s.id]);
        if (!it || it.kind === 'deliberation') throw E.notFound('Point libre ou chapitre introuvable');
        if (numerote !== undefined && it.kind === 'libre' && s.odj_statut !== 'en_preparation') throw E.conflict("Après l'arrêt, la numérotation d'un point ne change plus");
        await q.run('UPDATE seance_items SET titre = COALESCE($2, titre), numerote = CASE WHEN kind = \'libre\' THEN COALESCE($3, numerote) ELSE numerote END WHERE id = $1', [itemId, titre ?? null, numerote ?? null]);
        await hist(q, s.id, ctx, 'modification', { itemId, before: { titre: it.titre, numerote: it.numerote }, after: { titre, numerote }, motif });
        return {};
      });
      return svc.get(ctx, org, seanceId);
    },

    async removePoint(ctx, organismeId, seanceId, itemId, { motif } = {}) {
      const org = requireOrg(organismeId);
      await mutate(ctx, org, seanceId, { motif }, async (q, s, after) => {
        const it = await q.get('SELECT * FROM seance_items WHERE id = $1 AND seance_id = $2', [itemId, s.id]);
        if (!it || it.kind === 'deliberation') throw E.notFound('Point libre ou chapitre introuvable (une délibération se retire via son acte)');
        if (after && it.numero) await q.run("UPDATE seance_items SET statut = 'retire', retire_motif = $2 WHERE id = $1", [itemId, motif]);
        else await q.run('DELETE FROM seance_items WHERE id = $1', [itemId]);
        await hist(q, s.id, ctx, 'retrait', { itemId, before: { titre: it.titre, numero: it.numero }, motif });
        return {};
      });
      return svc.get(ctx, org, seanceId);
    },

    /** Classement : `ids` = ordre complet des lignes actives (résultat du glisser-déposer). Un groupe reste contigu par choix du client. */
    async reorder(ctx, organismeId, seanceId, { ids, motif }) {
      const org = requireOrg(organismeId);
      await mutate(ctx, org, seanceId, { motif }, async (q, s) => {
        const rows = await q.all('SELECT id, position, statut FROM seance_items WHERE seance_id = $1 ORDER BY position, id', [s.id]);
        const active = rows.filter((r) => r.statut === 'a_traiter').map((r) => r.id);
        if (ids.length !== active.length || new Set(ids).size !== ids.length || !ids.every((i) => active.includes(i))) throw E.badRequest("La liste doit reprendre exactement les lignes actives de l'ordre du jour, une fois chacune", { attendu: active });
        const before = active;
        let pos = 1;
        for (const id of ids) await q.run('UPDATE seance_items SET position = $2 WHERE id = $1', [id, pos++]);
        for (const r of rows.filter((x) => x.statut === 'retire')) await q.run('UPDATE seance_items SET position = $2 WHERE id = $1', [r.id, pos++]);
        if (before.join() !== ids.join()) await hist(q, s.id, ctx, 'classement', { before, after: ids, motif });
        return { changed: before.join() !== ids.join() ? [{ change: 'classement' }] : [] };
      });
      return svc.get(ctx, org, seanceId);
    },

    /** Aides de tri (ODJ-03) : simples propositions, rien n'est enregistré. Les points libres et chapitres restent en place. */
    async propose(ctx, organismeId, seanceId, critere) {
      const org = requireOrg(organismeId);
      const s = await seanceOf(db, org, seanceId);
      const rows = (await rowsOf(db, s.id)).filter((r) => r.statut === 'a_traiter');
      const cfg = await settings.resolve(org);
      const ordreRub = cfg['odj.ordre_rubriques']?.value;
      const key = {
        rubrique: (g) => { const i = Array.isArray(ordreRub) ? ordreRub.indexOf(g.rubrique) : -1; return [i < 0 ? 999 : i, g.rubrique || '~']; },
        rapporteur: (g) => [g.rapporteur || '~'], numero: (g) => [g.numero_suivi], alpha: (g) => [String(g.acte_titre || '').toLowerCase()],
      }[critere];
      const groups = []; const byActe = new Map();
      for (const r of rows) if (r.kind === 'deliberation') { if (!byActe.has(r.acte_id)) { const g = { ...r, ids: [] }; byActe.set(r.acte_id, g); groups.push(g); } byActe.get(r.acte_id).ids.push(r.id); }
      groups.sort((a, b) => { const ka = key(a); const kb = key(b); for (let i = 0; i < ka.length; i++) { if (ka[i] < kb[i]) return -1; if (ka[i] > kb[i]) return 1; } return 0; });
      const queue = groups.flatMap((g) => g.ids);
      const ids = rows.map((r) => (r.kind === 'deliberation' ? queue.shift() : r.id));
      return { critere, ids };
    },

    // ------------------------------------------------------------------------------------------ arrêt
    /** Contrôles avant arrêt (aussi exposés seuls) : liste des anomalies bloquantes. */
    async controles(organismeId, seanceId) {
      const s = await seanceOf(db, organismeId, seanceId);
      const rows = (await rowsOf(db, s.id)).filter((r) => r.statut === 'a_traiter');
      const problems = [];
      if (!rows.some((r) => r.kind === 'deliberation' || r.kind === 'libre')) problems.push({ code: 'vide', message: "L'ordre du jour est vide" });
      const seen = new Set();
      for (const r of rows) {
        if (r.kind === 'libre' && !r.titre?.trim()) problems.push({ code: 'sans_titre', itemId: r.id, message: 'Un point libre n\'a pas de titre' });
        if (r.kind !== 'deliberation' || seen.has(r.acte_id)) continue;
        seen.add(r.acte_id);
        if (r.acte_statut !== 'inscrit_odj') problems.push({ code: 'acte_non_pret', itemId: r.id, acteId: r.acte_id, message: `L'acte n° ${r.numero_suivi} est « ${r.acte_statut} »` });
        const a = await db.get('SELECT * FROM actes WHERE id = $1', [r.acte_id]);
        const type = await db.get('SELECT meta FROM ref_items WHERE id = $1', [a.type_id]);
        for (const m of await late.texts.missingTexts(a, type?.meta)) problems.push({ code: 'texte_manquant', itemId: r.id, acteId: r.acte_id, message: `Acte n° ${r.numero_suivi} : ${m.label}` });
      }
      return { ok: problems.length === 0, problems };
    },

    /** Arrête l'ordre du jour : numéros figés, notifications de classement envoyées UNE fois (ODJ-08). */
    async arreter(ctx, organismeId, seanceId, { forcer = false } = {}) {
      const org = requireOrg(organismeId);
      if (!(await canEdit(ctx, org))) throw E.forbidden("Seul le SCC arrête l'ordre du jour");
      const before = await seanceOf(db, org, seanceId);
      if (before.odj_statut !== 'en_preparation') throw E.conflict("L'ordre du jour est déjà arrêté");
      const c = await svc.controles(org, seanceId);
      if (!c.ok && !forcer) throw E.incomplete("L'ordre du jour comporte des anomalies : corrigez-les ou forcez l'arrêt", c.problems);
      const notified = await db.tx(async (q) => {
        const s = await seanceOf(q, org, seanceId, true);
        if (s.odj_statut !== 'en_preparation') throw E.conflict("L'ordre du jour est déjà arrêté");
        const lock = await lockOf(q, s.id);
        if (lock && lock.username !== ctx.username) throw E.conflict(`Ordre du jour en cours de modification par ${lock.username}`, { lock });
        const rows = await rowsOf(q, s.id);
        const numeros = await displayNumbers(q, s, rows);
        let seq = 0; const acteNums = new Map();
        for (const it of rows.filter((r) => r.statut === 'a_traiter')) {
          const numero = numeros.get(it.id);
          if (numero) { seq++; await q.run('UPDATE seance_items SET numero = $2, numero_seq = $3 WHERE id = $1', [it.id, numero, seq]); if (it.acte_id && !acteNums.has(it.acte_id)) acteNums.set(it.acte_id, { numero, ordre: seq }); }
        }
        await q.run("UPDATE seances SET odj_statut = 'arrete', odj_arrete_at = now(), odj_arrete_par = $2 WHERE id = $1", [s.id, ctx.username]);
        await q.run('DELETE FROM seance_locks WHERE seance_id = $1', [s.id]);
        await hist(q, s.id, ctx, 'arret', { after: { forcer, anomalies: c.problems.length, points: seq } });
        return acteNums;
      });
      await audit.log(ctx, { organismeId: org, action: 'odj.arret', entity: 'seances', entityId: seanceId, after: { forcer, anomalies: c.problems } });
      for (const [acteId, v] of notified) await bus.emit('odj.arrete', { organismeId: org, acteId, seanceId, numero: v.numero, ordre: v.ordre, ctx });
      return svc.get(ctx, org, seanceId);
    },

    // ----------------------------------------------------------------------------------- verrou, historique
    async takeLock(ctx, organismeId, seanceId, { force = false } = {}) {
      const org = requireOrg(organismeId);
      if (!(await canEdit(ctx, org))) throw E.forbidden();
      await seanceOf(db, org, seanceId);
      const cur = await lockOf(db, seanceId);
      if (cur && cur.username !== ctx.username && !(force && acl.isAdmin(ctx, org))) throw E.conflict(`Ordre du jour en cours de modification par ${cur.username}`, { lock: cur });
      const until = new Date(Date.now() + LOCK_MIN * 60000);
      await db.run('INSERT INTO seance_locks (seance_id, username, until) VALUES ($1,$2,$3) ON CONFLICT (seance_id) DO UPDATE SET username = EXCLUDED.username, until = EXCLUDED.until', [seanceId, ctx.username, until]);
      if (cur && cur.username !== ctx.username) await audit.log(ctx, { organismeId: org, action: 'odj.verrou.reprise', entity: 'seances', entityId: seanceId, before: { username: cur.username } });
      return { lock: { username: ctx.username, until } };
    },
    async releaseLock(ctx, organismeId, seanceId) {
      await seanceOf(db, organismeId, seanceId);
      await db.run('DELETE FROM seance_locks WHERE seance_id = $1 AND (username = $2 OR $3)', [seanceId, ctx.username, acl.isAdmin(ctx, organismeId)]);
      return { released: true };
    },
    async history(ctx, organismeId, seanceId) {
      await seanceOf(db, organismeId, seanceId);
      return (await db.all('SELECT * FROM seance_item_history WHERE seance_id = $1 ORDER BY id DESC LIMIT 500', [seanceId])).map((h) => ({ id: Number(h.id), itemId: h.item_id, actor: h.actor, action: h.action, before: h.before, after: h.after, motif: h.motif, at: h.at }));
    },

    // ------------------------------------------------------------------------------- numérotation, exports
    /** Aperçu en direct d'un motif sur des exemples (ODJ-05). */
    async previewNumbering(organismeId, { pattern, seanceId }) {
      checkPattern(pattern);
      let base = { ANNEE: new Date().getFullYear(), N_SEANCE: 4 };
      if (seanceId) { const s = await seanceOf(db, organismeId, seanceId); base = await seanceVars(db, s); }
      return { pattern, exemples: [[1, 'FINANCES'], [2, 'URBANISME'], [12, 'PERSONNEL'], [103, 'CULTURE']].map(([o, r]) => formatNumero(pattern, { ...base, ORDRE: o, RUBRIQUE: strip(r).slice(0, 4) })) };
    },

    /** Change le motif d'une séance : réservé tant que l'ordre du jour n'est pas arrêté (les numéros attribués ne bougent jamais). */
    async setPattern(ctx, organismeId, seanceId, pattern) {
      const org = requireOrg(organismeId);
      if (!acl.isAdmin(ctx, org)) throw E.forbidden();
      checkPattern(pattern);
      const s = await seanceOf(db, org, seanceId);
      if (s.odj_statut !== 'en_preparation') throw E.conflict("Les numéros sont figés : le motif d'une séance arrêtée ne se modifie plus");
      await db.run('UPDATE seances SET numbering = $2::jsonb WHERE id = $1', [seanceId, JSON.stringify({ pattern })]);
      await audit.log(ctx, { organismeId: org, action: 'odj.motif', entity: 'seances', entityId: seanceId, before: { pattern: patternOf(s) }, after: { pattern } });
      return { pattern };
    },

    /** Tableau de suivi des délibérations numérotées (CSV, ODJ-11). */
    async exportCsv(ctx, organismeId, seanceId) {
      const o = await svc.get(ctx, organismeId, seanceId);
      const esc = (v) => { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const head = ['Ordre', 'Numéro', 'Type', 'Titre', 'N° suivi', 'Rubrique', 'Rapporteur', 'Direction', 'Statut acte', 'Statut point'];
      const lines = o.items.map((it, i) => [i + 1, it.numero || '', it.kind, it.titre, it.acte?.numeroSuivi, it.acte?.rubrique, it.acte?.rapporteur, it.acte?.direction, it.acte?.statut, it.statut === 'retire' ? `retiré (${it.retireMotif})` : it.provisoire ? 'provisoire' : 'figé'].map(esc).join(';'));
      return `﻿${head.join(';')}\n${lines.join('\n')}\n`;
    },

    /** Position d'un acte dans les ordres du jour (champ « Classement ODJ » calculé, en lecture seule — ODJ-07). */
    async positionsOf(acteId) {
      const rows = await db.all(
        `SELECT it.id, it.seance_id, it.position, it.numero, it.statut, s.date_seance, s.odj_statut, i.nom AS instance FROM seance_items it JOIN seances s ON s.id = it.seance_id JOIN instances i ON i.id = s.instance_id
         WHERE it.acte_id = $1 ORDER BY it.id`, [acteId]);
      const out = [];
      for (const r of rows) {
        const before = (await db.get("SELECT count(*)::int AS n FROM seance_items WHERE seance_id = $1 AND statut = 'a_traiter' AND position < $2", [r.seance_id, r.position])).n;
        out.push({ seanceId: r.seance_id, instance: r.instance, dateSeance: r.date_seance, ordre: before + 1, numero: r.numero, provisoire: !r.numero, statut: r.statut });
      }
      return out;
    },
  };
  return svc;
}

module.exports = { createOdj, formatNumero, checkPattern, VARS };
