const { z } = require('zod');

const T = ['sauvegarde'];
const Config = z.object({
  actif: z.boolean(), cible: z.string().trim().max(400).describe('Chemin réseau UNC (\\\\serveur\\partage\\dossier), lecteur monté ou dossier local'),
  utilisateur: z.string().trim().max(200).describe('DOMAINE\\compte ; vide si le compte du service a déjà accès au partage'), motDePasse: z.string().max(300).describe('Vide : le mot de passe enregistré est conservé. Jamais renvoyé par l\'API.'),
  heure: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/).describe('Heure de la sauvegarde nocturne (HH:MM)'), retentionJours: z.number().int().min(1).max(3650), inclureFichiers: z.boolean(),
}).partial();

module.exports = ({ makeRouter, sauvegarde }) => {
  const r = makeRouter('/api/v1/plateforme/sauvegarde');

  r.get('/', { summary: 'Sauvegarde vers un dossier réseau : configuration (sans mot de passe), état et journal des dernières sauvegardes', tags: T, platform: true },
    async (req, res) => res.json({ config: await sauvegarde.config(), enCours: sauvegarde.enCours(), journal: await sauvegarde.journal(20) }));
  r.put('/config', { summary: 'Configure la sauvegarde : destination, identifiants (mot de passe chiffré), heure, rétention, fichiers', tags: T, platform: true, body: Config,
    description: 'Le mot de passe est chiffré au repos et transmis au processus de copie par variable d\'environnement, jamais sur une ligne de commande.' },
  async (req, res) => res.json(await sauvegarde.setConfig(req.ctx, req.valid.body)));
  r.post('/test', { summary: 'Teste la destination : connexion, écriture puis effacement d\'un fichier', tags: T, platform: true,
    description: 'Ne lève pas d\'erreur : renvoie { ok, message }.' }, async (req, res) => res.json(await sauvegarde.tester(req.ctx)));
  r.post('/lancer', { summary: 'Lance une sauvegarde maintenant (en arrière-plan)', tags: T, platform: true, responses: { 202: 'Lancée' } },
    async (req, res) => res.status(202).json(await sauvegarde.lancer(req.ctx, 'manuel')));
  return [r];
};
