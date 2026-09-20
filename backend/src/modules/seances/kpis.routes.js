const { z } = require('zod');

const PS = z.object({ orgId: z.coerce.number().int().positive(), id: z.coerce.number().int().positive() });

module.exports = ({ makeRouter, kpis }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/seances/:id');
  r.get('/kpis', {
    summary: 'Indicateurs de la séance : avancement, compte à rebours, taux de réalisation, directions en retard, actes à terminer, commissions',
    tags: ['séances'], org: true, roles: ['org_admin', 'scc'], params: PS,
    description: "Population : dossiers qui visent la séance ou sont à son ordre du jour. `aTerminer.items` détaille les actes non terminés (numéro d'ordre du jour, étape, valideurs, échéance) ; `directions.items` donne le détail par direction ; `commissions` donne, par commission, les actes terminés (avis rendu) / prévus et le compte à rebours de sa prochaine réunion.",
  }, async (req, res) => res.json(await kpis.get(req.ctx, req.org.id, req.valid.params.id)));
  return [r];
};
