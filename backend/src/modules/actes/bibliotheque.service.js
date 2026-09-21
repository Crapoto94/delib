/**
 * Deux dispositifs distincts (REC-30, REC-31, D105) :
 *  1. la BIBLIOTHÈQUE DES ACTES de la collectivité : une fois la séance close, tout agent recherche et consulte les délibérations ADOPTÉES
 *     (texte, exposé des motifs, extrait du registre, annexes publiables), sans droit sur le dossier d'origine ; jamais les actes confidentiels ou à huis clos ;
 *  2. le TRAJET DE MES ACTES : les dossiers pour lesquels j'ai eu un rôle à un moment (rédacteur, valideur, remplaçant, commentateur…), avec leur trajet
 *     complet — circuit, modifications suivies, commentaires, amendements, vote, transmission — même non adoptés, même après la clôture.
 * Les droits sont indépendants : consulter la bibliothèque n'ouvre pas le trajet d'un acte, et un rôle sur un acte n'ouvre pas les autres.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const { analyser } = require('../recherche/recherche.service');

const CLOSES = "s.statut IN ('close', 'tenue') AND EXISTS (SELECT 1 FROM seance_tenue t WHERE t.seance_id = s.id AND t.statut = 'close')";
const RESULTATS = { adopte_unanimite: 'Adoptée à l’unanimité', adopte_majorite: 'Adoptée à la majorité', adopte_preponderante: 'Adoptée (voix prépondérante)', rejete: 'Rejetée', rejete_preponderante: 'Rejetée (voix prépondérante)' };

function createBibliotheque({ db, audit, render, pv, textes }) {
  /** Contexte technique : la bibliothèque ouvre des actes que la personne ne peut pas voir autrement ; l'accès est contrôlé ici, et journalisé au nom de la personne. */
  const sys = (ctx) => ({ ...ctx, isPlatformAdmin: true });

  /** Délibération adoptée, séance close, non confidentielle : la seule qui entre dans la bibliothèque. */
  const eligible = (org, acteId) => db.get(`
    SELECT a.id, a.numero_suivi, a.titre, a.statut, a.type_id, a.matiere_id, a.direction_label, a.direction_code, a.confidentialite, a.montant, a.incidence_financiere,
           it.id AS item_id, it.numero, it.deliberation_id, s.id AS seance_id, s.date_seance, i.nom AS instance, sp.resultat
    FROM actes a JOIN seance_items it ON it.acte_id = a.id AND it.statut = 'a_traiter' AND it.kind = 'deliberation'
    JOIN seances s ON s.id = it.seance_id AND ${CLOSES}
    JOIN instances i ON i.id = s.instance_id
    JOIN seance_points sp ON sp.item_id = it.id AND sp.etat = 'traite' AND sp.resultat LIKE 'adopte%'
    WHERE a.organisme_id = $1 AND a.id = $2 AND a.confidentialite = 'normale' AND a.statut NOT IN ('abandonne', 'retire')
    ORDER BY s.date_seance DESC LIMIT 1`, [org, acteId]);

  const svc = {
    RESULTATS,

    // ---------------------------------------------------------------------------------------------------------- 1. bibliothèque
    async chercher(ctx, organismeId, { q = '', annee, matiereId, natureId, rubriqueId, instanceId, rapporteurId, directionCode, du, au, limit = 20, offset = 0 } = {}) {
      const org = requireOrg(organismeId); const p = [org]; const add = (v) => { p.push(v); return `$${p.length}`; };
      const w = ['a.organisme_id = $1', "a.confidentialite = 'normale'", "a.statut NOT IN ('abandonne', 'retire')", "sp.resultat LIKE 'adopte%'"];
      let rang = '0::float4';
      const an = analyser(q, { poids: 'ABC' }); // titre, objet, matière, dispositif, exposé, visas : jamais les annexes
      if (an.numero) { if (an.numero.suivi !== null) w.push(`a.numero_suivi = ${add(an.numero.suivi)}`); else w.push(`upper(it.numero) = ${add(an.numero.ref.toUpperCase())}`); }
      else if (an.tsq) { const t = add(an.tsq); w.push(`si.tsv @@ to_tsquery('fr_unaccent', ${t})`); rang = `ts_rank(si.tsv, to_tsquery('fr_unaccent', ${t}))`; }
      if (annee) w.push(`EXTRACT(year FROM s.date_seance AT TIME ZONE 'Europe/Paris') = ${add(Number(annee))}`);
      if (matiereId) w.push(`a.matiere_id = ${add(Number(matiereId))}`);
      if (natureId) w.push(`a.nature_id = ${add(Number(natureId))}`);
      if (rubriqueId) w.push(`a.rubrique_id = ${add(Number(rubriqueId))}`);
      if (rapporteurId) w.push(`a.rapporteur_id = ${add(Number(rapporteurId))}`);
      if (directionCode) w.push(`a.direction_code = ${add(directionCode)}`);
      if (instanceId) w.push(`s.instance_id = ${add(Number(instanceId))}`);
      if (du) w.push(`s.date_seance >= ${add(du)}`);
      if (au) w.push(`s.date_seance < (${add(au)}::date + interval '1 day')`);
      const from = `FROM actes a JOIN seance_items it ON it.acte_id = a.id AND it.statut = 'a_traiter' AND it.kind = 'deliberation'
        JOIN seances s ON s.id = it.seance_id AND ${CLOSES} JOIN instances i ON i.id = s.instance_id
        JOIN seance_points sp ON sp.item_id = it.id AND sp.etat = 'traite' LEFT JOIN search_index si ON si.acte_id = a.id
        LEFT JOIN ref_items m ON m.id = a.matiere_id LEFT JOIN elus ra ON ra.id = a.rapporteur_id WHERE ${w.join(' AND ')}`;
      const total = (await db.get(`SELECT count(DISTINCT a.id)::int AS n ${from}`, p)).n;
      const rows = await db.all(`SELECT DISTINCT ON (a.id) a.id, a.numero_suivi, a.titre, a.direction_label, a.direction_code, m.libelle AS matiere, it.numero, s.date_seance, i.nom AS instance, sp.resultat, NULLIF(trim(ra.prenom || ' ' || ra.nom), '') AS rapporteur, ${rang} AS rang ${from}
        ORDER BY a.id, s.date_seance DESC`, p);
      rows.sort((x, y) => (Number(y.rang) - Number(x.rang)) || (new Date(y.date_seance) - new Date(x.date_seance)));
      return {
        total, items: rows.slice(Number(offset), Number(offset) + Number(limit)).map((r) => ({
          acteId: r.id, numeroSuivi: r.numero_suivi, titre: r.titre, numero: r.numero, direction: r.direction_label, directionCode: r.direction_code, matiere: r.matiere, rapporteur: r.rapporteur, dateSeance: r.date_seance, instance: r.instance, resultat: r.resultat, resultatLabel: RESULTATS[r.resultat] || null,
        })),
      };
    },

    /** Fiche de consultation : métadonnées, exposé, visas et dispositif, annexes publiables. Journalisée. */
    async consulter(ctx, organismeId, acteId) {
      const org = requireOrg(organismeId); const a = await eligible(org, acteId);
      if (!a) throw E.notFound("Cet acte n'est pas dans la bibliothèque (il n'est pas adopté, sa séance n'est pas close ou il est confidentiel)");
      const rows = await db.all('SELECT id, kind, deliberation_id, markdown FROM tracked_texts WHERE acte_id = $1 ORDER BY id', [a.id]);
      const pick = (kind) => rows.find((t) => t.kind === kind && (kind === 'expose' ? true : t.deliberation_id === a.deliberation_id))?.markdown || '';
      const annexes = await db.all(`SELECT an.id, an.titre, f.original_name, f.mime, f.size FROM annexes an JOIN files f ON f.id = an.file_id WHERE an.acte_id = $1 AND an.publiable ORDER BY an.ordre, an.id`, [a.id]);
      const matiere = a.matiere_id ? (await db.get('SELECT libelle FROM ref_items WHERE id = $1', [a.matiere_id]))?.libelle : null;
      await audit.log(ctx, { organismeId: org, action: 'bibliotheque.consultation', entity: 'actes', entityId: a.id });
      return {
        acteId: a.id, numeroSuivi: a.numero_suivi, titre: a.titre, numero: a.numero, matiere, direction: a.direction_label, montant: a.montant === null ? null : Number(a.montant),
        seance: { id: a.seance_id, dateSeance: a.date_seance, instance: a.instance }, resultat: a.resultat, resultatLabel: RESULTATS[a.resultat] || null,
        expose: pick('expose'), visas: pick('visas'), dispositif: pick('dispositif'), annexes: annexes.map((x) => ({ id: x.id, titre: x.titre || x.original_name, nom: x.original_name, mime: x.mime, taille: Number(x.size) })),
        documents: [{ cible: 'expose', label: 'Exposé des motifs' }, { cible: 'deliberation', label: 'Délibération' }, { cible: 'extrait', label: 'Extrait du registre' }],
      };
    },

    /** PDF consultable : exposé des motifs, délibération ou extrait du registre (avec le tampon de la préfecture quand l'AR est reçu). */
    async pdf(ctx, organismeId, acteId, cible) {
      const org = requireOrg(organismeId); const a = await eligible(org, acteId);
      if (!a) throw E.notFound("Cet acte n'est pas dans la bibliothèque");
      const s = sys(ctx);
      await audit.log(ctx, { organismeId: org, action: 'bibliotheque.pdf', entity: 'actes', entityId: a.id, after: { cible } });
      if (cible === 'extrait') return pv.extrait(s, org, a.seance_id, a.item_id);
      if (cible === 'expose') { const r = await render.renderActe(s, org, a.id, { cible: 'expose', mode: 'propre' }); return { buffer: r.buffer, name: `expose-des-motifs-${a.numero || a.numero_suivi}.pdf` }; }
      if (cible === 'deliberation') { const r = await render.renderActe(s, org, a.id, { cible: 'deliberation', deliberationId: a.deliberation_id, mode: 'propre' }); return { buffer: r.buffer, name: `deliberation-${a.numero || a.numero_suivi}.pdf` }; }
      throw E.badRequest('Document inconnu : expose, deliberation ou extrait');
    },

    // ---------------------------------------------------------------------------------------------------- 2. le trajet de mes actes
    /** Rôles que j'ai eus sur un acte (vide : aucun → aucun accès au trajet). */
    async rolesSur(ctx, organismeId, acteId) {
      const u = ctx.username;
      const r = await db.get(`SELECT a.redacteur = $3 AS redacteur, COALESCE(a.co_redacteurs ? $3, false) AS co_redacteur,
          EXISTS (SELECT 1 FROM step_instances i WHERE i.acte_id = a.id AND (i.acted_by = $3 OR i.on_behalf_of = $3 OR i.holders ? $3)) AS valideur,
          EXISTS (SELECT 1 FROM step_instances i WHERE i.acte_id = a.id AND i.acted_by = $3 AND i.on_behalf_of IS NOT NULL) AS remplacant,
          EXISTS (SELECT 1 FROM comments c WHERE c.acte_id = a.id AND c.author = $3 AND NOT c.hidden) AS commentateur,
          COALESCE(a.participants ? $3, false) AS participant
        FROM actes a WHERE a.organisme_id = $1 AND a.id = $2`, [requireOrg(organismeId), acteId, u]);
      if (!r) return [];
      return Object.entries({ redacteur: 'Rédacteur', co_redacteur: 'Co-rédacteur', valideur: 'Valideur', remplacant: 'Remplaçant', commentateur: 'Commentaire', participant: 'Dans le circuit' }).filter(([k]) => r[k]).map(([k, label]) => ({ code: k, label }));
    },

    async mesActes(ctx, organismeId, { annee, role, q, limit = 30, offset = 0 } = {}) {
      const org = requireOrg(organismeId); const u = ctx.username; const p = [org, u]; const add = (v) => { p.push(v); return `$${p.length}`; };
      const w = ['a.organisme_id = $1', `(a.redacteur = $2 OR a.co_redacteurs ? $2 OR a.participants ? $2 OR EXISTS (SELECT 1 FROM step_instances i WHERE i.acte_id = a.id AND (i.acted_by = $2 OR i.on_behalf_of = $2 OR i.holders ? $2))
        OR EXISTS (SELECT 1 FROM comments c WHERE c.acte_id = a.id AND c.author = $2 AND NOT c.hidden))`];
      if (q) w.push(`(lower(a.titre) LIKE ${add(`%${String(q).trim().toLowerCase()}%`)} OR a.numero_suivi::text = ${add(String(q).trim())})`);
      if (annee) w.push(`EXTRACT(year FROM a.created_at) = ${add(Number(annee))}`);
      const rows = await db.all(`SELECT a.id, a.numero_suivi, a.titre, a.statut, a.created_at, a.redacteur,
          (SELECT s.date_seance FROM seance_items it JOIN seances s ON s.id = it.seance_id WHERE it.acte_id = a.id AND it.statut = 'a_traiter' ORDER BY s.date_seance DESC LIMIT 1) AS date_seance,
          (SELECT sp.resultat FROM seance_items it JOIN seance_points sp ON sp.item_id = it.id WHERE it.acte_id = a.id ORDER BY it.id DESC LIMIT 1) AS resultat
        FROM actes a WHERE ${w.join(' AND ')} ORDER BY a.created_at DESC LIMIT 500`, p);
      const out = [];
      for (const r of rows) {
        const roles = await svc.rolesSur(ctx, org, r.id);
        if (role && !roles.some((x) => x.code === role)) continue;
        out.push({ acteId: r.id, numeroSuivi: r.numero_suivi, titre: r.titre, statut: r.statut, creeLe: r.created_at, dateSeance: r.date_seance, resultat: r.resultat, resultatLabel: RESULTATS[r.resultat] || null, redacteur: r.redacteur, roles });
      }
      return { total: out.length, items: out.slice(Number(offset), Number(offset) + Number(limit)) };
    },

    /** Fiche de trajet : circuit complet, modifications suivies, commentaires, amendements, vote, transmission — et la chronologie de tout cela. */
    async trajet(ctx, organismeId, acteId) {
      const org = requireOrg(organismeId); const roles = await svc.rolesSur(ctx, org, acteId);
      if (!roles.length) throw E.notFound("Vous n'avez pas eu de rôle sur cet acte");
      const a = await db.get('SELECT * FROM actes WHERE id = $1 AND organisme_id = $2', [acteId, org]);
      const circuit = (await db.all('SELECT * FROM step_instances WHERE acte_id = $1 ORDER BY id', [a.id])).map((i) => ({
        id: i.id, cle: i.step_key, label: i.label, tour: i.round, statut: i.status, decision: i.decision, par: i.acted_by, pour: i.on_behalf_of, arriveLe: i.arrived_at, agiLe: i.acted_at, commentaire: i.comment || i.reason || null, ponctuelle: i.adhoc,
      }));
      const versions = await db.all(`SELECT tt.kind, v.version_no, v.author, v.reason, v.created_at FROM text_versions v JOIN tracked_texts tt ON tt.id = v.text_id WHERE tt.acte_id = $1 ORDER BY v.created_at, v.id`, [a.id]);
      const commentaires = (await db.all('SELECT id, author, kind, title, body, step_key, created_at FROM comments WHERE acte_id = $1 AND NOT hidden ORDER BY created_at, id', [a.id])).map((c) => ({ id: c.id, auteur: c.author, type: c.kind, titre: c.title, texte: c.body, etape: c.step_key, le: c.created_at }));
      const points = await db.all(`SELECT it.id AS item_id, it.numero, s.id AS seance_id, s.date_seance, i.nom AS instance, sp.resultat, sp.pour, sp.contre, sp.abstention, sp.nppv, sp.close_at
        FROM seance_items it JOIN seances s ON s.id = it.seance_id JOIN instances i ON i.id = s.instance_id LEFT JOIN seance_points sp ON sp.item_id = it.id WHERE it.acte_id = $1 ORDER BY s.date_seance`, [a.id]);
      const amendements = points.length ? (await db.all(`SELECT am.numero, am.auteur_libelle, am.cible, am.statut, am.resultat, am.motif, am.texte_avant, am.texte_propose, am.created_at, am.item_id
        FROM seance_amendements am WHERE am.item_id = ANY($1::int[]) ORDER BY am.item_id, am.numero`, [points.map((x) => x.item_id)])).map((m) => ({
        numero: m.numero, auteur: m.auteur_libelle, cible: m.cible, statut: m.statut, resultat: m.resultat, resultatLabel: RESULTATS[m.resultat] || null, motif: m.motif, avant: m.texte_avant, propose: m.texte_propose, depuisLe: m.created_at,
      })) : [];
      const tx = await db.all('SELECT numero_transmis, etat, status_label, prepared_at, sent_at, ar_at, ar_id FROM tlt_transactions WHERE acte_id = $1 ORDER BY id', [a.id]);

      const chrono = [
        { le: a.created_at, type: 'creation', texte: `Dossier créé par ${a.redacteur}` },
        ...circuit.filter((c) => c.arriveLe).map((c) => ({ le: c.arriveLe, type: 'etape', texte: `Arrivée à l'étape « ${c.label} »${c.tour > 1 ? ` (tour ${c.tour})` : ''}` })),
        ...circuit.filter((c) => c.agiLe).map((c) => ({ le: c.agiLe, type: c.decision === 'refus' || c.statut === 'returned' ? 'refus' : 'validation', texte: `${c.decision === 'refus' || c.statut === 'returned' ? 'Modification demandée' : 'Validé'} à « ${c.label} » par ${c.par}${c.pour ? ` (pour ${c.pour})` : ''}${c.commentaire ? ` : ${c.commentaire}` : ''}` })),
        ...commentaires.map((c) => ({ le: c.le, type: 'commentaire', texte: `${c.auteur} : ${String(c.texte).slice(0, 160)}` })),
        ...points.filter((x) => x.close_at).map((x) => ({ le: x.close_at, type: 'vote', texte: `Vote en séance (${x.instance}) : ${RESULTATS[x.resultat] || x.resultat || 'sans vote'}${x.pour !== null ? ` — ${x.pour} pour, ${x.contre} contre, ${x.abstention} abstention(s)` : ''}` })),
        ...amendements.map((m) => ({ le: m.depuisLe, type: 'amendement', texte: `Amendement n° ${m.numero} de ${m.auteur} (${m.statut}${m.resultatLabel ? ` : ${m.resultatLabel}` : ''})` })),
        ...tx.filter((x) => x.sent_at).map((x) => ({ le: x.sent_at, type: 'transmission', texte: `Transmis au contrôle de légalité (${x.numero_transmis})` })),
        ...tx.filter((x) => x.ar_at).map((x) => ({ le: x.ar_at, type: 'ar', texte: `Accusé de réception de la préfecture (${x.ar_id})` })),
      ].sort((x, y) => new Date(x.le) - new Date(y.le));

      await audit.log(ctx, { organismeId: org, action: 'trajet.consultation', entity: 'actes', entityId: a.id });
      void textes;
      return {
        acte: { id: a.id, numeroSuivi: a.numero_suivi, titre: a.titre, statut: a.statut, redacteur: a.redacteur, direction: a.direction_label, creeLe: a.created_at }, roles, circuit,
        modifications: { versions: versions.length, auteurs: [...new Set(versions.map((v) => v.author))], parTexte: ['expose', 'visas', 'dispositif'].map((k) => ({ texte: k, versions: versions.filter((v) => v.kind === k).length })) },
        commentaires, vote: points.map((x) => ({ seance: x.instance, dateSeance: x.date_seance, numero: x.numero, resultat: x.resultat, resultatLabel: RESULTATS[x.resultat] || null, pour: x.pour, contre: x.contre, abstention: x.abstention, nppv: x.nppv })),
        amendements, transmissions: tx.map((x) => ({ numero: x.numero_transmis, etat: x.etat, statut: x.status_label, preparee: x.prepared_at, envoyee: x.sent_at, arLe: x.ar_at, arId: x.ar_id })), chronologie: chrono,
      };
    },
  };
  return svc;
}

module.exports = { createBibliotheque, RESULTATS };
