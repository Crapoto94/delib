const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const PS = P.extend({ id: Id });
const T = ['séances'];
const ADMIN = ['org_admin', 'scc'];
const Cible = z.enum(['retard', 'tous']).default('retard').describe('retard : les dossiers dont une échéance est dépassée ; tous : tous les dossiers non terminés');
const Relance = z.object({ cible: Cible, directions: z.array(z.string().max(40)).max(100).optional().describe('Codes des directions à relancer (par défaut : toutes)'), message: z.string().trim().max(1000).optional(), forcer: z.boolean().default(false).describe('Relancer aussi les dossiers relancés récemment') });
const Synthese = z.object({ ids: z.string().regex(/^\d+(,\d+)*$/).describe('Identifiants de séances séparés par des virgules (40 au plus)') });
const Fichier = z.object({ fichier: z.string().regex(/^[A-Za-z0-9_-]{20,64}(\.ics)?$/) });

module.exports = ({ makeRouter, synthese, relance, calendrier, limiter }) => {
  const r = makeRouter('/api/v1/organismes/:orgId');

  r.get('/seances-synthese', { summary: 'Indicateurs des cartes de la liste des séances (compte à rebours, dossiers instruits, directions en retard, étape du workflow) et bandeau', tags: T, org: true, roles: ADMIN, params: P, query: Synthese },
    async (req, res) => res.json(await synthese.resume(req.ctx, req.org.id, req.valid.query.ids.split(',').map(Number))));

  r.get('/seances/:id/relance', { summary: 'Relancer les services — aperçu : par direction, les dossiers non terminés, leurs détenteurs et la dernière relance', tags: T, org: true, roles: ADMIN, params: PS, query: z.object({ cible: Cible }) },
    async (req, res) => res.json(await relance.apercu(req.ctx, req.org.id, req.valid.params.id, req.valid.query)));
  r.post('/seances/:id/relance', { summary: 'Relance les détenteurs des dossiers non terminés de la séance (notification + e-mail), direction par direction', tags: T, org: true, roles: ADMIN, params: PS, body: Relance,
    description: "Réutilise la relance manuelle d'un dossier. Un dossier relancé depuis moins de `seances.relance_delai_h` heures (24 par défaut) est ignoré sauf `forcer`. Renvoie, dossier par dossier, qui a été prévenu ou pourquoi non." },
  async (req, res) => res.json(await relance.relancer(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  // lien de calendrier dynamique (Outlook) : chacun gère le sien
  r.get('/calendrier/lien', { summary: 'Mon lien de calendrier (abonnement dynamique pour Outlook, pas un export)', tags: T, org: true, params: P },
    async (req, res) => res.json(await calendrier.lien(req.ctx, req.org.id)));
  r.post('/calendrier/lien', { summary: 'Crée mon lien de calendrier, ou en génère un nouveau (l\'ancien cesse de fonctionner)', tags: T, org: true, params: P, responses: { 200: 'Lien' } },
    async (req, res) => res.json(await calendrier.regenerer(req.ctx, req.org.id)));
  r.delete('/calendrier/lien', { summary: 'Révoque mon lien de calendrier', tags: T, org: true, params: P },
    async (req, res) => res.json(await calendrier.revoquer(req.ctx, req.org.id)));

  // flux public : la clé du lien EST l'authentification (192 bits) ; aucune donnée de dossier
  const pub = makeRouter('/api/v1/calendrier');
  pub.get('/:fichier', { summary: 'Flux iCalendar du lien secret (séances et jalons) : abonnement Outlook, Google, Apple…', tags: T, auth: false, limiter, params: Fichier, responses: { 200: 'iCalendar' } },
    async (req, res) => {
      const f = await calendrier.flux(req.valid.params.fichier);
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8'); res.setHeader('Cache-Control', 'private, max-age=300'); res.setHeader('ETag', f.etag);
      if (req.headers['if-none-match'] === f.etag) return res.status(304).end();
      return res.send(f.corps);
    });
  return [r, pub];
};
