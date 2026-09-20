const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubriques; let instance; let elus;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const S = (id, p = '') => `${base()}/seances/${id}${p}`;
const WHO = { chef_service: 'durand', directeur: 'leroy', juridique: 'nouveau', dga: 'petit', dgs: 'boot', scc: 'martin' };
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
const seance = async (days) => (await as(t.martin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: inDays(days) })).body;

async function acte(titre, seanceId, { termine = false } = {}) {
  const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre })).body;
  await as(t.dupont).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubriques[0].id, incidenceFinanciere: false, rapporteurId: 1, seanceViseeId: seanceId });
  if (termine) {
    for (const x of (await as(t.dupont).get(`${A(a.id)}/textes`)).body.items) await as(t.dupont).put(`${A(a.id)}/textes/${x.id}`, { markdown: `Texte ${x.kind}.`, baseVersion: x.version });
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    for (let i = 0; i < 10; i++) { const v = (await as(t.dupont).get(`${A(a.id)}/circuit`)).body; if (!v.currentStepKey) break; await as(t[WHO[v.currentStepKey]]).post(`${A(a.id)}/validation`, {}); }
    await as(t.martin).post(`${S(seanceId)}/odj/affectations`, { acteIds: [a.id], motif: 'Ajout à l’ordre du jour' });
  }
  return a.id;
}
const info = async (id) => (await as(t.dupont).get(A(id))).body;

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = { boot: admin };
  for (const [u, p] of [['dupont', 'pw-dupont'], ['durand', 'pw-durand'], ['leroy', 'pw-leroy'], ['petit', 'pw-petit'], ['martin', 'pw-martin'], ['nouveau', 'pw-nouveau'], ['moreau', 'pw-moreau']]) t[u] = await loginAs(env, u, p);
  const items = (k) => as(admin).get(`${base()}/referentiels/${k}`).then((r) => r.body.items);
  matiere = (await items('matiere')).find((x) => x.code === '7.5'); rubriques = await items('rubrique');
  typeDelib = (await items('type_acte')).find((x) => x.code === 'deliberation');
  const tit = (fonction, username, extra = {}) => as(admin).post(`${base()}/titulaires`, { fonction, username, ...extra });
  await tit('chef_service', 'durand', { directionCode: 'A1', serviceCode: 'A1a' }); await tit('directeur', 'leroy', { directionCode: 'A1' });
  await tit('dga', 'petit', { directionCode: 'A1' }); await tit('dgs', 'boot');
  const groups = (await as(admin).get(`${base()}/groupes`)).body.items;
  const setMembers = (code, usernames) => as(admin).put(`${base()}/groupes/${groups.find((g) => g.code === code).id}/membres`, { usernames });
  await setMembers('financier', ['moreau']); await setMembers('juridique', ['nouveau']); await setMembers('scc', ['martin']);
  await as(admin).post(`${base()}/roles`, { username: 'martin', role: 'scc' });
  instance = (await as(admin).get(`${base()}/instances`)).body.items[0];
  elus = (await as(admin).get(`${base()}/elus`)).body.items;
});
afterAll(async () => { await env.close(); });

describe('modifier une séance', () => {
  it('modifie la date, le lieu et la durée ; les dates clés restent celles de la séance', async () => {
    const s = await seance(30);
    const r = await as(t.martin).put(S(s.id), { dateSeance: inDays(40), lieu: 'Salle des fêtes', dureeMinutes: 180 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ lieu: 'Salle des fêtes', dureeMinutes: 180 });
    expect(new Date(r.body.dateSeance).getTime()).toBeGreaterThan(new Date(s.dateSeance).getTime());
    expect((await as(t.dupont).put(S(s.id), { lieu: 'Ailleurs' })).status).toBe(403); // réservé au SCC et aux administrateurs
  });
});

describe('supprimer une séance', () => {
  it('annonce l’impact : actes concernés, séance suivante proposée', async () => {
    const a = await seance(60); const b = await seance(90);
    const brouillon = await acte('Brouillon visant la séance', a.id);
    const pret = await acte('Terminé, à l’ordre du jour', a.id, { termine: true });
    const imp = (await as(t.martin).get(S(a.id, '/suppression'))).body;
    expect(imp).toMatchObject({ supprimable: true, convocations: 0, suivante: { id: b.id } });
    expect(imp.actes.map((x) => x.id).sort()).toEqual([brouillon, pret].sort());
    expect(imp.actes.find((x) => x.id === pret).alOrdreDuJour).toBe(true);
    expect((await as(t.dupont).get(S(a.id, '/suppression'))).status).toBe(403);
  });

  it('exige de dire ce que deviennent les actes, puis les reporte sur la séance suivante (historisé)', async () => {
    const a = await seance(61); await seance(91);
    const suivante = (await as(t.martin).get(S(a.id, '/suppression'))).body.suivante.id; // la séance suivante de l’instance (il y en a d’autres, créées plus haut)
    const brouillon = await acte('Brouillon reporté', a.id);
    const pret = await acte('Prêt reporté', a.id, { termine: true });
    expect((await as(t.martin).del(S(a.id))).status).toBe(400); // destination obligatoire
    const r = await as(t.martin).del(`${S(a.id)}?destination=prochaine&motif=${encodeURIComponent('Séance déplacée')}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ deleted: a.id, actes: 2, destination: 'prochaine', vers: suivante });
    expect((await as(t.martin).get(S(a.id))).status).toBe(404);
    const p = await info(pret);
    expect(p).toMatchObject({ seanceViseeId: suivante, seanceId: null, statut: 'en_attente_scc' }); // il redevient « à affecter », plus « inscrit »
    expect((await info(brouillon)).seanceViseeId).toBe(suivante);
    const h = (await as(t.martin).get(`${base()}/actes/${pret}/seance-historique`)).body;
    expect(JSON.stringify(h)).toContain('report');
  });

  it('peut aussi remettre les actes sans affectation', async () => {
    const a = await seance(62);
    const pret = await acte('Prêt sans affectation', a.id, { termine: true });
    const r = await as(t.martin).del(`${S(a.id)}?destination=aucune`);
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ actes: 1, destination: 'aucune', vers: null });
    expect(await info(pret)).toMatchObject({ seanceViseeId: null, seanceId: null, statut: 'en_attente_scc' });
  });

  it('refuse « prochaine » quand il n’y a pas de séance suivante, mais accepte « aucune »', async () => {
    const last = await seance(400);
    const a = await acte('Dernière séance', last.id);
    const r = await as(t.martin).del(`${S(last.id)}?destination=prochaine`);
    expect(r.status).toBe(409); expect(r.body.error).toMatch(/pas de séance suivante/);
    expect((await as(t.martin).get(S(last.id))).status).toBe(200); // rien n’a été supprimé
    expect((await as(t.martin).del(`${S(last.id)}?destination=aucune`)).status).toBe(200);
    expect((await info(a)).seanceViseeId).toBeNull();
  });

  it('une séance sans acte se supprime sans autre question ; réservé au SCC et aux administrateurs', async () => {
    const a = await seance(70);
    expect((await as(t.dupont).del(S(a.id))).status).toBe(403);
    expect((await as(t.martin).del(S(a.id))).status).toBe(200);
  });

  it('une séance dont le suivi est ouvert (tenue) ne se supprime pas', async () => {
    const a = await seance(2);
    await as(t.martin).post(S(a.id, '/tenue/ouverture'));
    const imp = (await as(t.martin).get(S(a.id, '/suppression'))).body;
    expect(imp).toMatchObject({ supprimable: false });
    expect((await as(t.martin).del(`${S(a.id)}?destination=aucune`)).status).toBe(409);
    expect(elus.length).toBeGreaterThanOrEqual(0);
  });

  it('des convocations déjà envoyées demandent une confirmation explicite (forcer)', async () => {
    const a = await seance(80);
    await env.db.run("INSERT INTO convocations (organisme_id, seance_id, version_no, objet, statut, created_by) VALUES ($1,$2,1,'Convocation','envoyee','martin')", [ville.id, a.id]);
    const imp = (await as(t.martin).get(S(a.id, '/suppression'))).body;
    expect(imp.convocations).toBe(1);
    const r = await as(t.martin).del(S(a.id));
    expect(r.status).toBe(409); expect(r.body.error).toMatch(/convocations/);
    expect((await as(t.martin).del(`${S(a.id)}?forcer=true`)).status).toBe(200);
  });
});
