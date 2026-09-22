const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const PA = P.extend({ id: Id });
const T = ['parapheur'];
const ROLES = ['org_admin', 'scc'];

const Config = z.object({
  fournisseur: z.enum(['dsihub', 'iparapheur']).describe('Parapheur DSIHUB (défaut) ; iParapheur prévu, non disponible'),
  actif: z.boolean(), mode: z.enum(['dev', 'prod']).describe('dev : tous les envois vers l’adresse d’essai ; prod : au signataire paramétré'),
  url: z.string().trim().max(300).refine((v) => v === '' || /^https?:\/\/.+/i.test(v), 'URL http(s) attendue').optional(),
  utilisateur: z.string().trim().max(120).optional(),
  motDePasse: z.string().max(300).optional().describe('Compte technique du Hub : vide = le mot de passe enregistré est conservé. Jamais renvoyé par l’API.'),
  email_test: z.string().trim().email('Adresse d’essai attendue').or(z.literal('')).optional(),
  signataire_nom: z.string().trim().max(160).optional(), signataire_email: z.string().trim().email('Adresse du signataire attendue').or(z.literal('')).optional(),
  signataire_qualite: z.string().trim().max(160).optional(),
  signature_mode: z.enum(['securise', 'simple', 'sms']).describe('securise (P12, par défaut) ; simple (signature manuscrite) ; sms (code par SMS)').optional(),
  signataire_telephone: z.string().trim().max(30).optional().describe('Portable du signataire : requis pour la signature par SMS'),
}).partial();
const Retour = z.object({ statut: z.enum(['signe', 'refuse']).default('signe'), motif: z.string().trim().max(500).optional() });
const Annuler = z.object({ motif: z.string().trim().max(500).optional() });
const Envoi = z.object({ forcer: z.boolean().optional().describe('Administrateur / SCC : envoyer en signature même si le circuit n’est pas terminé') });
const JournalQ = z.object({ acteId: Id.optional(), limit: z.coerce.number().int().min(1).max(500).default(100) });

module.exports = ({ makeRouter, parapheur }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/parapheur');

  r.get('/config', { summary: 'Paramétrage du parapheur (fournisseur, mode dev/prod, signataire) — secret jamais renvoyé', tags: T, org: true, roles: ROLES, params: P },
    async (req, res) => res.json(await parapheur.config(req.org.id)));
  r.put('/config', { summary: 'Modifie le paramétrage du parapheur', tags: T, org: true, roles: ['org_admin'], params: P, body: Config, responses: { 201: 'Enregistré' } },
    async (req, res) => res.json(await parapheur.setConfig(req.ctx, req.org.id, req.valid.body)));
  r.post('/test', { summary: 'Teste la connexion au parapheur (ne lève pas d’erreur : renvoie { ok, message })', tags: T, org: true, roles: ['org_admin'], params: P, body: Config },
    async (req, res) => res.json(await parapheur.tester(req.ctx, req.org.id, req.valid.body || {})));
  r.post('/test-envoi', { summary: 'Envoie un document de test au parapheur (pièce « sans valeur », même chemin qu’un vrai envoi)', tags: T, org: true, roles: ['org_admin'], params: P, body: Config,
    description: 'Génère un document d’essai au gabarit de la collectivité et le remet au parapheur comme une vraie demande de signature (mode dev/prod, signataire paramétré). Aucun acte, aucun circuit : le test n’engage rien. Le document part au parapheur configuré, ou reste en simulation si le Hub n’est pas renseigné.' },
    async (req, res) => res.json(await parapheur.envoyerEssai(req.ctx, req.org.id, req.valid.body || {})));

  r.get('/actes/:id', { summary: 'État de la signature d’un acte : envoi courant, signataire, journal des échanges (envoyé / retourné)', tags: T, org: true, params: PA,
    description: 'Le journal montre ce qui a été envoyé au parapheur et ce qu’il a renvoyé (demande, accusé, état, retour). Accessible à qui peut voir l’acte.' },
  async (req, res) => res.json(await parapheur.etat(req.ctx, req.org.id, req.valid.params.id)));
  r.get('/actes/:id/document-signe', { summary: 'Document signé (PDF) revenu du parapheur — ce qui fait foi après signature', tags: T, org: true, params: PA, responses: { 200: 'application/pdf' },
    description: 'Après la signature du maire, une décision ne se réécrit plus : ce PDF signé est la version de référence. Accessible à qui peut voir l’acte.' },
  async (req, res) => {
    const out = await parapheur.documentSigne(req.ctx, req.org.id, req.valid.params.id);
    res.set({ 'Content-Type': out.mime || 'application/pdf', 'Content-Disposition': `inline; filename="${encodeURIComponent(out.name)}"`, 'Cache-Control': 'private, no-store' }).send(out.buffer);
  });
  r.post('/actes/:id/envoi', { summary: 'Envoie (ou renvoie) un acte en signature au parapheur', tags: T, org: true, roles: ROLES, params: PA, body: Envoi,
    description: 'Un acte « à signer » (décision, arrêté) part en signature du maire. Les administrateurs et le SCC peuvent passer `forcer: true` pour envoyer en signature même si le circuit n’est pas terminé.' },
    async (req, res) => res.json(await parapheur.demanderEnvoi(req.ctx, req.org.id, req.valid.params.id, { forcer: !!req.valid.body?.forcer })));
  r.post('/actes/:id/synchroniser', { summary: 'Interroge le parapheur maintenant (aucun webhook : l’état est récupéré par polling)', tags: T, org: true, roles: ROLES, params: PA },
    async (req, res) => res.json(await parapheur.synchroniser(req.ctx, req.org.id, req.valid.params.id)));
  r.post('/actes/:id/retour', { summary: 'Mode dev : simule le retour du parapheur (signé ou refusé) pour dérouler le circuit', tags: T, org: true, roles: ROLES, params: PA, body: Retour },
    async (req, res) => res.json(await parapheur.simulerRetour(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  r.post('/actes/:id/annuler', { summary: 'Annule l’envoi en cours (le dossier redevient « à signer »)', tags: T, org: true, roles: ROLES, params: PA, body: Annuler },
    async (req, res) => res.json(await parapheur.annuler(req.ctx, req.org.id, req.valid.params.id, req.valid.body.motif)));
  r.post('/actes/:id/reouvrir', { summary: 'Rouvre une décision signée pour modification (perd son document signé, revient à l’étape précédente)', tags: T, org: true, roles: ROLES, params: PA, body: Annuler,
    description: 'Réservé aux administrateurs et au SCC. Le document signé est retiré ; l’acte revient à la dernière étape du circuit pour correction, puis repart en signature après validation.' },
  async (req, res) => res.json(await parapheur.reouvrir(req.ctx, req.org.id, req.valid.params.id, req.valid.body || {})));

  r.get('/journal', { summary: 'Journal des échanges avec le parapheur (ce qui est envoyé et retourné), filtrable par acte', tags: T, org: true, roles: ROLES, params: P, query: JournalQ },
    async (req, res) => res.json(await parapheur.journal(req.ctx, req.org.id, req.valid.query)));

  return [r];
};
