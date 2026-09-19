const { createTestEnv, loginAs, bearer, USERS, AGENTS } = require('../helpers');

let env;
beforeAll(async () => {
  // l'AD authentifie « sansmail » mais ne renvoie ni adresse ni nom : la fiche doit être retrouvée dans l'annuaire RH
  env = await createTestEnv({
    users: { ...USERS, sansmail: { password: 'pw-sansmail' } },
    agents: [...AGENTS, { username: '336', displayName: 'MARC SANSMAIL', email: 'sansmail@ivry94.fr', service: 'BUDGET', direction: 'DIRECTION DES FINANCES', poste: 'Directeur', matricule: '9' }],
  });
});
afterAll(async () => { await env.close(); });

describe('connexion sans adresse e-mail dans l\'AD', () => {
  it('retrouve la fiche RH par <identifiant>@<domaine> : nom, direction, service, poste', async () => {
    const tok = await loginAs(env, 'sansmail', 'pw-sansmail');
    const me = (await env.http().get('/api/v1/me').set(bearer(tok))).body;
    expect(me.agent).toMatchObject({ direction: { code: 'A1' }, poste: 'Directeur' });
    expect(me.email).toBe('sansmail@ivry94.fr');
    expect(me.displayName).toBe('Marc Sansmail');
  });
});
