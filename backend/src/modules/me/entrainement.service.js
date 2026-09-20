/**
 * Dossier d'entraînement (UX-22) : un bac à sable pour s'exercer pendant la visite guidée.
 * C'est un vrai dossier brouillon (on peut rédiger, suivre les modifications, essayer l'assistant IA, commenter) marqué
 * `custom.entrainement`, mais : il ne s'envoie JAMAIS au circuit (garde dans le moteur), n'entre pas dans la recherche
 * et se purge tout seul (abandonné après 14 jours).
 */
const { E } = require('../../shared/errors');

const TITRE = 'Entraînement — Subvention à l’association « Les Petits Débrouillards »';
const TEXTES = {
  expose: "L’association « Les Petits Débrouillards » propose chaque mercredi des ateliers scientifiques gratuits pour les enfants de la ville. Elle sollicite une subvention pour financer le matériel de l’année.\n\nCeci est un texte d’exemple : modifiez-le, corrigez-le, essayez l’assistant IA.",
  visas: "Vu le code général des collectivités territoriales, notamment son article L2121-29 ;\n\nConsidérant que l’association contribue à l’éducation scientifique des jeunes Ivryens ;\n\nConsidérant que les crédits sont inscrits au budget de l’exercice.",
  dispositif: "Article 1 : une subvention de 3 000 € est accordée à l’association « Les Petits Débrouillards » au titre de l’année en cours.\n\nArticle 2 : la dépense sera imputée sur les crédits ouverts au budget.",
};

function createEntrainement({ db, actes, textes, audit }) {
  const est = (a) => !!a?.custom?.entrainement;
  return {
    est,

    /** Crée (ou retrouve) mon dossier d'entraînement en cours. */
    async creer(ctx, organismeId) {
      const org = organismeId;
      const deja = await db.get("SELECT id FROM actes WHERE organisme_id = $1 AND redacteur = $2 AND custom ? 'entrainement' AND statut = 'brouillon' ORDER BY id DESC LIMIT 1", [org, ctx.username]);
      if (deja) return { acteId: deja.id, cree: false };
      const type = await db.get("SELECT id FROM ref_items WHERE kind = 'type_acte' AND code = 'deliberation' AND (organisme_id IS NULL OR organisme_id = $1) ORDER BY organisme_id NULLS LAST LIMIT 1", [org]);
      if (!type) throw E.conflict("Le type « délibération » n’est pas disponible dans cette collectivité");
      const a = await actes.create(ctx, org, { typeId: type.id, titre: TITRE, commentaire: 'Dossier d’entraînement : vous pouvez tout essayer, il ne partira jamais dans un vrai circuit.', custom: { entrainement: true } });
      for (const t of await textes.list(ctx, org, a.id)) {
        if (!TEXTES[t.kind]) continue;
        const v = await textes.view(ctx, org, a.id, t.id, { mode: 'propre' });
        await textes.commit(ctx, org, a.id, t.id, { markdown: TEXTES[t.kind], baseVersion: v.version, reason: 'Texte d’exemple' });
      }
      await audit.log(ctx, { organismeId: org, action: 'entrainement.create', entity: 'actes', entityId: a.id });
      return { acteId: a.id, cree: true };
    },

    /** Purge : les dossiers d'entraînement de plus de 14 jours sont abandonnés (ils disparaissent des listes). */
    async purger(organismeId) {
      const r = await db.run(
        `UPDATE actes SET statut = 'abandonne', abandoned_at = now(), abandon_motif = 'Purge automatique du dossier d’entraînement'
         WHERE organisme_id = $1 AND custom ? 'entrainement' AND statut <> 'abandonne' AND created_at < now() - interval '14 days'`, [organismeId]);
      return r.changes;
    },
  };
}

module.exports = { createEntrainement, TITRE };
