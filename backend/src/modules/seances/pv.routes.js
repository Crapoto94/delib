const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const PS = z.object({ orgId: Id, id: Id });
const PI = PS.extend({ itemId: Id });
const PvQ = z.object({ notes: z.enum(['true', 'false']).default('true').transform((v) => v === 'true').describe('Inclure les observations du secrétariat (notes par point)') });
const T = ['suivi de séance'];

const send = (res, f) => { res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${f.name}"`); res.send(f.buffer); };

module.exports = ({ makeRouter, pv }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/seances/:id');

  r.get('/proces-verbal', { summary: 'Procès-verbal de la séance (PDF) : bureau, présences, mouvements, décompte et résultat de chaque point', tags: T, org: true, params: PS, query: PvQ, responses: { 200: 'PDF' },
    description: "Réservé au SCC, à la DGS et aux administrateurs. Filigrane « PROJET » tant que la séance n'est pas close ; un scrutin secret n'imprime aucun nom. 409 si le suivi de séance n'a pas été ouvert." },
  async (req, res) => send(res, await pv.proces(req.ctx, req.org.id, req.valid.params.id, req.valid.query)));

  r.get('/liste-deliberations', { summary: 'Liste des délibérations de la séance (PDF) : numéro, objet, rapporteur, résultat', tags: T, org: true, params: PS, responses: { 200: 'PDF' } },
    async (req, res) => send(res, await pv.liste(req.ctx, req.org.id, req.valid.params.id)));

  r.get('/points/:itemId/extrait', { summary: "Extrait du registre d'une délibération votée (PDF) : texte adopté, mention du vote, présents, absents et pouvoirs", tags: T, org: true, params: PI, responses: { 200: 'PDF' },
    description: "409 tant que la délibération n'a pas été votée." },
  async (req, res) => send(res, await pv.extrait(req.ctx, req.org.id, req.valid.params.id, req.valid.params.itemId)));

  return [r];
};
