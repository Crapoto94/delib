/**
 * Parapheur DSIHUB — lisibilité des échecs.
 *
 * Un « Hub injoignable » et un « Hub qui répond 500 » demandaient la même chose : rien. L'adaptateur perdait le corps
 * de la réponse et annonçait ERR_BAD_RESPONSE, ce qui envoyait l'administration chercher un problème réseau alors que
 * le serveur avait répondu. Ce test fixe le contrat : le code HTTP et le message du Hub sont repris dans l'erreur.
 */
import { describe, it, expect } from 'vitest';
import { createDsihubParapheur } from '../../src/adapters/parapheur-dsihub.js';

const cfg = { url: 'https://dsihub.ivry.local', utilisateur: 'admin', secret: 'motdepasse' };

/** Client HTTP factice : `post` répond selon le scénario, `get` réussit (le test de connexion passe). */
const clientFactice = ({ post }) => ({
  post: async (url, ...reste) => (url === '/api/login' ? { status: 200, data: { token: 'jeton' } } : post(url, ...reste)),
  get: async () => ({ status: 200, data: { id: 1, status: 'en_cours' } }),
});

describe('parapheur DSIHUB — échecs lisibles', () => {
  it('reprend le code HTTP et le message du Hub quand il refuse l’envoi', async () => {
    const ad = createDsihubParapheur({
      http: clientFactice({
        post: async () => {
          const e = new Error('Request failed with status code 500');
          e.code = 'ERR_BAD_RESPONSE';
          e.response = { status: 500, data: { error: 'relation "agents" does not exist' } };
          throw e;
        },
      }),
    });
    await expect(ad.creer(cfg, { titre: 'T', signataires: [{ email: 'a@b.fr', nom: 'A', positions: [{ documentIndex: 0 }] }], documents: [{ nom: 'x.pdf', buffer: Buffer.from('x') }] }))
      .rejects.toThrow(/HTTP 500 : relation "agents" does not exist/);
  });

  it('lit aussi une liste d’erreurs de validation, en clair', async () => {
    const ad = createDsihubParapheur({
      http: clientFactice({
        post: async () => {
          const e = new Error('bad request');
          e.code = 'ERR_BAD_REQUEST';
          e.response = { status: 400, data: { errors: ['signataires requis', { message: 'positions requises' }] } };
          throw e;
        },
      }),
    });
    await expect(ad.creer(cfg, { titre: 'T', signataires: [{ email: 'a@b.fr', nom: 'A', positions: [{ documentIndex: 0 }] }], documents: [{ nom: 'x.pdf', buffer: Buffer.from('x') }] }))
      .rejects.toThrow(/HTTP 400 : signataires requis ; positions requises/);
  });

  it('ne parle d’injoignable que si le Hub est vraiment injoignable', async () => {
    const ad = createDsihubParapheur({
      http: clientFactice({
        post: async () => { const e = new Error('connect ECONNREFUSED'); e.code = 'ECONNREFUSED'; throw e; },
      }),
    });
    await expect(ad.creer(cfg, { titre: 'T', signataires: [{ email: 'a@b.fr', nom: 'A', positions: [{ documentIndex: 0 }] }], documents: [{ nom: 'x.pdf', buffer: Buffer.from('x') }] }))
      .rejects.toThrow(/injoignable : ECONNREFUSED/);
  });
});
