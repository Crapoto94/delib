const { z } = require('zod');

const PS = z.object({ orgId: z.coerce.number().int().positive(), id: z.coerce.number().int().positive() });

module.exports = ({ makeRouter, parcours }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/seances/:id');
  r.get('/parcours', {
    summary: 'Workflow de la séance : Rédaction, Préparation, Convocation, Séance, Après la séance, Clôture (état déduit des faits)',
    tags: ['séances'], org: true, roles: ['org_admin', 'scc'], params: PS,
    description: "Pour chaque étape : `etat` (`fait`, `en_cours`, `a_venir`), `date` quand elle est connue et, pour l'étape en cours, `retient` (ce qui la bloque : dossiers pas validés, ordre du jour non arrêté, transmissions sans AR…). Rien n'est saisi à la main : tout se déduit des dossiers, de l'ordre du jour, du cahier, de la convocation, du suivi de séance, du contrôle de légalité et de la GED.",
  }, async (req, res) => res.json(await parcours.get(req.ctx, req.org.id, req.valid.params.id)));
  return [r];
};
