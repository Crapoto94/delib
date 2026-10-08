const { z } = require('zod');
const { E } = require('../../shared/errors');

const T = ['publication'];
const Page = { page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(50).default(10) };
const Liste = z.object({ mois: z.coerce.number().int().min(1).max(1200).optional().describe('Derniers mois affichés (au plus la période réglée)'), ...Page });
const Rech = z.object({
  q: z.string().trim().min(2).max(200).optional().describe('Texte recherché dans l’objet ou le numéro de l’arrêté (sans accents, insensible à la casse)'),
  annee: z.coerce.number().int().min(1900).max(2200).optional(),
  dateDebut: z.iso.date().optional().describe('Arrêtés signés à partir du jour indiqué (AAAA-MM-JJ)'), dateFin: z.iso.date().optional().describe('Arrêtés signés jusqu’au jour indiqué inclus (AAAA-MM-JJ)'), ...Page,
});
const Jeton = z.object({ jeton: z.string().min(20).max(300).regex(/^[A-Za-z0-9_-]+$/) });

module.exports = ({ makeRouter, arretesPublics, db, settings }) => {
  const r = makeRouter('/api/v1/public/arretes');

  const reglages = async () => {
    const o = await db.get('SELECT id, nom FROM organismes WHERE is_default AND actif');
    const cfg = o ? await settings.resolve(o.id) : {};
    return { org: o, liste: !!o && cfg['publication.arretes_actif']?.value === true, recherche: !!o && cfg['publication.arretes_recherche_actif']?.value === true,
      mois: Math.min(1200, Math.max(1, Number(cfg['publication.arretes_mois']?.value) || 6)) };
  };
  const cache = (res, s) => res.setHeader('Cache-Control', `public, max-age=${s}`);

  r.get('/', {
    summary: 'Arrêtés signés des derniers mois (publics), paginés, avec liens chiffrés vers le PDF et les annexes', tags: T, auth: false, query: Liste,
    description: '404 tant que la publication n’est pas activée par l’administrateur. Arrêtés signés et non confidentiels seulement ; les liens sont des jetons chiffrés.',
  }, async (req, res) => {
    const c = await reglages(); if (!c.liste) throw E.notFound('Publication non activée');
    const q = req.valid.query; cache(res, 300);
    res.json({ organisme: c.org.nom, ...(await arretesPublics.lister(c.org.id, Math.min(c.mois, q.mois ?? c.mois), { limit: q.limit, offset: (q.page - 1) * q.limit })) });
  });

  r.get('/recherche/filtres', { summary: 'Listes de choix du moteur de recherche des arrêtés : années', tags: T, auth: false, description: '404 tant que la recherche n’est pas activée.' },
    async (req, res) => { const c = await reglages(); if (!c.recherche) throw E.notFound('Recherche non activée'); cache(res, 300); res.json(await arretesPublics.filtres(c.org.id)); });

  r.get('/recherche', {
    summary: 'Moteur de recherche des arrêtés signés, sans limite de durée : texte de l’objet ou numéro, année, dates', tags: T, auth: false, query: Rech,
    description: 'Arrêtés signés et non confidentiels. Résultats paginés, du plus récent au plus ancien, avec liens chiffrés vers le PDF et les annexes publiables.',
  }, async (req, res) => {
    const c = await reglages(); if (!c.recherche) throw E.notFound('Recherche non activée');
    const { page, limit, ...f } = req.valid.query; cache(res, 60);
    res.json({ organisme: c.org.nom, ...(await arretesPublics.lister(c.org.id, null, { ...f, limit, offset: (page - 1) * limit })) });
  });

  r.get('/f/:jeton', { summary: 'Document (arrêté ou annexe) désigné par un lien chiffré de la liste', tags: T, auth: false, params: Jeton, responses: { 200: 'PDF' } }, async (req, res) => {
    const c = await reglages(); if (!c.liste && !c.recherche) throw E.notFound('Publication non activée');
    const f = await arretesPublics.document(c.org.id, c.recherche ? null : c.mois, req.valid.params.jeton);
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${String(f.name).replace(/[^\w.-]+/g, '_')}"`); cache(res, 300); res.send(f.buffer);
  });
  return [r];
};
