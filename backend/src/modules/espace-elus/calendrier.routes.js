const { z } = require('zod');

const T = ['espace élus'];
const Fichier = z.object({ fichier: z.string().regex(/^[A-Za-z0-9_-]{20,64}(\.ics)?$/) });

module.exports = ({ makeRouter, limiter, eluCalendrier }) => {
  // lien de calendrier dynamique (Outlook) : chaque élu gère le sien
  const r = makeRouter('/api/v1/elus');
  r.get('/calendrier/lien', { summary: 'Mon lien de calendrier (abonnement dynamique pour Outlook, pas un export)', tags: T, elu: true },
    async (req, res) => res.json(await eluCalendrier.lien(req.elu)));
  r.post('/calendrier/lien', { summary: 'Crée mon lien de calendrier, ou en génère un nouveau (l\'ancien cesse de fonctionner)', tags: T, elu: true, responses: { 200: 'Lien' } },
    async (req, res) => res.json(await eluCalendrier.regenerer(req.elu)));
  r.delete('/calendrier/lien', { summary: 'Révoque mon lien de calendrier', tags: T, elu: true },
    async (req, res) => res.json(await eluCalendrier.revoquer(req.elu)));

  // flux public : la clé du lien EST l'authentification (192 bits) ; uniquement les séances visibles de cet élu
  const pub = makeRouter('/api/v1/calendrier-elus');
  pub.get('/:fichier', { summary: 'Flux iCalendar du lien secret d\'un élu (ses séances) : abonnement Outlook, Google, Apple…', tags: T, auth: false, limiter, params: Fichier, responses: { 200: 'iCalendar' } },
    async (req, res) => {
      const f = await eluCalendrier.flux(req.valid.params.fichier);
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8'); res.setHeader('Cache-Control', 'private, max-age=300'); res.setHeader('ETag', f.etag);
      if (req.headers['if-none-match'] === f.etag) return res.status(304).end();
      return res.send(f.corps);
    });
  return [r, pub];
};
