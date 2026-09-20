/**
 * Amendements en séance (VOT-06, LIVE-14, D92). Déposés par le secrétariat sur un point (délibération), votés AVANT le texte avec les mêmes
 * règles que le point (qui vote, décompte, voix prépondérante). Adopté : le texte de la partie visée est remplacé avec suivi des modifications
 * (auteur « Amendement n°X ») ; rejeté ou retiré : le texte ne change pas.
 */
const { E } = require('../../shared/errors');

const KINDS = ['expose', 'visas', 'dispositif'];
const SYS = (org) => ({ username: 'seance-amendement', kind: 'system', isPlatformAdmin: true, organismes: [], roles: [], orgIds: [org], agent: null, displayName: 'Séance' });

function createAmendements({ db, audit, tenue, textes }) {
  const { rules, internals } = tenue;
  const { membres, presencesOf, procurationsOf, journal, nomDe, itemOf } = internals;

  async function point(q, seanceId, itemId) {
    const it = await itemOf(q, seanceId, itemId);
    if (it.kind !== 'deliberation' || !it.acte_id) throw E.badRequest('Un amendement porte sur une délibération de l\'ordre du jour');
    const p = await q.get('SELECT etat FROM seance_points WHERE item_id = $1', [itemId]);
    return { it, etat: p?.etat || 'a_traiter' };
  }
  async function amendement(q, seanceId, id) {
    const a = await q.get('SELECT * FROM seance_amendements WHERE id = $1 AND seance_id = $2', [id, seanceId]);
    if (!a) throw E.notFound('Amendement introuvable');
    return a;
  }
  const aTraiter = (a) => { if (a.statut !== 'depose') throw E.conflict(`Cet amendement est déjà « ${a.statut} »`); };

  return {
    /** Texte actuel de la partie visée (pour préremplir le texte proposé). */
    async texteActuel(ctx, organismeId, seanceId, itemId, cible) {
      if (!KINDS.includes(cible)) throw E.badRequest('Partie du texte inconnue');
      const { it } = await point(db, seanceId, itemId);
      const t = await db.get('SELECT markdown FROM tracked_texts WHERE acte_id = $1 AND kind = $2 AND deliberation_id IS NOT DISTINCT FROM $3', [it.acte_id, cible, cible === 'expose' ? null : it.deliberation_id]);
      if (!t) throw E.notFound('Texte introuvable');
      return { markdown: t.markdown };
    },

    /** Dépose un amendement sur un point (avant le vote du texte). */
    deposer: (ctx, org, seanceId, itemId, b) => tenue.mutate(ctx, org, seanceId, async (q, t, s, o) => {
      const { it, etat } = await point(q, seanceId, itemId);
      if (['traite', 'retire', 'ajourne'].includes(etat)) throw E.conflict('Ce point est clos : plus d\'amendement (rouvrez le point pour corriger)');
      if (!KINDS.includes(b.cible)) throw E.badRequest('Partie du texte inconnue');
      const cur = await q.get('SELECT markdown FROM tracked_texts WHERE acte_id = $1 AND kind = $2 AND deliberation_id IS NOT DISTINCT FROM $3', [it.acte_id, b.cible, b.cible === 'expose' ? null : it.deliberation_id]);
      if (!cur) throw E.badRequest('Le point n\'a pas de texte à amender');
      if (String(b.textePropose).trim() === String(cur.markdown).trim()) throw E.badRequest('Le texte proposé est identique au texte actuel : rien à amender');
      let auteur = String(b.auteurLibelle || '').trim(); let eluId = null; let groupeId = null;
      if (b.auteurEluId) {
        const e = await q.get('SELECT id, nom, prenom FROM elus WHERE id = $1 AND organisme_id = $2', [b.auteurEluId, o]);
        if (!e) throw E.badRequest('Élu inconnu'); eluId = e.id; auteur = nomDe(e);
      } else if (b.auteurGroupeId) {
        const g = await q.get('SELECT id, nom FROM groupes_politiques WHERE id = $1 AND organisme_id = $2', [b.auteurGroupeId, o]);
        if (!g) throw E.badRequest('Groupe inconnu'); groupeId = g.id; auteur = `Groupe ${g.nom}`;
      }
      if (!auteur) throw E.badRequest('Indiquez l\'auteur de l\'amendement');
      const numero = ((await q.get('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM seance_amendements WHERE item_id = $1', [itemId])).n);
      const r = await q.get(
        `INSERT INTO seance_amendements (organisme_id, seance_id, item_id, numero, auteur_elu_id, auteur_groupe_id, auteur_libelle, cible, deliberation_id, texte_propose, motif, scrutin, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [o, seanceId, itemId, numero, eluId, groupeId, auteur, b.cible, b.cible === 'expose' ? null : it.deliberation_id, b.textePropose, b.motif || '', b.scrutin || 'main_levee', ctx.username]);
      await journal(q, seanceId, ctx, 'amendement_depose', { itemId, detail: { amendement: numero, auteur, cible: b.cible } });
      await audit.log(ctx, { organismeId: o, action: 'seance.amendement.depot', entity: 'seance_amendements', entityId: r.id, after: { seanceId, itemId, numero, auteur, cible: b.cible } });
    }),

    /** Votes sur un amendement : mêmes droits que pour un point (`choix: null` efface). Le point doit être en cours. */
    voter: (ctx, org, seanceId, amendId, votes) => tenue.mutate(ctx, org, seanceId, async (q, t, s, o) => {
      const a = await amendement(q, seanceId, amendId); aTraiter(a);
      const { etat } = await point(q, seanceId, a.item_id);
      if (etat !== 'en_cours') throw E.conflict('Le point n\'est pas en cours de débat : ouvrez-le pour voter l\'amendement');
      const ms = await membres(q, o, s); const ids = ms.map((m) => m.id); const known = new Set(ids);
      const dr = rules.droits(ids, await presencesOf(q, seanceId), await procurationsOf(q, seanceId));
      for (const v of votes) {
        if (!known.has(v.eluId)) throw E.badRequest('Cet élu n\'est pas membre de l\'instance');
        if (dr.get(v.eluId).droit === 'aucun') continue;
        if (v.choix === null) await q.run('DELETE FROM seance_amendement_votes WHERE amendement_id = $1 AND elu_id = $2', [amendId, v.eluId]);
        else await q.run(`INSERT INTO seance_amendement_votes (amendement_id, elu_id, choix, saisi_par) VALUES ($1,$2,$3,$4)
                          ON CONFLICT (amendement_id, elu_id) DO UPDATE SET choix = EXCLUDED.choix, at = now(), saisi_par = EXCLUDED.saisi_par`, [amendId, v.eluId, v.choix, ctx.username]);
      }
    }),

    /**
     * Clôture : `vote` (résultat calculé ; adopté = le texte est modifié avec suivi) ou `retire`.
     */
    cloturer: (ctx, org, seanceId, amendId, { issue }) => tenue.mutate(ctx, org, seanceId, async (q, t, s, o) => {
      const a = await amendement(q, seanceId, amendId); aTraiter(a);
      if (issue === 'retire') {
        await q.run("UPDATE seance_amendements SET statut = 'retire', close_at = now(), close_par = $2 WHERE id = $1", [amendId, ctx.username]);
        await journal(q, seanceId, ctx, 'amendement_clos', { itemId: a.item_id, detail: { amendement: a.numero, issue: 'retire' } });
        return;
      }
      const { it, etat } = await point(q, seanceId, a.item_id);
      if (etat !== 'en_cours') throw E.conflict('Le point n\'est pas en cours de débat');
      const ms = await membres(q, o, s); const ids = ms.map((m) => m.id);
      const dr = rules.droits(ids, await presencesOf(q, seanceId), await procurationsOf(q, seanceId));
      const votes = new Map((await q.all('SELECT elu_id, choix FROM seance_amendement_votes WHERE amendement_id = $1', [amendId])).map((r) => [r.elu_id, r.choix]));
      const d = rules.decompte(ids, dr, votes);
      if (ids.length && d.absents === ids.length) throw E.conflict('Personne n\'est en salle : aucun vote possible');
      if (d.manquants.length) { const by = new Map(ms.map((m) => [m.id, m])); throw E.conflict(`${d.manquants.length} élu(s) doivent encore voter : ${d.manquants.slice(0, 6).map((id) => nomDe(by.get(id))).join(', ')}${d.manquants.length > 6 ? '…' : ''}`); }
      const pres = t.president_elu_id; const presChoix = pres && dr.get(pres)?.droit === 'propre' ? votes.get(pres) : null;
      const res = rules.resultat(d, presChoix);
      if (res.partage) throw E.conflict('Partage des voix : la voix du président de séance est prépondérante — désignez le président (élu en salle) et saisissez son vote');
      for (const m of ms) {
        const droit = dr.get(m.id);
        await q.run(`INSERT INTO seance_amendement_votes (amendement_id, elu_id, choix, mandataire_elu_id, saisi_par) VALUES ($1,$2,$3,$4,$5)
                     ON CONFLICT (amendement_id, elu_id) DO UPDATE SET choix = EXCLUDED.choix, mandataire_elu_id = EXCLUDED.mandataire_elu_id, at = now(), saisi_par = EXCLUDED.saisi_par`,
        [amendId, m.id, droit.droit === 'aucun' ? 'absent' : votes.get(m.id), droit.mandataire, ctx.username]);
      }
      const adopte = res.resultat.startsWith('adopte');
      let avant = null; let version = null;
      if (adopte) { // le texte de la délibération est modifié, avec suivi, au nom de l'amendement
        const sys = { ...SYS(o), displayName: `Amendement n°${a.numero} (${a.auteur_libelle})`, username: `amendement-${a.id}` };
        const r = await textes.amender(sys, o, it.acte_id, { deliberationId: a.deliberation_id, kind: a.cible, markdown: a.texte_propose, reason: `Amendement n°${a.numero}` });
        avant = r.avant; version = r.version;
      }
      await q.run(`UPDATE seance_amendements SET statut = $2, resultat = $3, pour = $4, contre = $5, abstention = $6, nppv = $7, absents = $8, votants = $9, texte_avant = $10, version_apres = $11, close_at = now(), close_par = $12 WHERE id = $1`,
        [amendId, adopte ? 'adopte' : 'rejete', res.resultat, d.pour, d.contre, d.abstention, d.nppv, d.absents, d.votants, avant, version, ctx.username]);
      await journal(q, seanceId, ctx, 'amendement_clos', { itemId: a.item_id, detail: { amendement: a.numero, issue: 'vote', resultat: res.resultat } });
      await audit.log(ctx, { organismeId: o, action: 'seance.amendement.vote', entity: 'seance_amendements', entityId: amendId, after: { resultat: res.resultat, pour: d.pour, contre: d.contre, abstention: d.abstention } });
    }),
  };
}

module.exports = { createAmendements, KINDS };
