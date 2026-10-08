const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let dupont; let ville; let cgct; let art; let rare;
const V = (p = '') => `/api/v1/organismes/${ville.id}/visas${p}`;
const as = (tok) => ({ get: (u) => env.http().get(u).set(bearer(tok)), post: (u, b) => env.http().post(u).set(bearer(tok)).send(b || {}), put: (u, b) => env.http().put(u).set(bearer(tok)).send(b), del: (u) => env.http().delete(u).set(bearer(tok)) });

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  dupont = await loginAs(env, 'dupont', 'pw-dupont');
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  const cree = async (cle, intitule) => (await as(admin).post(V(), { cle, intitule })).body;
  cgct = await cree('cgct', 'code général des collectivités territoriales');
  art = await cree('cgct:L2121-29', 'article L. 2121-29 du code général des collectivités territoriales');
  rare = await cree('cgct:L2252-1', 'article L. 2252-1 du code général des collectivités territoriales');
  // usage constaté (écrit par l'outil d'historique) : 100 délibérations dans le corpus
  const us = (n) => JSON.stringify({ total: 100, citations: n, rubriques: [{ libelle: 'FINANCES', n: Math.round(n / 2) }], formulation: 'vu le code général des collectivités territoriales,' });
  for (const [id, n] of [[cgct.id, 90], [art.id, 60], [rare.id, 30]]) await env.db.run('UPDATE visa_library SET citations = $2, cite_de = 2019, cite_a = 2023, usage_stats = $3::jsonb WHERE id = $1', [id, n, us(n)]);
  await env.c.settings.put({ username: 'test' }, { scope: 'organisme', organismeId: ville.id, key: 'visas.historique', val: { total: 100, de: 2019, a: 2023 } });
});
afterAll(async () => { await env.close(); });

describe('fiche d\'un texte : description et emploi', () => {
  it('le service juridique les saisit à la main ; un agent ordinaire ne le peut pas', async () => {
    expect((await as(dupont).put(V(`/${cgct.id}/fiche`), { description: 'x' })).status).toBe(403);
    const r = await as(admin).put(V(`/${cgct.id}/fiche`), { description: 'Code qui regroupe les règles applicables aux collectivités territoriales.', emploi: 'Visé dans toute délibération du conseil municipal.' });
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ descriptionPar: 'manuel', emploi: expect.stringMatching(/conseil municipal/), citations: 90 });
    expect(r.body.usage).toMatchObject({ total: 100, rubriques: [{ libelle: 'FINANCES', n: 45 }] });        // l'usage constaté est exposé tel quel
  });

  it('l\'IA rédige la description d\'après l\'usage constaté ; elle est marquée « IA » et ne remplace pas un emploi déjà saisi', async () => {
    let vu;
    env.ai.state.handler = (req) => { vu = req; return 'Voici : {"description":"Article qui fixe la compétence générale du conseil municipal.","emploi":"À viser dans les délibérations de gestion des affaires de la commune."}'; };
    const r = await as(admin).post(V(`/${art.id}/description-ia`));
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ propose: true, descriptionPar: 'ia', description: expect.stringMatching(/compétence/), emploi: expect.stringMatching(/gestion des affaires/) });
    expect(vu.system).toMatch(/JAMAIS|n'affirme jamais|Reste GÉNÉRAL/i); expect(vu.prompt).toMatch(/90|60|FINANCES|formulationHabituelle/);   // l'IA reçoit l'usage constaté
    expect(vu.prompt).not.toMatch(/en vigueur/i);
    const deja = await as(admin).post(V(`/${cgct.id}/description-ia`));                                      // emploi déjà saisi : conservé
    expect(deja.body.emploi).toBe('Visé dans toute délibération du conseil municipal.');
  });

  it('une IA qui ne connaît pas le texte ne propose rien ; une réponse illisible ou une IA en panne ne cassent rien', async () => {
    env.ai.state.handler = () => '{"description":null,"emploi":null}';
    const rien = await as(admin).post(V(`/${rare.id}/description-ia`));
    expect(rien.status).toBe(200); expect(rien.body).toMatchObject({ propose: false, description: null });
    env.ai.state.handler = () => 'pas du JSON';
    expect((await as(admin).post(V(`/${rare.id}/description-ia`))).status).toBe(422);
    env.ai.state.failing = true;
    expect((await as(admin).post(V(`/${rare.id}/description-ia`))).status).toBe(502);
    env.ai.state.failing = false;
  });

  it('l\'usage « description par l\'IA » se désactive : l\'IA n\'est alors jamais appelée', async () => {
    await env.c.settings.put({ username: 'test' }, { scope: 'organisme', organismeId: ville.id, key: 'ai.actif.visas_description', val: false });
    env.ai.state.handler = () => { throw new Error('le modèle ne doit pas être appelé'); };
    expect((await as(admin).post(V(`/${rare.id}/description-ia`))).status).toBe(403);
    await env.c.settings.put({ username: 'test' }, { scope: 'organisme', organismeId: ville.id, key: 'ai.actif.visas_description', val: true });
  });
});

describe('« bonbon » : vérification de cohérence par l\'IA', () => {
  it('enregistre le verdict, sans jamais marquer le texte « vérifié » ni toucher à son statut', async () => {
    env.ai.state.handler = () => '{"etat":"coherent","observations":[]}';
    const ok = await as(admin).post(V(`/${art.id}/verification-ia`));
    expect(ok.status).toBe(200); expect(ok.body.ia).toMatchObject({ etat: 'coherent', avis: null, modele: 'fake-ia' }); expect(ok.body.ia.le).toBeTruthy();
    expect(ok.body).toMatchObject({ verifieLe: null, statut: 'en_vigueur' });
    env.ai.state.handler = () => '{"etat":"a_revoir","observations":["L\'article L. 2252-1 n\'appartient pas à ce code."]}';
    const ko = await as(admin).post(V(`/${rare.id}/verification-ia`));
    expect(ko.body.ia).toMatchObject({ etat: 'a_revoir', avis: expect.stringMatching(/n'appartient pas/) });
    env.ai.state.handler = () => '{"etat":"coherent","observations":["Une réserve quand même."]}';          // « cohérent » avec une observation = à revoir
    expect((await as(admin).post(V(`/${art.id}/verification-ia`))).body.ia.etat).toBe('a_revoir');
  });
  it('la consigne interdit de se prononcer sur l\'état en vigueur ; droits et pannes', async () => {
    let vu; env.ai.state.handler = (req) => { vu = req; return '{"etat":"coherent","observations":[]}'; };
    await as(admin).post(V(`/${cgct.id}/verification-ia`));
    expect(vu.system).toMatch(/JAMAIS sur l'état en vigueur/);
    expect((await as(dupont).post(V(`/${cgct.id}/verification-ia`))).status).toBe(403);
    env.ai.state.handler = () => '{"etat":"peut-etre"}';
    expect((await as(admin).post(V(`/${cgct.id}/verification-ia`))).status).toBe(422);
  });
});

describe('règles de contrôle issues de l\'usage constaté', () => {
  it('propose les visas cités dans au moins la moitié des délibérations, « à revoir » dès 80 %', async () => {
    expect((await as(dupont).get(V('/controles/historique'))).status).toBe(403);
    const p = (await as(admin).get(V('/controles/historique'))).body;
    expect(p.total).toBe(100);
    expect(p.items.map((i) => [i.cle, i.pourcentage, i.gravite])).toEqual([['cgct', 90, 'a_revoir'], ['cgct:L2121-29', 60, 'info']]);   // 30 % : pas une règle
    expect(p.items[0].message).toMatch(/90 % des délibérations \(90 sur 100, 2019-2023\)/);
  });
  it('les crée pour les délibérations, sans doublon, et le contrôle d\'un dossier s\'en sert', async () => {
    const r = await as(admin).post(V('/controles/historique'));
    expect(r.status).toBe(201); expect(r.body).toMatchObject({ crees: 2, dejaPresentes: 0 });
    const regles = (await as(admin).get(V('/controles'))).body.items;
    expect(regles).toHaveLength(2); expect(regles.every((x) => x.regle === 'visa' && x.typeActeId && x.actif)).toBe(true);
    expect(regles.find((x) => x.cle === 'cgct').gravite).toBe('a_revoir');
    const encore = await as(admin).post(V('/controles/historique'));
    expect(encore.body).toMatchObject({ crees: 0, dejaPresentes: 2 });
  });
});
