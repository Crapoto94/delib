const { createTestEnv, loginAs, bearer } = require('../helpers');

let env; let tok;
afterAll(async () => { await env.close(); });

describe('« Prénom NOM » à la place des identifiants', () => {
  it('donne le nom des agents connus, en une seule requête, et ignore les inconnus', async () => {
    env = await createTestEnv();
    tok = await loginAs(env, 'dupont', 'pw-dupont');
    await loginAs(env, 'durand', 'pw-durand');
    const r = await env.http().get('/api/v1/directory/agents/noms?u=dupont,DURAND,@durand,personne.inconnu').set(bearer(tok));
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.noms).sort()).toEqual(['dupont', 'durand']);
    for (const n of Object.values(r.body.noms)) { expect(n).toMatch(/\S+ \S+/); expect(n.toLowerCase()).not.toBe('dupont'); }
  });

  it('exige une connexion', async () => {
    expect((await env.http().get('/api/v1/directory/agents/noms?u=dupont')).status).toBe(401);
  });

  it('met en forme « Prénom NOM » quand la fiche RH distingue prénom et nom', async () => {
    await env.db.run("UPDATE agent_ref SET nom = 'CHEVALIER', prenom = 'MARC-ANTOINE' WHERE username = 'dupont'");
    const r = await env.http().get('/api/v1/directory/agents/noms?u=dupont').set(bearer(tok));
    expect(r.body.noms.dupont).toBe('Marc-Antoine CHEVALIER');
  });
});
