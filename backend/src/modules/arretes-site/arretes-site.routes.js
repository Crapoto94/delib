const { z } = require('zod');

const Org = z.object({ orgId: z.coerce.number().int().positive() });
const Lancer = z.object({ url: z.url().max(500).optional().describe('Page du site listant les arrêtés (HTTPS) ; sinon le réglage `arretes.site_url`, par défaut la page « Arrêtés pris par le Maire » du site de la Ville') }).optional();
const T = ['arrêtés du site'];

module.exports = ({ makeRouter, arretesSite }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/arretes-site');
  r.get('/', { summary: 'Arrêtés du site de la Ville repris dans l’application : total, répartition par année, état de la dernière reprise', tags: T, org: true, roles: ['org_admin'], params: Org },
    async (req, res) => res.json(await arretesSite.etat(req.org.id)));
  r.post('/reprise', {
    summary: 'Lance la reprise des arrêtés du site (arrière-plan) : chaque PDF devient un arrêté signé marqué « site »', tags: T, org: true, roles: ['org_admin'], params: Org, body: Lancer, responses: { 202: 'Reprise lancée' },
    description: 'Rejouable : un arrêté déjà repris (même adresse de PDF) est ignoré. Les arrêtés « site » ne sont pas supprimés par un effacement général des données. La progression se lit avec GET /arretes-site.',
  }, async (req, res) => res.status(202).json(await arretesSite.lancer(req.ctx, req.org.id, req.valid.body || {})));
  return [r];
};
