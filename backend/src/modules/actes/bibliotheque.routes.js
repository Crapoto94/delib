const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const PA = P.extend({ id: Id });
const T = ['bibliothèque et trajet'];
const Chercher = z.object({ q: z.string().trim().max(300).optional().describe('Mots, « expression exacte », OR, -exclusion, n° de suivi ou de délibération'), annee: z.coerce.number().int().min(1900).max(2200).optional(), matiereId: Id.optional(),
  natureId: Id.optional(), rubriqueId: Id.optional(), instanceId: Id.optional(), rapporteurId: Id.optional(),
  directionCode: z.string().trim().max(40).optional(), du: z.iso.date().optional(), au: z.iso.date().optional(),
  etat: z.enum(['tous', 'archive', 'en_cours']).default('tous').describe('État : délibérations archivées, en cours, ou les deux'),
  limit: z.coerce.number().int().min(1).max(100).default(20), offset: z.coerce.number().int().min(0).default(0) });
const Pdf = z.object({ cible: z.enum(['expose', 'deliberation', 'extrait']).default('extrait') });
const Mes = z.object({ q: z.string().trim().max(200).optional(), annee: z.coerce.number().int().min(1900).max(2200).optional(), statut: z.string().trim().max(40).optional(), hors: z.string().trim().max(40).optional(),
  role: z.enum(['redacteur', 'co_redacteur', 'valideur', 'remplacant', 'commentateur', 'participant']).optional(), limit: z.coerce.number().int().min(1).max(100).default(30), offset: z.coerce.number().int().min(0).default(0) });

module.exports = ({ makeRouter, bibliotheque }) => {
  const r = makeRouter('/api/v1/organismes/:orgId');

  r.get('/bibliotheque', { summary: "Bibliothèque des actes de la collectivité : recherche des délibérations adoptées (séance close), ouverte à tous les agents", tags: T, org: true, params: P, query: Chercher,
    description: "Consultation seule. Jamais les actes confidentiels ou à huis clos, ni les annexes non publiables. Distincte de « Mes actes » (REC-30)." },
  async (req, res) => res.json(await bibliotheque.chercher(req.ctx, req.org.id, req.valid.query)));
  r.get('/bibliotheque/actes/:id', { summary: "Fiche de consultation d'une délibération adoptée : exposé des motifs, visas, dispositif, annexes publiables", tags: T, org: true, params: PA },
    async (req, res) => res.json(await bibliotheque.consulter(req.ctx, req.org.id, req.valid.params.id)));
  r.get('/bibliotheque/actes/:id/pdf', { summary: "PDF d'une délibération de la bibliothèque : exposé des motifs, délibération ou extrait du registre", tags: T, org: true, params: PA, query: Pdf, responses: { 200: 'PDF' } },
    async (req, res) => { const f = await bibliotheque.pdf(req.ctx, req.org.id, req.valid.params.id, req.valid.query.cible); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${f.name}"`); res.send(f.buffer); });
  r.delete('/bibliotheque/actes/:id', { summary: 'Retire une délibération de la bibliothèque (administrateur ou SCC) : elle n\'y est plus consultable, l\'acte reste conservé', tags: T, org: true, roles: ['org_admin', 'scc'], params: PA },
    async (req, res) => res.json(await bibliotheque.retirer(req.ctx, req.org.id, req.valid.params.id)));
  r.post('/bibliotheque/actes/:id/reintegrer', { summary: 'Réintègre une délibération retirée de la bibliothèque', tags: T, org: true, roles: ['org_admin', 'scc'], params: PA },
    async (req, res) => res.json(await bibliotheque.reintegrer(req.ctx, req.org.id, req.valid.params.id)));

  r.get('/mes-actes', { summary: "Le trajet de mes actes : les dossiers pour lesquels j'ai eu un rôle à un moment (rédacteur, valideur, remplaçant, commentateur…), tous statuts", tags: T, org: true, params: P, query: Mes },
    async (req, res) => res.json(await bibliotheque.mesActes(req.ctx, req.org.id, req.valid.query)));
  r.get('/mes-actes/:id', { summary: "Fiche de trajet d'un de mes actes : circuit complet, modifications suivies, commentaires, amendements, vote, transmission, chronologie", tags: T, org: true, params: PA,
    description: "404 si je n'ai jamais eu de rôle sur cet acte : avoir un rôle sur un acte n'ouvre pas les autres, et la bibliothèque n'ouvre pas les trajets." },
  async (req, res) => res.json(await bibliotheque.trajet(req.ctx, req.org.id, req.valid.params.id)));
  return [r];
};
