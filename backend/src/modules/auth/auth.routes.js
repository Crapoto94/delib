const { z } = require('zod');

const Credentials = z.object({
  username: z.string().trim().min(1).max(128).describe('Identifiant AD (insensible à la casse)'),
  password: z.string().min(1).max(256),
});

/** Routes d'authentification. Le mot de passe n'est jamais journalisé ni stocké. */
module.exports = ({ makeRouter, auth, limiter }) => {
  const r = makeRouter('/api/v1/auth');

  r.post('/login', {
    summary: "Connexion d'un agent (AD via l'APM)", tags: ['auth'], auth: false, limiter, body: Credentials,
    description: "Identifiant insensible à la casse. Renvoie un JWT (Bearer) et ouvre une session révocable. 401 sans détail sur la cause ; 429 après trop d'échecs ; 502 si l'AD est indisponible.",
  }, async (req, res) => res.json(await auth.loginAd({ ...req.valid.body, ip: req.ip })));

  r.post('/login-local', {
    summary: 'Connexion du compte de secours local', tags: ['auth'], auth: false, limiter, body: Credentials,
    description: "Compte de secours (LOCAL_ADMIN_*), utilisable quand l'AD ou l'APM est indisponible. Chaque usage est audité.",
  }, async (req, res) => res.json(await auth.loginLocal({ ...req.valid.body, ip: req.ip })));

  r.post('/refresh', {
    summary: 'Renouvelle la session courante', tags: ['auth'],
    description: 'Émet un nouveau jeton et révoque le précédent, dans la limite de SESSION_MAX_HOURS depuis la connexion initiale.',
  }, async (req, res) => res.json(await auth.refresh(req.ctx, req.ip)));

  r.post('/logout', { summary: 'Ferme la session courante (révocation du jeton)', tags: ['auth'], responses: { 204: 'Session fermée' } },
    async (req, res) => { await auth.logout(req.ctx, req.ip); res.status(204).end(); });

  return [r];
};
