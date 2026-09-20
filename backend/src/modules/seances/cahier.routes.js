const { z } = require('zod');
const { PROFILS } = require('./cahier.service');

const Id = z.coerce.number().int().positive();
const PS = z.object({ orgId: Id, id: Id });
const PV = PS.extend({ n: Id });
const Build = z.object({
  profil: z.enum(PROFILS).default('scc').describe('scc (complet), presidence, elus (annexes communicables), public (annexes communicables)'),
  rectoVerso: z.boolean().default(false).describe('Chaque point commence sur une page impaire (page blanche insérée si besoin)'),
  anomalies: z.enum(['bloquer', 'avertir', 'exclure']).default('avertir').describe('Que faire des anomalies : refuser la génération, avertir, ou exclure les dossiers concernés'),
});
const T = ['cahier de séance'];

module.exports = ({ makeRouter, cahier }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/seances/:id/cahier');

  r.get('/controles', { summary: 'Anomalies à connaître avant de générer le cahier', tags: T, org: true, params: PS,
    description: 'Dossier non validé, texte vide, annexe introuvable, point libre sans titre (CAH-05).' },
  async (req, res) => res.json({ items: await cahier.controles(req.ctx, req.org.id, req.valid.params.id) }));

  r.post('/', { summary: 'Génère le cahier de séance (nouvelle version) — en arrière plan', tags: T, org: true, params: PS, body: Build, responses: { 202: 'Génération lancée' },
    description: "Un seul PDF : page de garde, sommaire paginé, puis pour chaque point intercalaire, exposé (une fois par dossier), délibération et annexes. Filigrane « PROJET » tant que l'ordre du jour n'est pas arrêté. Réservé au SCC, à la DGS et aux administrateurs. Suivre l'avancement avec GET /builds/:n." },
  async (req, res) => res.status(202).json(await cahier.request(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.get('/builds', { summary: 'Versions du cahier, avec les changements depuis la version imprimée', tags: T, org: true, params: PS },
    async (req, res) => res.json({ items: await cahier.list(req.ctx, req.org.id, req.valid.params.id) }));

  r.get('/builds/:n', { summary: "Avancement et détail d'une version du cahier", tags: T, org: true, params: PV },
    async (req, res) => res.json(await cahier.get(req.ctx, req.org.id, req.valid.params.id, req.valid.params.n)));

  r.get('/builds/:n/fichier', { summary: 'Télécharge le PDF du cahier (téléchargement tracé)', tags: T, org: true, params: PV, responses: { 200: 'PDF' } },
    async (req, res) => {
      const f = await cahier.file(req.ctx, req.org.id, req.valid.params.id, req.valid.params.n);
      res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${f.name}"`); res.send(f.buffer);
    });

  r.post('/builds/:n/imprime', { summary: 'Marque une version comme imprimée / diffusée', tags: T, org: true, params: PV,
    description: 'Les versions suivantes listent les points ajoutés, retirés ou modifiés depuis cette version (CAH-08).' },
  async (req, res) => res.json(await cahier.markPrinted(req.ctx, req.org.id, req.valid.params.id, req.valid.params.n)));

  return [r];
};
