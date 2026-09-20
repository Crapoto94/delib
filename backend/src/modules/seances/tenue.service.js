/**
 * Suivi de la séance en direct (section 19.1 bis, D78) : ouverture / clôture, présences (arrivées, sorties, retours), pouvoirs,
 * point en cours partagé, notes administratives, votes par élu ou par groupe, clôture d'un point (résultat -> statut de l'acte).
 *
 * Synchronisation : chaque modification incrémente `seance_tenue.version` et réveille les pages en attente longue (`attendre`) ;
 * pas de WebSocket ni de session persistante, tout passe par l'API authentifiée habituelle.
 * Les règles de décompte sont pures et testées à part (tenue.rules.js).
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const rules = require('./tenue.rules');

const CLOS = ['traite', 'sans_vote', 'retire', 'ajourne'];
const ACTE_FINAUX = ['adopte', 'rejete', 'transmis', 'ar_recu', 'publie', 'executoire', 'archive', 'abandonne'];

function createTenue({ db, audit, acl, access, seances, odj, bus }) {
  const waiters = new Map(); // seanceId -> Set<() => void>
  const wake = (id) => { const w = waiters.get(id); if (w) { waiters.delete(id); w.forEach((f) => f()); } };
  const canWrite = (ctx, org) => acl.isAdmin(ctx, org);
  const need = (ctx, org) => { if (!canWrite(ctx, org)) throw E.forbidden('La saisie de la séance est réservée au secrétariat (SCC) et aux administrateurs'); };

  const journal = (q, seanceId, ctx, type, { itemId = null, eluId = null, detail = null } = {}) =>
    q.run('INSERT INTO seance_journal (seance_id, item_id, elu_id, type, detail, actor) VALUES ($1,$2,$3,$4,$5::jsonb,$6)', [seanceId, itemId, eluId, type, detail ? JSON.stringify(detail) : null, ctx.username]);

  /** Membres de l'instance : élus actifs de l'organisme, ou membres de la commission si la séance est celle d'une commission. */
  async function membres(q, org, s) {
    const sel = `SELECT e.id, e.nom, e.prenom, e.role, e.groupe_id, g.nom AS groupe_nom, g.couleur AS groupe_couleur, g.ordre AS groupe_ordre`;
    const rows = s.commissionId
      ? await q.all(`${sel} FROM commission_membres cm JOIN elus e ON e.id = cm.elu_id LEFT JOIN groupes_politiques g ON g.id = e.groupe_id
                     WHERE cm.commission_id = $1 AND e.actif ORDER BY g.ordre NULLS LAST, g.nom NULLS LAST, e.nom, e.prenom`, [s.commissionId])
      : await q.all(`${sel} FROM elus e LEFT JOIN groupes_politiques g ON g.id = e.groupe_id
                     WHERE e.organisme_id = $1 AND e.actif ORDER BY g.ordre NULLS LAST, g.nom NULLS LAST, e.nom, e.prenom`, [org]);
    return rows;
  }

  const presencesOf = async (q, seanceId) => new Map((await q.all('SELECT elu_id, statut, en_salle FROM seance_presences WHERE seance_id = $1', [seanceId])).map((r) => [r.elu_id, { statut: r.statut, enSalle: r.en_salle }]));
  const procurationsOf = async (q, seanceId) => (await q.all('SELECT mandant_elu_id AS mandant, mandataire_elu_id AS mandataire FROM seance_procurations WHERE seance_id = $1', [seanceId]));
  const votesOf = async (q, itemId) => new Map((await q.all('SELECT elu_id, choix FROM seance_votes WHERE item_id = $1', [itemId])).map((r) => [r.elu_id, r.choix]));
  const nomDe = (m) => `${m.prenom || ''} ${m.nom}`.trim();

  async function itemOf(q, seanceId, itemId) {
    const it = await q.get('SELECT * FROM seance_items WHERE id = $1 AND seance_id = $2', [itemId, seanceId]);
    if (!it) throw E.notFound("Point introuvable dans l'ordre du jour de cette séance");
    return it;
  }

  /** Points de l'ordre du jour avec leur état de séance. */
  async function pointsOf(ctx, org, seanceId, q = db) {
    const items = (await odj.get(ctx, org, seanceId)).items;
    const st = new Map((await q.all('SELECT * FROM seance_points WHERE seance_id = $1', [seanceId])).map((r) => [r.item_id, r]));
    return items.map((it) => {
      const p = st.get(it.id);
      return {
        id: it.id, position: it.position, kind: it.kind, numero: it.numero, titre: it.titre, statut: it.statut, acte: it.acte,
        etat: p?.etat || 'a_traiter', scrutin: p?.scrutin || 'main_levee', resultat: p?.resultat || null,
        decompte: p && p.votants !== null ? { pour: p.pour, contre: p.contre, abstention: p.abstention, nppv: p.nppv, absents: p.absents, votants: p.votants } : null,
        notes: p?.notes || '', debutAt: p?.debut_at || null, closAt: p?.close_at || null,
      };
    });
  }

  /** Amendements de la séance ; pour le point en cours : votes de chacun (saisie) — jamais le texte proposé aux non-habilités. */
  async function amendementsDe(seanceId, courantId, ids, dr, peutSaisir) {
    const rows = await db.all('SELECT * FROM seance_amendements WHERE seance_id = $1 ORDER BY item_id, numero', [seanceId]);
    const votes = new Map();
    const enCours = rows.filter((r) => r.item_id === courantId && r.statut === 'depose').map((r) => r.id);
    if (enCours.length) for (const v of await db.all('SELECT amendement_id, elu_id, choix FROM seance_amendement_votes WHERE amendement_id = ANY($1::int[])', [enCours])) {
      if (!votes.has(v.amendement_id)) votes.set(v.amendement_id, new Map());
      votes.get(v.amendement_id).set(v.elu_id, v.choix);
    }
    return rows.map((r) => {
      const live = r.statut === 'depose' && votes.has(r.id) ? rules.decompte(ids, dr, votes.get(r.id)) : (r.statut === 'depose' && r.item_id === courantId ? rules.decompte(ids, dr, new Map()) : null);
      return {
        id: r.id, itemId: r.item_id, numero: r.numero, auteur: r.auteur_libelle, auteurEluId: r.auteur_elu_id, auteurGroupeId: r.auteur_groupe_id, cible: r.cible, deliberationId: r.deliberation_id,
        statut: r.statut, motif: r.motif, resultat: r.resultat, decompte: r.votants !== null ? { pour: r.pour, contre: r.contre, abstention: r.abstention, nppv: r.nppv, absents: r.absents, votants: r.votants } : null,
        ...(peutSaisir ? { textePropose: r.texte_propose, decompteLive: live && { pour: live.pour, contre: live.contre, abstention: live.abstention, nppv: live.nppv, absents: live.absents, manquants: live.manquants }, votes: votes.has(r.id) ? Object.fromEntries(votes.get(r.id)) : {} } : {}),
      };
    });
  }

  const svc = {
    rules,
    /** Briques partagées avec les amendements (mêmes règles de présence, de pouvoir et de vote que les points). */
    internals: { membres, presencesOf, procurationsOf, journal, nomDe, itemOf },

    /** Données brutes de la séance (procès-verbal, extraits du registre) : aucun filtrage par rôle, l'appelant a déjà contrôlé les droits. `null` si la séance n'a pas été ouverte. */
    async donnees(ctx, organismeId, seanceId) {
      const org = requireOrg(organismeId);
      const s = await seances.get(org, seanceId);
      const t = await db.get('SELECT * FROM seance_tenue WHERE seance_id = $1', [seanceId]);
      if (!t) return null;
      const [membresList, presences, procs, points] = await Promise.all([membres(db, org, s), presencesOf(db, seanceId), procurationsOf(db, seanceId), pointsOf(ctx, org, seanceId)]);
      const votes = new Map();
      for (const r of await db.all('SELECT v.item_id, v.elu_id, v.choix, v.mandataire_elu_id FROM seance_votes v JOIN seance_items i ON i.id = v.item_id WHERE i.seance_id = $1', [seanceId])) {
        if (!votes.has(r.item_id)) votes.set(r.item_id, new Map());
        votes.get(r.item_id).set(r.elu_id, { choix: r.choix, mandataire: r.mandataire_elu_id });
      }
      const journalRows = (await db.all('SELECT id, item_id, elu_id, type, detail, actor, at FROM seance_journal WHERE seance_id = $1 ORDER BY id', [seanceId])).map((r) => ({ ...r, id: Number(r.id) }));
      const amendements = await db.all('SELECT * FROM seance_amendements WHERE seance_id = $1 ORDER BY item_id, numero', [seanceId]);
      return { seance: s, tenue: t, membres: membresList, presences, procurations: procs, points, votes, journal: journalRows, amendements };
    },

    async etat(ctx, organismeId, seanceId) {
      const org = requireOrg(organismeId);
      const s = await seances.get(org, seanceId);
      const peutSaisir = canWrite(ctx, org);
      const t = await db.get('SELECT * FROM seance_tenue WHERE seance_id = $1', [seanceId]);
      const base = { seance: { id: s.id, dateSeance: s.dateSeance, lieu: s.lieu, instance: s.instance, statut: s.statut, commission: s.commission ?? null }, peutSaisir };
      if (!t) return { ...base, tenue: { statut: 'non_ouverte', version: 0 }, points: [], groupes: [], procurations: [], quorum: rules.quorum(0, 0) };

      const [ms, presences, procs] = await Promise.all([membres(db, org, s), presencesOf(db, seanceId), procurationsOf(db, seanceId)]);
      // au conseil, le président de séance est par défaut le maire (modifiable) ; jamais pour une commission
      if (!t.president_elu_id && t.statut === 'ouverte' && !s.commission) {
        const maire = ms.find((m) => /^\s*(le |madame le |monsieur le )?maire\s*(\(.*\))?\s*$/i.test(m.role || ''));
        if (maire) { await db.run('UPDATE seance_tenue SET president_elu_id = $2 WHERE seance_id = $1 AND president_elu_id IS NULL', [seanceId, maire.id]); t.president_elu_id = maire.id; }
      }
      const points = await pointsOf(ctx, org, seanceId);
      const courant = points.find((p) => p.id === t.point_courant_id) || null;
      const ids = ms.map((m) => m.id);
      const dr = rules.droits(ids, presences, procs);
      const votes = courant ? await votesOf(db, courant.id) : new Map();
      const clos = courant && CLOS.includes(courant.etat);
      const mandantDe = new Map(procs.map((p) => [p.mandataire, p.mandant]));
      const pouvoirA = new Map(procs.map((p) => [p.mandant, p.mandataire]));
      const groupes = [];
      for (const m of ms) {
        const key = m.groupe_id ?? 0;
        let g = groupes.find((x) => x.id === key);
        if (!g) { g = { id: key, nom: m.groupe_nom || 'Sans groupe', couleur: m.groupe_couleur || null, elus: [] }; groupes.push(g); }
        const p = presences.get(m.id);
        g.elus.push({
          id: m.id, nom: m.nom, prenom: m.prenom, nomComplet: nomDe(m), role: m.role,
          presence: p ? (p.enSalle ? 'en_salle' : p.statut === 'present' ? 'sorti' : p.statut) : 'absent',
          droit: dr.get(m.id).droit, pouvoirA: pouvoirA.get(m.id) ?? null, pouvoirDe: mandantDe.get(m.id) ?? null,
          vote: votes.get(m.id) ?? null,
        });
      }
      // sans groupe en dernier
      groupes.sort((a, b) => (a.id === 0) - (b.id === 0));
      const amendements = await amendementsDe(seanceId, courant?.id ?? null, ids, dr, peutSaisir);
      const live = courant ? rules.decompte(ids, dr, votes) : null;
      const enSalle = ms.filter((m) => presences.get(m.id)?.enSalle).length;
      const out = {
        ...base,
        tenue: {
          statut: t.statut, version: t.version, pointCourantId: t.point_courant_id, presidentId: t.president_elu_id, secretaireId: t.secretaire_elu_id,
          ouverteAt: t.ouverte_at, closeAt: t.close_at,
        },
        points, amendements, groupes, procurations: procs.map((p) => ({ mandantId: p.mandant, mandataireId: p.mandataire })),
        quorum: rules.quorum(ms.length, enSalle),
        courant: courant ? { ...courant, clos: !!clos, decompteLive: live && { pour: live.pour, contre: live.contre, abstention: live.abstention, nppv: live.nppv, absents: live.absents, votants: live.votants, manquants: live.manquants.length } } : null,
      };
      if (peutSaisir) {
        out.notes = t.notes;
        out.journal = (await db.all('SELECT id, item_id, elu_id, type, detail, actor, at FROM seance_journal WHERE seance_id = $1 ORDER BY id DESC LIMIT 60', [seanceId]))
          .map((r) => ({ id: Number(r.id), itemId: r.item_id, eluId: r.elu_id, type: r.type, detail: r.detail, actor: r.actor, at: r.at }));
      } else {
        for (const p of out.points) delete p.notes;
        if (out.courant) delete out.courant.notes;
      }
      return out;
    },

    /**
     * Vue PUBLIQUE minimale pour l'espace élus (ELU-40, ELU-41) : point en cours et avancement, jamais de notes ni de décompte de saisie.
     * Attente longue comme `attendre`. `resultats` : afficher « adoptée / rejetée » une fois le vote clos (paramètre de l'organisme).
     */
    async directPublic(organismeId, seanceId, since, waitMs, { resultats = true } = {}) {
      const org = requireOrg(organismeId);
      const vue = async () => {
        const t = await db.get('SELECT version, statut, point_courant_id FROM seance_tenue WHERE seance_id = $1', [seanceId]);
        if (!t) return { version: 0, statut: 'non_ouverte', courantId: null, points: [] };
        const pts = await db.all('SELECT item_id, etat, resultat FROM seance_points WHERE seance_id = $1', [seanceId]);
        // amendements (ELU-41) : le texte proposé est poussé aux élus dès son dépôt ; le sort n'est montré que si l'organisme affiche les résultats
        const am = (await db.all('SELECT * FROM seance_amendements WHERE seance_id = $1 ORDER BY item_id, numero', [seanceId]))
          .map((a) => ({ id: a.id, itemId: a.item_id, numero: a.numero, auteur: a.auteur_libelle, cible: a.cible, texte: a.texte_propose, motif: a.motif, statut: a.statut === 'depose' ? 'a_voter' : a.statut === 'retire' ? 'retire' : (resultats ? a.statut : 'traite') }));
        return {
          version: t.version, statut: t.statut, courantId: t.point_courant_id, amendements: am,
          points: pts.map((p) => ({ id: p.item_id, etat: p.etat === 'en_cours' ? 'en_cours' : ['traite', 'sans_vote', 'retire', 'ajourne'].includes(p.etat) ? 'clos' : 'a_venir', issue: p.etat === 'traite' ? (resultats ? (String(p.resultat).startsWith('adopte') ? 'adopte' : 'rejete') : 'traite') : (['retire', 'ajourne', 'sans_vote'].includes(p.etat) ? p.etat : null) })),
        };
      };
      await seances.get(org, seanceId);
      const cur = await vue();
      if (cur.version > since || waitMs <= 0) return cur.version > since ? cur : { unchanged: true, version: cur.version };
      await new Promise((resolve) => {
        const done = () => { clearTimeout(timer); const w = waiters.get(seanceId); if (w) { w.delete(done); if (!w.size) waiters.delete(seanceId); } resolve(); };
        const timer = setTimeout(done, Math.min(waitMs, 30000));
        if (!waiters.has(seanceId)) waiters.set(seanceId, new Set());
        waiters.get(seanceId).add(done);
      });
      const apres = await vue();
      return apres.version > since ? apres : { unchanged: true, version: apres.version };
    },

    /** Attente longue : renvoie l'état dès que la version dépasse `since`, sinon `{ unchanged: true }` après `waitMs`. */
    async attendre(ctx, organismeId, seanceId, since, waitMs = 25000) {
      const org = requireOrg(organismeId);
      await seances.get(org, seanceId);
      const cur = async () => (await db.get('SELECT version FROM seance_tenue WHERE seance_id = $1', [seanceId]))?.version ?? 0;
      if ((await cur()) > since || waitMs <= 0) return (await cur()) > since ? svc.etat(ctx, org, seanceId) : { unchanged: true, version: await cur() };
      await new Promise((resolve) => {
        const done = () => { clearTimeout(timer); const w = waiters.get(seanceId); if (w) { w.delete(done); if (!w.size) waiters.delete(seanceId); } resolve(); };
        const timer = setTimeout(done, Math.min(waitMs, 30000));
        if (!waiters.has(seanceId)) waiters.set(seanceId, new Set());
        waiters.get(seanceId).add(done);
      });
      return (await cur()) > since ? svc.etat(ctx, org, seanceId) : { unchanged: true, version: await cur() };
    },

    /** Toute saisie : droits, tenue ouverte et non close, transaction, version +1, réveil des pages en attente. */
    async mutate(ctx, organismeId, seanceId, fn, { silent = false, allowClosed = false } = {}) {
      const org = requireOrg(organismeId);
      need(ctx, org);
      const s = await seances.get(org, seanceId);
      await db.tx(async (q) => {
        const t = await q.get('SELECT * FROM seance_tenue WHERE seance_id = $1 FOR UPDATE', [seanceId]);
        if (!t) throw E.conflict("La séance n'est pas ouverte : ouvrez d'abord le suivi de séance");
        if (t.statut === 'close' && !allowClosed) throw E.conflict('La séance est close : plus aucune saisie (un administrateur peut la déverrouiller)');
        await fn(q, t, s, org);
        if (!silent) await q.run('UPDATE seance_tenue SET version = version + 1, updated_at = now() WHERE seance_id = $1', [seanceId]);
      });
      if (!silent) wake(seanceId);
      return svc.etat(ctx, org, seanceId);
    },

    // ------------------------------------------------------------------------------------------ ouverture / clôture
    async ouvrir(ctx, organismeId, seanceId) {
      const org = requireOrg(organismeId);
      need(ctx, org);
      const s = await seances.get(org, seanceId);
      if (['annulee'].includes(s.statut)) throw E.conflict('Une séance annulée ne peut pas être ouverte');
      const t = await db.get('SELECT statut FROM seance_tenue WHERE seance_id = $1', [seanceId]);
      if (t) return svc.etat(ctx, org, seanceId);
      await db.tx(async (q) => {
        await q.run('INSERT INTO seance_tenue (seance_id, organisme_id, ouverte_par) VALUES ($1,$2,$3)', [seanceId, org, ctx.username]);
        await q.run("UPDATE seances SET statut = 'tenue' WHERE id = $1 AND statut IN ('planifiee', 'convoquee')", [seanceId]);
        await journal(q, seanceId, ctx, 'ouverture');
      });
      await audit.log(ctx, { organismeId: org, action: 'seance.tenue.ouverture', entity: 'seances', entityId: seanceId });
      wake(seanceId);
      return svc.etat(ctx, org, seanceId);
    },

    async cloturer(ctx, organismeId, seanceId) {
      const emettre = () => bus?.emit?.('tenue.close', { organismeId: requireOrg(organismeId), seanceId, ctx }); // archivage automatique en GED (facultatif)
      const out = await svc.mutate(ctx, organismeId, seanceId, async (q, t) => {
        const enCours = await q.get("SELECT it.numero, it.titre FROM seance_points p JOIN seance_items it ON it.id = p.item_id WHERE p.seance_id = $1 AND p.etat = 'en_cours' ORDER BY it.position LIMIT 1", [seanceId]);
        if (enCours) throw E.conflict(`Le point ${enCours.numero ? `n° ${enCours.numero} ` : ''}« ${enCours.titre || ''} » est encore en cours : clôturez-le (résultat, retrait ou ajournement) avant de clore la séance`);
        await q.run("UPDATE seance_tenue SET statut = 'close', close_at = now(), close_par = $2 WHERE seance_id = $1", [seanceId, ctx.username]);
        await q.run("UPDATE seances SET statut = 'close' WHERE id = $1 AND statut IN ('tenue', 'planifiee', 'convoquee')", [seanceId]);
        await journal(q, seanceId, ctx, 'cloture');
        void t;
      });
      await audit.log(ctx, { organismeId: requireOrg(organismeId), action: 'seance.tenue.cloture', entity: 'seances', entityId: seanceId });
      Promise.resolve(emettre()).catch(() => undefined);
      return out;
    },

    /** Déverrouillage après clôture (VOT-07) : administrateur seulement, motif obligatoire. */
    async deverrouiller(ctx, organismeId, seanceId, motif) {
      const org = requireOrg(organismeId);
      if (!ctx.isPlatformAdmin && !access.rolesIn(ctx, org).includes('org_admin')) throw E.forbidden('Seul un administrateur peut déverrouiller une séance close');
      const out = await svc.mutate(ctx, org, seanceId, async (q, t) => {
        if (t.statut !== 'close') throw E.conflict("La séance n'est pas close");
        await q.run("UPDATE seance_tenue SET statut = 'ouverte', close_at = NULL, close_par = NULL WHERE seance_id = $1", [seanceId]);
        await q.run("UPDATE seances SET statut = 'tenue' WHERE id = $1 AND statut = 'close'", [seanceId]);
        await journal(q, seanceId, ctx, 'deverrouillage', { detail: { motif } });
      }, { allowClosed: true });
      await audit.log(ctx, { organismeId: org, action: 'seance.tenue.deverrouillage', entity: 'seances', entityId: seanceId, after: { motif } });
      return out;
    },

    // ------------------------------------------------------------------------------------------ notes, bureau
    setNotes: (ctx, org, seanceId, notes) => svc.mutate(ctx, org, seanceId, (q) => q.run('UPDATE seance_tenue SET notes = $2 WHERE seance_id = $1', [seanceId, notes]), { silent: true }),

    setPointNotes: (ctx, org, seanceId, itemId, notes) => svc.mutate(ctx, org, seanceId, async (q) => {
      await itemOf(q, seanceId, itemId);
      await q.run(`INSERT INTO seance_points (item_id, seance_id, notes) VALUES ($1,$2,$3) ON CONFLICT (item_id) DO UPDATE SET notes = EXCLUDED.notes, updated_at = now()`, [itemId, seanceId, notes]);
    }, { silent: true }),

    setBureau: (ctx, org, seanceId, { presidentId, secretaireId }) => svc.mutate(ctx, org, seanceId, async (q, t, s, o) => {
      const ids = new Set((await membres(q, o, s)).map((m) => m.id));
      for (const [k, v] of [['président', presidentId], ['secrétaire', secretaireId]]) if (v && !ids.has(v)) throw E.badRequest(`Le ${k} de séance doit être un membre de l'instance`);
      if (presidentId !== undefined) await q.run('UPDATE seance_tenue SET president_elu_id = $2 WHERE seance_id = $1', [seanceId, presidentId]);
      if (secretaireId !== undefined) await q.run('UPDATE seance_tenue SET secretaire_elu_id = $2 WHERE seance_id = $1', [seanceId, secretaireId]);
      await journal(q, seanceId, ctx, 'bureau', { detail: { presidentId, secretaireId } });
    }),

    // ------------------------------------------------------------------------------------------ présences et pouvoirs
    /** `etat` : en_salle | sorti | absent | excuse, pour un ou plusieurs élus (tout un groupe d'un coup). Chaque changement est horodaté. */
    setPresences: (ctx, org, seanceId, { eluIds, etat }) => svc.mutate(ctx, org, seanceId, async (q, t, s, o) => {
      const ids = new Set((await membres(q, o, s)).map((m) => m.id));
      for (const id of eluIds) if (!ids.has(id)) throw E.badRequest("Cet élu n'est pas membre de l'instance");
      const before = await presencesOf(q, seanceId);
      for (const id of eluIds) {
        const b = before.get(id); const was = b ? (b.enSalle ? 'en_salle' : b.statut === 'present' ? 'sorti' : b.statut) : 'absent';
        if (was === etat) continue;
        if (etat === 'sorti' && was !== 'en_salle') continue; // « sorti » n'a de sens que pour un élu présent
        const statut = etat === 'en_salle' || etat === 'sorti' ? 'present' : etat;
        await q.run(`INSERT INTO seance_presences (seance_id, elu_id, statut, en_salle) VALUES ($1,$2,$3,$4)
                     ON CONFLICT (seance_id, elu_id) DO UPDATE SET statut = EXCLUDED.statut, en_salle = EXCLUDED.en_salle, updated_at = now()`, [seanceId, id, statut, etat === 'en_salle']);
        const type = etat === 'en_salle' ? (was === 'sorti' ? 'retour' : 'arrivee') : etat === 'sorti' ? 'sortie' : etat;
        await journal(q, seanceId, ctx, type, { eluId: id, itemId: t.point_courant_id });
      }
    }),

    setProcuration: (ctx, org, seanceId, { mandantId, mandataireId }) => svc.mutate(ctx, org, seanceId, async (q, t, s, o) => {
      const ms = await membres(q, o, s); const by = new Map(ms.map((m) => [m.id, m]));
      if (!by.has(mandantId) || !by.has(mandataireId)) throw E.badRequest("Le mandant et le mandataire doivent être membres de l'instance");
      if (mandantId === mandataireId) throw E.badRequest('Un élu ne peut pas se donner pouvoir à lui-même');
      const procs = await procurationsOf(q, seanceId);
      if (procs.some((p) => p.mandant === mandataireId)) throw E.conflict(`${nomDe(by.get(mandataireId))} a lui-même donné pouvoir : il ne peut pas être mandataire`);
      if (procs.some((p) => p.mandataire === mandantId)) throw E.conflict(`${nomDe(by.get(mandantId))} détient un pouvoir : il ne peut pas en donner un`);
      const deja = procs.find((p) => p.mandataire === mandataireId && p.mandant !== mandantId);
      if (deja) throw E.conflict(`${nomDe(by.get(mandataireId))} détient déjà le pouvoir de ${nomDe(by.get(deja.mandant))} (un seul pouvoir par mandataire)`);
      await q.run('DELETE FROM seance_procurations WHERE seance_id = $1 AND mandant_elu_id = $2', [seanceId, mandantId]);
      await q.run('INSERT INTO seance_procurations (seance_id, mandant_elu_id, mandataire_elu_id, created_by) VALUES ($1,$2,$3,$4)', [seanceId, mandantId, mandataireId, ctx.username]);
      await journal(q, seanceId, ctx, 'pouvoir', { eluId: mandantId, detail: { mandataireId } });
    }),

    removeProcuration: (ctx, org, seanceId, mandantId) => svc.mutate(ctx, org, seanceId, async (q) => {
      const r = await q.run('DELETE FROM seance_procurations WHERE seance_id = $1 AND mandant_elu_id = $2', [seanceId, mandantId]);
      if (r.changes) await journal(q, seanceId, ctx, 'pouvoir_retire', { eluId: mandantId });
    }),

    // ------------------------------------------------------------------------------------------ point en cours
    /** `itemId`, ou `sens` = suivant | precedent. Le point s'affiche pour tous les suiveurs au même instant. */
    setCourant: (ctx, org, seanceId, { itemId, sens }) => svc.mutate(ctx, org, seanceId, async (q, t) => {
      const points = await pointsOf(ctx, requireOrg(org), seanceId, q);
      let cible = itemId ?? null;
      if (!cible) {
        const v = rules.voisin(points, t.point_courant_id, sens);
        if (!v) throw E.conflict(sens === 'suivant' ? "Il n'y a plus de point à traiter" : "Il n'y a pas de point précédent");
        cible = v.id;
      }
      const p = points.find((x) => x.id === cible);
      if (!p) throw E.notFound("Point introuvable dans l'ordre du jour de cette séance");
      if (p.kind === 'chapitre') throw E.badRequest('Un chapitre ne se traite pas : choisissez un point');
      if (p.statut === 'retire') throw E.conflict('Ce point a été retiré de l\'ordre du jour');
      // on quitte un point ouvert sans aucune saisie : il redevient « à traiter »
      const prev = points.find((x) => x.id === t.point_courant_id);
      if (prev && prev.id !== cible && prev.etat === 'en_cours' && !prev.notes) {
        const n = await q.get('SELECT count(*)::int AS n FROM seance_votes WHERE item_id = $1', [prev.id]);
        if (!n.n) await q.run("UPDATE seance_points SET etat = 'a_traiter', debut_at = NULL, updated_at = now() WHERE item_id = $1", [prev.id]);
      }
      await q.run(`INSERT INTO seance_points (item_id, seance_id, etat, debut_at) VALUES ($1,$2,'en_cours', now())
                   ON CONFLICT (item_id) DO UPDATE SET etat = CASE WHEN seance_points.etat = 'a_traiter' THEN 'en_cours' ELSE seance_points.etat END,
                                                      debut_at = COALESCE(seance_points.debut_at, now()), updated_at = now()`, [cible, seanceId]);
      await q.run('UPDATE seance_tenue SET point_courant_id = $2 WHERE seance_id = $1', [seanceId, cible]);
      await journal(q, seanceId, ctx, 'point', { itemId: cible });
    }),

    setScrutin: (ctx, org, seanceId, itemId, scrutin) => svc.mutate(ctx, org, seanceId, async (q) => {
      await itemOf(q, seanceId, itemId);
      await q.run(`INSERT INTO seance_points (item_id, seance_id, scrutin) VALUES ($1,$2,$3) ON CONFLICT (item_id) DO UPDATE SET scrutin = EXCLUDED.scrutin, updated_at = now()`, [itemId, seanceId, scrutin]);
    }),

    // ------------------------------------------------------------------------------------------ votes
    /** `votes` : [{ eluId, choix }] (choix null : efface). Seuls ont le droit de voter les élus en salle et les mandants dont le mandataire est en salle. */
    setVotes: (ctx, org, seanceId, itemId, votes) => svc.mutate(ctx, org, seanceId, async (q, t, s, o) => {
      await itemOf(q, seanceId, itemId);
      const p = await q.get('SELECT etat FROM seance_points WHERE item_id = $1', [itemId]);
      if (p?.etat !== 'en_cours') throw E.conflict("Ce point n'est pas en cours de débat : les votes ne peuvent plus être modifiés (rouvrez le point)");
      const ms = await membres(q, o, s); const ids = ms.map((m) => m.id); const known = new Set(ids);
      const dr = rules.droits(ids, await presencesOf(q, seanceId), await procurationsOf(q, seanceId));
      for (const v of votes) {
        if (!known.has(v.eluId)) throw E.badRequest("Cet élu n'est pas membre de l'instance");
        if (dr.get(v.eluId).droit === 'aucun') continue; // absent, excusé ou sorti : ne prend pas part au vote (ni pour lui ni pour son mandant)
        if (v.choix === null) await q.run('DELETE FROM seance_votes WHERE item_id = $1 AND elu_id = $2', [itemId, v.eluId]);
        else await q.run(`INSERT INTO seance_votes (item_id, elu_id, choix, saisi_par) VALUES ($1,$2,$3,$4)
                          ON CONFLICT (item_id, elu_id) DO UPDATE SET choix = EXCLUDED.choix, at = now(), saisi_par = EXCLUDED.saisi_par`, [itemId, v.eluId, v.choix, ctx.username]);
      }
    }),

    /**
     * Clôture d'un point. `issue` : vote (décompte et résultat calculés), sans_vote (communication), retire, ajourne.
     * Le résultat d'un vote met à jour le statut de l'acte (adopté / rejeté) ; retiré / ajourné aussi.
     */
    cloturerPoint: (ctx, org, seanceId, itemId, { issue, motif }) => svc.mutate(ctx, org, seanceId, async (q, t, s, o) => {
      const it = await itemOf(q, seanceId, itemId);
      const p = await q.get('SELECT * FROM seance_points WHERE item_id = $1', [itemId]);
      if (it.kind === 'chapitre') throw E.badRequest('Un chapitre ne se clôture pas');
      if (p && CLOS.includes(p.etat)) throw E.conflict('Ce point est déjà clos : rouvrez-le pour le corriger');
      const setActe = async (statut) => {
        if (!it.acte_id) return;
        const r = await q.run(`UPDATE actes SET statut = $2 WHERE id = $1 AND statut <> ALL($3::text[])`, [it.acte_id, statut, ACTE_FINAUX.filter((x) => x !== statut)]);
        if (r.changes) await audit.log(ctx, { organismeId: o, action: 'acte.deliberation', entity: 'actes', entityId: it.acte_id, after: { statut, seanceId, itemId } });
      };
      let etat; let extra = {};
      if (issue === 'vote') {
        if (p?.etat !== 'en_cours') throw E.conflict("Ouvrez d'abord le point (il n'est pas en cours de débat)");
        const restants = (await q.get("SELECT count(*)::int AS n FROM seance_amendements WHERE item_id = $1 AND statut = 'depose'", [itemId])).n;
        if (restants) throw E.conflict(`${restants} amendement(s) restent à voter ou à retirer avant le vote du texte`);
        const ms = await membres(q, o, s); const ids = ms.map((m) => m.id);
        const dr = rules.droits(ids, await presencesOf(q, seanceId), await procurationsOf(q, seanceId));
        const votes = await votesOf(q, itemId);
        const d = rules.decompte(ids, dr, votes);
        if (ids.length && d.absents === ids.length) throw E.conflict('Personne n\'est en salle : aucun vote possible');
        if (d.manquants.length) {
          const by = new Map(ms.map((m) => [m.id, m]));
          throw E.conflict(`${d.manquants.length} élu(s) doivent encore voter : ${d.manquants.slice(0, 6).map((id) => nomDe(by.get(id))).join(', ')}${d.manquants.length > 6 ? '…' : ''}`);
        }
        const pres = t.president_elu_id; const presChoix = pres && dr.get(pres)?.droit === 'propre' ? votes.get(pres) : null;
        const res = rules.resultat(d, presChoix);
        if (res.partage) throw E.conflict('Partage des voix : la voix du président de séance est prépondérante — désignez le président (élu en salle) et saisissez son vote');
        for (const m of ms) {
          const droit = dr.get(m.id);
          await q.run(`INSERT INTO seance_votes (item_id, elu_id, choix, mandataire_elu_id, saisi_par) VALUES ($1,$2,$3,$4,$5)
                       ON CONFLICT (item_id, elu_id) DO UPDATE SET choix = EXCLUDED.choix, mandataire_elu_id = EXCLUDED.mandataire_elu_id, at = now(), saisi_par = EXCLUDED.saisi_par`,
          [itemId, m.id, droit.droit === 'aucun' ? 'absent' : votes.get(m.id), droit.mandataire, ctx.username]);
        }
        etat = 'traite'; extra = { resultat: res.resultat, ...d };
        await setActe(rules.ACTE_STATUT[res.resultat]);
      } else if (issue === 'sans_vote') etat = 'sans_vote';
      else { etat = issue; await setActe(issue); }
      await q.run(`INSERT INTO seance_points (item_id, seance_id, etat, resultat, pour, contre, abstention, nppv, absents, votants, close_at, close_par)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), $11)
                   ON CONFLICT (item_id) DO UPDATE SET etat = EXCLUDED.etat, resultat = EXCLUDED.resultat, pour = EXCLUDED.pour, contre = EXCLUDED.contre, abstention = EXCLUDED.abstention,
                     nppv = EXCLUDED.nppv, absents = EXCLUDED.absents, votants = EXCLUDED.votants, close_at = now(), close_par = EXCLUDED.close_par, updated_at = now()`,
      [itemId, seanceId, etat, extra.resultat ?? null, extra.pour ?? null, extra.contre ?? null, extra.abstention ?? null, extra.nppv ?? null, extra.absents ?? null, extra.votants ?? null, ctx.username]);
      await journal(q, seanceId, ctx, 'point_clos', { itemId, detail: { issue, etat, resultat: extra.resultat ?? null, motif: motif || null } });
    }),

    /** Correction après coup (VOT-07) : le point redevient « en cours », le décompte est effacé, le statut de l'acte revient à « inscrit à l'ordre du jour ». Motif obligatoire. */
    rouvrirPoint: (ctx, org, seanceId, itemId, motif) => svc.mutate(ctx, org, seanceId, async (q, t, s, o) => {
      const it = await itemOf(q, seanceId, itemId);
      const p = await q.get('SELECT etat FROM seance_points WHERE item_id = $1', [itemId]);
      if (!p || !CLOS.includes(p.etat)) throw E.conflict("Ce point n'est pas clos");
      await q.run("DELETE FROM seance_votes WHERE item_id = $1 AND choix = 'absent'", [itemId]);
      await q.run(`UPDATE seance_points SET etat = 'en_cours', resultat = NULL, pour = NULL, contre = NULL, abstention = NULL, nppv = NULL, absents = NULL, votants = NULL, close_at = NULL, close_par = NULL, updated_at = now() WHERE item_id = $1`, [itemId]);
      if (it.acte_id) {
        const r = await q.run("UPDATE actes SET statut = 'inscrit_odj' WHERE id = $1 AND statut IN ('adopte', 'rejete', 'retire', 'ajourne')", [it.acte_id]);
        if (r.changes) await audit.log(ctx, { organismeId: o, action: 'acte.deliberation.reouverture', entity: 'actes', entityId: it.acte_id, after: { motif, seanceId, itemId } });
      }
      await q.run('UPDATE seance_tenue SET point_courant_id = $2 WHERE seance_id = $1', [seanceId, itemId]);
      await journal(q, seanceId, ctx, 'point_rouvert', { itemId, detail: { motif } });
    }),
  };
  return svc;
}

module.exports = { createTenue };
