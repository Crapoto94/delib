const { createTestEnv, loginAs, bearer, adminToken, makePdf } = require('../helpers');

let env; let admin; let ville; let t; // t = jetons par utilisateur
let matiereFeuille; let matiereNoeud; let rubrique; let typeDelib;

const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const newActe = (tok, body = {}) => as(tok).post(`${base()}/actes`, { typeId: typeDelib.id, titre: 'Subvention à l\'association Les Amis du Sport', ...body });

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = {};
  for (const [u, p] of [['dupont', 'pw-dupont'], ['durand', 'pw-durand'], ['leroy', 'pw-leroy'], ['petit', 'pw-petit'], ['martin', 'pw-martin'], ['nouveau', 'pw-nouveau']]) t[u] = await loginAs(env, u, p);
  const items = (k) => as(admin).get(`${base()}/referentiels/${k}`).then((r) => r.body.items);
  matiereFeuille = (await items('matiere')).find((x) => x.code === '7.5');
  matiereNoeud = (await items('matiere')).find((x) => x.code === '7');
  rubrique = (await items('rubrique')).find((x) => x.libelle === 'FINANCES');
  const types = await items('type_acte');
  typeDelib = types.find((x) => x.code === 'deliberation');
  // titulaires : leroy = directeur de la direction A1 ; durand = chef du service A1a
  await as(admin).post(`${base()}/titulaires`, { fonction: 'directeur', username: 'leroy', directionCode: 'A1' });
  await as(admin).post(`${base()}/titulaires`, { fonction: 'chef_service', username: 'durand', directionCode: 'A1', serviceCode: 'A1a' });
});
afterAll(async () => { await env.close(); });

describe('titulaires (D3, D31)', () => {
  it('résout du plus précis au plus général, sans faire remonter les fonctions de service', async () => {
    await as(admin).post(`${base()}/titulaires`, { fonction: 'dgs', username: 'boot' });
    await as(admin).post(`${base()}/titulaires`, { fonction: 'dga', username: 'nouveau', directionCode: 'A1' });
    const ti = env.c.titulaires;
    expect((await ti.resolve(ville.id, 'chef_service', { directionCode: 'A1', serviceCode: 'A1a' })).map((x) => x.username)).toEqual(['durand']);
    expect(await ti.resolve(ville.id, 'chef_service', { directionCode: 'A1', serviceCode: 'A1b' })).toEqual([]);
    expect((await ti.resolve(ville.id, 'directeur', { directionCode: 'A1', serviceCode: 'A1b' })).map((x) => x.username)).toEqual(['leroy']);
    expect((await ti.resolve(ville.id, 'dgs', { directionCode: 'A1', serviceCode: 'A1a' })).map((x) => x.username)).toEqual(['boot']);
    expect(await ti.resolve(ville.id, 'directeur', { directionCode: 'J' })).toEqual([]);
  });

  it('le directeur gère sa direction, le chef de service son service, pas le reste', async () => {
    expect((await as(t.leroy).post(`${base()}/titulaires`, { fonction: 'chef_service', username: 'leroy', directionCode: 'A1', serviceCode: 'A1b' })).status).toBe(201);
    expect((await as(t.leroy).post(`${base()}/titulaires`, { fonction: 'directeur', username: 'x', directionCode: 'J' })).status).toBe(403);
    expect((await as(t.durand).post(`${base()}/titulaires`, { fonction: 'responsable_intermediaire', username: 'dupont', directionCode: 'A1', serviceCode: 'A1a' })).status).toBe(201);
    expect((await as(t.durand).post(`${base()}/titulaires`, { fonction: 'chef_service', username: 'durand', directionCode: 'A1', serviceCode: 'A1b' })).status).toBe(403);
    expect((await as(t.durand).post(`${base()}/titulaires`, { fonction: 'dgs', username: 'durand' })).status).toBe(403);
    expect((await as(t.dupont).post(`${base()}/titulaires`, { fonction: 'directeur', username: 'dupont', directionCode: 'A1' })).status).toBe(403);
  });

  it('valide la saisie (service sans direction, fonction inconnue) et respecte les dates de validité', async () => {
    expect((await as(admin).post(`${base()}/titulaires`, { fonction: 'directeur', username: 'x', serviceCode: 'A1a' })).status).toBe(400);
    expect((await as(admin).post(`${base()}/titulaires`, { fonction: 'roi', username: 'x' })).status).toBe(400);
    await as(admin).post(`${base()}/titulaires`, { fonction: 'directeur', username: 'passe', directionCode: 'J', validTo: '2000-01-01' });
    await as(admin).post(`${base()}/titulaires`, { fonction: 'directeur', username: 'futur', directionCode: 'J', validFrom: '2999-01-01' });
    expect(await env.c.titulaires.resolve(ville.id, 'directeur', { directionCode: 'J' })).toEqual([]);
    expect((await env.c.titulaires.resolve(ville.id, 'directeur', { directionCode: 'J' }, '2999-06-01')).map((x) => x.username)).toEqual(['futur']);
  });

  it('gère les groupes de valideurs', async () => {
    const g = await as(admin).post(`${base()}/groupes`, { code: 'archives', nom: 'Service des archives' });
    expect(g.status).toBe(201);
    expect((await as(admin).post(`${base()}/groupes`, { code: 'archives', nom: 'Autre nom' })).status).toBe(409);
    const m = await as(admin).put(`${base()}/groupes/${g.body.id}/membres`, { usernames: ['Dupont', 'durand', 'dupont'] });
    expect(m.body.membres).toEqual(['dupont', 'durand']);
    expect((await env.c.titulaires.groupMembers(ville.id, 'archives'))).toEqual(['dupont', 'durand']);
    expect((await as(t.dupont).post(`${base()}/groupes`, { code: 'autre', nom: 'Autre' })).status).toBe(403);
    expect((await as(admin).del(`${base()}/groupes/${g.body.id}`)).status).toBe(204);
  });
});

describe('droits de rédaction (section 8)', () => {
  it('par défaut, un agent rédige pour sa direction et jamais pour une autre', async () => {
    const ok = await newActe(t.dupont);
    expect(ok.status).toBe(201);
    expect(ok.body.direction.code).toBe('A1');
    expect(ok.body.service.code).toBe('A1a');
    const ko = await newActe(t.petit, { directionCode: 'A1', serviceCode: 'A1a' });
    expect(ko.status).toBe(403);
  });

  it('la direction porteuse par défaut est celle du rédacteur (aucune saisie)', async () => {
    const r = await newActe(t.durand);
    expect(r.body).toMatchObject({ redacteur: 'durand', direction: { code: 'A1', label: 'DIRECTION DES FINANCES' }, service: { code: 'A1a', label: 'BUDGET' } });
  });

  it('le directeur autorise un agent d\'une autre direction ; le service porteur est alors à préciser (DRO-08)', async () => {
    const g = await as(t.leroy).post(`${base()}/redaction/autorisations`, { directionCode: 'A1', username: 'Petit', motif: 'projet transverse' });
    expect(g.status).toBe(201);
    expect(g.body).toMatchObject({ username: 'petit', directionCode: 'A1', grantedBy: 'leroy' });
    const noService = await newActe(t.petit, { directionCode: 'A1' });
    expect(noService.status).toBe(400);
    expect(noService.body.error).toMatch(/Service porteur/);
    const ok = await newActe(t.petit, { directionCode: 'A1', serviceCode: 'A1a' });
    expect(ok.status).toBe(201);
    // le circuit se résout à partir de la direction porteuse, pas de la direction d'origine du rédacteur
    expect(ok.body).toMatchObject({ redacteur: 'petit', direction: { code: 'A1' }, service: { code: 'A1a' } });
    const dirs = (await as(t.petit).get(`${base()}/redaction/directions`)).body.items;
    expect(dirs.map((d) => [d.directionCode, d.via.sort()])).toEqual(expect.arrayContaining([['A1', ['autorisation']]]));
    await as(t.leroy).del(`${base()}/redaction/autorisations/${g.body.id}`);
    expect((await newActe(t.petit, { directionCode: 'A1', serviceCode: 'A1a' })).status).toBe(403);
  });

  it('l\'autorisation peut être bornée dans le temps', async () => {
    await env.db.query(`INSERT INTO redaction_grants (organisme_id, direction_code, username, granted_by, expires_at) VALUES ($1, 'A1', 'petit', 'leroy', now() - interval '1 hour')`, [ville.id]);
    expect((await newActe(t.petit, { directionCode: 'A1', serviceCode: 'A1a' })).status).toBe(403);
  });

  it('le chef de service n\'accorde que pour son service ; l\'autorisation de direction relève du directeur', async () => {
    expect((await as(t.durand).post(`${base()}/redaction/autorisations`, { directionCode: 'A1', serviceCode: 'A1a', username: 'nouveau' })).status).toBe(201);
    expect((await as(t.durand).post(`${base()}/redaction/autorisations`, { directionCode: 'A1', username: 'nouveau' })).status).toBe(403);
    expect((await as(t.durand).post(`${base()}/redaction/autorisations`, { directionCode: 'A1', serviceCode: 'A1b', username: 'nouveau' })).status).toBe(403);
    expect((await as(t.dupont).post(`${base()}/redaction/autorisations`, { directionCode: 'A1', username: 'nouveau' })).status).toBe(403);
    expect((await newActe(t.nouveau, { directionCode: 'A1', serviceCode: 'A1a' })).status).toBe(201);
    expect((await newActe(t.nouveau, { directionCode: 'A1', serviceCode: 'A1b' })).status).toBe(403);
  });

  it('chacun ne voit que les autorisations de son périmètre', async () => {
    const forDurand = (await as(t.durand).get(`${base()}/redaction/autorisations`)).body.items;
    expect(forDurand.every((g) => g.serviceCode === 'A1a')).toBe(true);
    expect((await as(admin).get(`${base()}/redaction/autorisations`)).body.items.length).toBeGreaterThanOrEqual(forDurand.length);
    expect((await as(t.dupont).get(`${base()}/redaction/autorisations`)).body.items).toEqual([]);
  });

  it('la politique « explicite » retire le droit par défaut ; « service » le limite au service', async () => {
    await as(admin).put(`${base()}/settings/redaction.politique`, { value: 'explicite' });
    expect((await newActe(t.dupont)).status).toBe(403);
    await as(admin).put(`${base()}/settings/redaction.politique`, { value: 'service' });
    expect((await newActe(t.dupont)).status).toBe(201);
    expect((await newActe(t.dupont, { serviceCode: 'A1b' })).status).toBe(403);
    await as(admin).put(`${base()}/settings/redaction.politique`, { value: 'direction' });
    expect((await newActe(t.dupont, { serviceCode: 'A1b' })).status).toBe(201);
  });
});

describe("fiche d'acte", () => {
  let acte;
  beforeAll(async () => { acte = (await newActe(t.dupont, { titre: 'Attribution d\'une subvention exceptionnelle' })).body; });

  it('numérote le suivi par organisme, applique la nature du type et crée la délibération', async () => {
    const a = (await newActe(t.dupont)).body; const b = (await newActe(t.dupont)).body;
    expect(b.numeroSuivi).toBe(a.numeroSuivi + 1);
    const full = (await as(t.dupont).get(`${base()}/actes/${acte.id}`)).body;
    expect(full.natureId).toBeTruthy();
    expect(full.statut).toBe('brouillon');
    expect(full.deliberations).toHaveLength(1);
    expect(full.deliberations[0].titre).toBe(acte.titre);
    expect(full.droits).toEqual({ modifier: true, administrer: false });
  });

  it('valide les références (type, matière feuille, rubrique) et le titre', async () => {
    expect((await as(t.dupont).post(`${base()}/actes`, { typeId: 99999, titre: 'Titre valide' })).status).toBe(400);
    expect((await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre: 'ab' })).status).toBe(400);
    expect((await newActe(t.dupont, { matiereId: matiereNoeud.id })).status).toBe(400);
    expect((await newActe(t.dupont, { rubriqueId: 99999 })).status).toBe(400);
    expect((await newActe(t.dupont, { matiereId: matiereFeuille.id, rubriqueId: rubrique.id, incidenceFinanciere: true, montant: 12500.5 })).status).toBe(201);
  });

  it("contrôle de complétude : liste ce qui manque avant l'envoi au circuit", async () => {
    const before = (await as(t.dupont).get(`${base()}/actes/${acte.id}`)).body.completude;
    expect(before.complete).toBe(false);
    expect(before.missing.map((m) => m.code)).toEqual(expect.arrayContaining(['matiere', 'incidence_financiere', 'rubrique', 'rapporteur']));
    await as(t.dupont).put(`${base()}/actes/${acte.id}`, { matiereId: matiereFeuille.id, rubriqueId: rubrique.id, incidenceFinanciere: false, rapporteurId: 1 });
    // la fiche est complète ; restent les textes à rédiger (exposé, visas, dispositif), contrôlés depuis le lot 2
    const after = (await as(t.dupont).get(`${base()}/actes/${acte.id}`)).body.completude;
    expect(after.missing.every((m) => m.code === 'expose' || /^(visas|dispositif):/.test(m.code))).toBe(true);
    expect(after.missing).toHaveLength(3);
  });

  it('modifie la fiche ; seuls le rédacteur et ses co-rédacteurs peuvent le faire', async () => {
    expect((await as(t.dupont).put(`${base()}/actes/${acte.id}`, { titre: 'Subvention exceptionnelle 2026', urgence: true })).body).toMatchObject({ titre: 'Subvention exceptionnelle 2026', urgence: true });
    expect((await as(t.durand).put(`${base()}/actes/${acte.id}`, { titre: 'Détournement' })).status).toBe(403);
    expect((await as(t.durand).put(`${base()}/actes/${acte.id}`, { coRedacteurs: ['durand'] })).status).toBe(403);
    expect((await as(t.dupont).put(`${base()}/actes/${acte.id}`, { coRedacteurs: ['Durand', 'dupont'] })).body.coRedacteurs).toEqual(['durand']);
    expect((await as(t.durand).put(`${base()}/actes/${acte.id}`, { titre: 'Modifié par le co-rédacteur' })).status).toBe(200);
  });

  it('la co-édition du service, si activée, ouvre l\'édition aux collègues (VIS-02)', async () => {
    const a = (await newActe(t.dupont)).body;
    expect((await as(t.durand).put(`${base()}/actes/${a.id}`, { urgence: true })).status).toBe(403);
    await as(admin).put(`${base()}/settings/redaction.coedition_service`, { value: true });
    expect((await as(t.durand).put(`${base()}/actes/${a.id}`, { urgence: true })).status).toBe(200);
    await as(admin).put(`${base()}/settings/redaction.coedition_service`, { value: false });
  });

  it("le changement d'incidence financière ou de montant émet un événement de recalcul du circuit (CIR-14)", async () => {
    const seen = [];
    env.c.bus.on('acte.driver_changed', (p) => seen.push(p.drivers));
    await as(t.dupont).put(`${base()}/actes/${acte.id}`, { incidenceFinanciere: true });
    await as(t.dupont).put(`${base()}/actes/${acte.id}`, { incidenceFinanciere: true });
    await as(t.dupont).put(`${base()}/actes/${acte.id}`, { titre: 'Sans effet sur le circuit' });
    expect(seen).toEqual([['incidenceFinanciere']]);
  });

  it('gère plusieurs délibérations par dossier et refuse de descendre sous le minimum (D5)', async () => {
    const d2 = await as(t.dupont).post(`${base()}/actes/${acte.id}/deliberations`, { titre: 'Convention d\'objectifs associée' });
    expect(d2.status).toBe(201);
    expect(d2.body.ordre).toBe(2);
    expect((await as(t.dupont).get(`${base()}/actes/${acte.id}/deliberations`)).body.items).toHaveLength(2);
    expect((await as(t.dupont).put(`${base()}/actes/${acte.id}/deliberations/${d2.body.id}`, { titre: 'Convention modifiée' })).body.titre).toBe('Convention modifiée');
    expect((await as(t.dupont).del(`${base()}/actes/${acte.id}/deliberations/${d2.body.id}`)).status).toBe(204);
    const last = (await as(t.dupont).get(`${base()}/actes/${acte.id}/deliberations`)).body.items[0];
    expect((await as(t.dupont).del(`${base()}/actes/${acte.id}/deliberations/${last.id}`)).status).toBe(409);
    expect((await as(t.durand).post(`${base()}/actes/${acte.id}/deliberations`, { titre: 'Autre délibération' })).status).toBe(201); // co-rédacteur
    expect((await as(t.leroy).post(`${base()}/actes/${acte.id}/deliberations`, { titre: 'Directeur hors circuit' })).status).toBe(403);
  });

  it('abandonne (motif obligatoire, jamais de suppression) puis réactive (administrateur)', async () => {
    const a = (await newActe(t.dupont, { titre: 'Acte à abandonner' })).body;
    expect((await as(t.dupont).post(`${base()}/actes/${a.id}/abandon`, {})).status).toBe(400);
    expect((await as(t.petit).post(`${base()}/actes/${a.id}/abandon`, { motif: 'Pas mon acte' })).status).toBe(404);
    const r = await as(t.dupont).post(`${base()}/actes/${a.id}/abandon`, { motif: 'Le projet est reporté' });
    expect(r.body).toMatchObject({ statut: 'abandonne', abandonMotif: 'Le projet est reporté' });
    expect((await as(t.dupont).get(`${base()}/actes?q=abandonner`)).body.items).toHaveLength(0);
    expect((await as(t.dupont).get(`${base()}/actes?q=abandonner&includeAbandoned=true`)).body.items).toHaveLength(1);
    expect((await as(t.dupont).put(`${base()}/actes/${a.id}`, { titre: 'Modif après abandon' })).status).toBe(403);
    expect((await as(t.dupont).post(`${base()}/actes/${a.id}/reactivate`)).status).toBe(403);
    expect((await as(admin).post(`${base()}/actes/${a.id}/reactivate`)).body.statut).toBe('brouillon');
    expect((await env.db.get('SELECT count(*)::int AS n FROM actes WHERE id = $1', [a.id])).n).toBe(1);
  });

  it('duplique un acte en nouveau brouillon', async () => {
    const c = await as(t.dupont).post(`${base()}/actes/${acte.id}/duplicate`);
    expect(c.status).toBe(201);
    expect(c.body.titre).toMatch(/\(copie\)$/);
    expect(c.body.numeroSuivi).toBeGreaterThan(acte.numeroSuivi);
    expect(c.body.matiereId).toBe(matiereFeuille.id);
  });
});

describe('visibilité (VIS-01, VIS-02, VIS-05)', () => {
  let a;
  beforeAll(async () => { a = (await newActe(t.dupont, { titre: 'Brouillon confidentiel du service budget' })).body; });
  const view = (tok) => as(tok).get(`${base()}/actes/${a.id}`).then((r) => r.status);

  it('un brouillon est vu du rédacteur, de son service et de sa hiérarchie, pas des autres', async () => {
    expect(await view(t.dupont)).toBe(200);
    expect(await view(t.durand)).toBe(200); // même service (et chef de service)
    expect(await view(t.leroy)).toBe(200); // directeur de la direction
    expect(await view(t.petit)).toBe(404);
    expect(await view(t.martin)).toBe(404);
    expect(await view(admin)).toBe(200);
  });

  it('un agent d\'un autre service de la même direction ne voit pas le brouillon, sauf s\'il en est le directeur', async () => {
    const autreService = await loginAs(env, 'moreau', 'pw-moreau'); // direction A1, service A1b, aucune fonction de titulaire
    expect(await view(autreService)).toBe(404);
  });

  it('les listes appliquent la même règle', async () => {
    const ids = async (tok) => (await as(tok).get(`${base()}/actes?limit=200`)).body.items.map((x) => x.id);
    expect(await ids(t.dupont)).toContain(a.id);
    expect(await ids(t.durand)).toContain(a.id);
    expect(await ids(t.leroy)).toContain(a.id);
    expect(await ids(t.petit)).not.toContain(a.id);
    expect(await ids(admin)).toContain(a.id);
    expect((await as(t.dupont).get(`${base()}/actes?scope=mine&limit=200`)).body.items.every((x) => x.redacteur === 'dupont')).toBe(true);
    expect((await as(t.dupont).get(`${base()}/actes?q=confidentiel`)).body.total).toBe(1);
  });

  it('le rôle lecteur voit tout en lecture seule', async () => {
    await as(admin).post(`${base()}/roles`, { username: 'nouveau', role: 'lecteur' });
    expect(await view(t.nouveau)).toBe(200);
    expect((await as(t.nouveau).put(`${base()}/actes/${a.id}`, { titre: 'Lecteur qui modifie' })).status).toBe(403);
    expect((await as(t.nouveau).post(`${base()}/actes/${a.id}/commentaires`, { body: 'Lecteur qui commente' })).status).toBe(403);
    await env.db.query("DELETE FROM user_org_roles WHERE username = 'nouveau'");
  });

  it('un acte est inaccessible depuis un autre organisme (isolation)', async () => {
    const ccas = (await as(admin).post('/api/v1/organismes', { code: 'ccas', nom: 'CCAS', type: 'ccas' })).body;
    await as(admin).post(`/api/v1/organismes/${ccas.id}/roles`, { username: 'martin', role: 'org_admin' });
    await as(admin).put(`/api/v1/organismes/${ccas.id}/directions`, { directions: [{ code: 'J', label: 'DIRECTION CCAS' }] });
    const tm = await loginAs(env, 'martin', 'pw-martin'); // direction J rattachée au CCAS : plus aucun accès à la Ville
    expect((await as(tm).get(`/api/v1/organismes/${ville.id}/actes/${a.id}`)).status).toBe(403);
    expect((await as(tm).get(`/api/v1/organismes/${ccas.id}/actes/${a.id}`)).status).toBe(404);
    expect((await as(tm).get(`/api/v1/organismes/${ccas.id}/actes`)).body.items).toEqual([]);
    expect((await as(admin).get(`/api/v1/organismes/${ccas.id}/actes/${a.id}`)).status).toBe(404);
    await as(admin).put(`/api/v1/organismes/${ccas.id}/directions`, { directions: [] }); // remet la direction J dans la Ville pour la suite
  });

  it('le n° de suivi est propre à chaque organisme', async () => {
    const ccas = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ccas');
    const types = (await as(admin).get(`/api/v1/organismes/${ccas.id}/referentiels/type_acte`)).body.items;
    const r = await as(admin).post(`/api/v1/organismes/${ccas.id}/actes`, { typeId: types[0].id, titre: 'Premier acte du CCAS', directionCode: 'J', serviceCode: 'Ja' });
    expect(r.status).toBe(201);
    expect(r.body.numeroSuivi).toBe(1);
  });
});

describe('annexes (PDF)', () => {
  let a; let pdf; let annexe;
  const url = () => `${base()}/actes/${a.id}/annexes`;
  beforeAll(async () => { a = (await newActe(t.dupont, { titre: 'Acte avec annexes' })).body; pdf = await makePdf(3); });

  it('téléverse un PDF contrôlé, avec pages et empreinte', async () => {
    const r = await env.http().post(url()).set(bearer(t.dupont)).field('titre', 'Convention signée').field('communicable', 'true').field('publiable', 'false').attach('file', pdf, 'convention.pdf');
    expect(r.status).toBe(201);
    annexe = r.body;
    expect(annexe).toMatchObject({ titre: 'Convention signée', ordre: 1, version: 1, publiable: false, communicable: true, transmissible: true });
    expect(annexe.fichier).toMatchObject({ nom: 'convention.pdf', pages: 3 });
    expect(annexe.fichier.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('restitue exactement le fichier déposé, sans mise en cache partagée', async () => {
    const r = await env.http().get(`${url()}/${annexe.id}/file`).set(bearer(t.dupont)).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['cache-control']).toContain('no-store');
    expect(Buffer.compare(r.body, pdf)).toBe(0);
  });

  it('refuse ce qui n\'est pas un PDF, même renommé, ou qui contient du contenu actif', async () => {
    const fake = await env.http().post(url()).set(bearer(t.dupont)).field('titre', 'Faux').attach('file', Buffer.from('MZ\x90 ceci est un exécutable'), 'virus.pdf');
    expect(fake.status).toBe(400);
    expect(fake.body.error).toMatch(/pas un PDF/);
    const js = Buffer.concat([pdf, Buffer.from('\n1 0 obj << /JavaScript (app.alert(1)) >> endobj')]);
    const r = await env.http().post(url()).set(bearer(t.dupont)).field('titre', 'Actif').attach('file', js, 'actif.pdf');
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/contenu actif/);
    const trunc = await env.http().post(url()).set(bearer(t.dupont)).field('titre', 'Tronqué').attach('file', pdf.subarray(0, 300), 'tronque.pdf');
    expect(trunc.status).toBe(400);
    expect((await env.http().post(url()).set(bearer(t.dupont)).field('titre', 'Sans fichier')).status).toBe(400);
    expect((await env.http().post(url()).set(bearer(t.dupont)).attach('file', pdf, 'sans-titre.pdf')).status).toBe(400);
  });

  it('refuse un fichier au-delà de la taille maximale paramétrée', async () => {
    const e2 = await createTestEnv({ env: { MAX_UPLOAD_MB: '0.002' } });
    try {
      const tk = await adminToken(e2);
      const v = (await e2.http().get('/api/v1/organismes').set(bearer(tk))).body.items[0];
      const types = (await e2.http().get(`/api/v1/organismes/${v.id}/referentiels/type_acte`).set(bearer(tk))).body.items;
      const ac = (await e2.http().post(`/api/v1/organismes/${v.id}/actes`).set(bearer(tk)).send({ typeId: types[0].id, titre: 'Test taille', directionCode: 'A1', serviceCode: 'A1a' })).body;
      const r = await e2.http().post(`/api/v1/organismes/${v.id}/actes/${ac.id}/annexes`).set(bearer(tk)).field('titre', 'Gros').attach('file', await makePdf(40), 'gros.pdf');
      expect(r.status).toBe(413);
      expect(r.body.code).toBe('PAYLOAD_TOO_LARGE');
    } finally { await e2.close(); }
  });

  it('remplace le fichier : nouvelle version, l\'ancienne reste consultable (ANN-04)', async () => {
    const pdf2 = await makePdf(5);
    const r = await env.http().put(`${url()}/${annexe.id}/file`).set(bearer(t.dupont)).attach('file', pdf2, 'convention-v2.pdf');
    expect(r.body).toMatchObject({ version: 2, fichier: { pages: 5 } });
    const versions = (await as(t.dupont).get(`${url()}/${annexe.id}/versions`)).body.items;
    expect(versions.map((v) => [v.version, v.fichier.pages])).toEqual([[2, 5], [1, 3]]);
    const old = await env.http().get(`${url()}/${annexe.id}/file?version=1`).set(bearer(t.dupont)).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(Buffer.compare(old.body, pdf)).toBe(0);
  });

  it('ordonne, modifie les drapeaux et supprime', async () => {
    const b = (await env.http().post(url()).set(bearer(t.dupont)).field('titre', 'Plan').attach('file', await makePdf(1), 'plan.pdf')).body;
    expect(b.ordre).toBe(2);
    const o = await as(t.dupont).put(`${url()}/order`, { ids: [b.id, annexe.id] });
    expect(o.body.items.map((x) => x.id)).toEqual([b.id, annexe.id]);
    expect((await as(t.dupont).put(`${url()}/order`, { ids: [b.id] })).status).toBe(400);
    expect((await as(t.dupont).put(`${url()}/${b.id}`, { transmissible: false, titre: 'Plan de situation' })).body).toMatchObject({ transmissible: false, titre: 'Plan de situation' });
    expect((await as(t.dupont).del(`${url()}/${b.id}`)).status).toBe(204);
    expect((await as(t.dupont).del(`${url()}/${b.id}`)).status).toBe(404);
  });

  it('applique les droits : visibilité de l\'acte pour lire, édition pour modifier', async () => {
    expect((await as(t.durand).get(url())).status).toBe(200);
    expect((await as(t.petit).get(url())).status).toBe(404);
    expect((await as(t.petit).get(`${url()}/${annexe.id}/file`)).status).toBe(404);
    expect((await env.http().post(url()).set(bearer(t.durand)).field('titre', 'Collègue').attach('file', pdf, 'x.pdf')).status).toBe(403);
    expect((await as(t.durand).del(`${url()}/${annexe.id}`)).status).toBe(403);
  });

  it('enregistre l\'audit avec l\'empreinte du fichier', async () => {
    const audit = (await as(admin).get(`/api/v1/audit?organismeId=${ville.id}&action=annexe.add`)).body.items;
    expect(audit[0].after.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('commentaires (section 14)', () => {
  let a; let c1;
  const url = () => `${base()}/actes/${a.id}/commentaires`;
  beforeAll(async () => { a = (await newActe(t.dupont, { titre: 'Acte débattu' })).body; });

  it('ajoute un commentaire avec mentions, puis une réponse', async () => {
    const r = await as(t.durand).post(url(), { title: 'Question', body: 'Peux-tu vérifier le montant @Dupont et prévenir @leroy ?' });
    expect(r.status).toBe(201);
    c1 = r.body;
    expect(c1).toMatchObject({ author: 'durand', kind: 'comment', mentions: ['dupont', 'leroy'], resolved: false });
    const rep = await as(t.dupont).post(url(), { body: 'C\'est vérifié.', parentId: c1.id });
    expect(rep.body.parentId).toBe(c1.id);
    expect((await as(t.dupont).post(url(), { body: 'x', parentId: 9999 })).status).toBe(400);
    expect((await as(t.dupont).get(url())).body.items.map((x) => x.id)).toEqual([c1.id, rep.body.id]);
  });

  it('est invisible pour qui ne voit pas l\'acte', async () => {
    expect((await as(t.petit).get(url())).status).toBe(404);
    expect((await as(t.petit).post(url(), { body: 'intrus' })).status).toBe(404);
  });

  it('marque comme traité ; seul l\'administrateur masque, avec trace', async () => {
    expect((await as(t.dupont).put(`${url()}/${c1.id}/resolution`, { resolved: true })).body.resolved).toBe(true);
    expect((await as(t.dupont).put(`${url()}/${c1.id}/masquage`, { hidden: true })).status).toBe(403);
    const h = await as(admin).put(`${url()}/${c1.id}/masquage`, { hidden: true });
    expect(h.body).toMatchObject({ hidden: true, body: '[commentaire masqué]' });
    expect((await env.db.get('SELECT body FROM comments WHERE id = $1', [c1.id])).body).toContain('vérifier le montant');
    expect((await as(admin).get(`/api/v1/audit?organismeId=${ville.id}&action=comment.hide`)).body.items).toHaveLength(1);
  });

  it('valide la saisie', async () => {
    expect((await as(t.dupont).post(url(), { body: '' })).status).toBe(400);
    expect((await as(t.dupont).post(url(), { body: 'x'.repeat(10001) })).status).toBe(400);
  });
});
