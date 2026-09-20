const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubriques; let instance; let seance; let com;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const K = (id = seance.id) => `${base()}/seances/${id}/kpis`;
const WHO = { chef_service: 'durand', directeur: 'leroy', juridique: 'nouveau', dga: 'petit', dgs: 'boot', scc: 'martin' };
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

async function mk(titre, { submit = false, finish = false, seanceId = seance.id } = {}) {
  const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre })).body;
  await as(t.dupont).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubriques[0].id, incidenceFinanciere: false, rapporteurId: 1, seanceViseeId: seanceId });
  if (submit || finish) {
    for (const x of (await as(t.dupont).get(`${A(a.id)}/textes`)).body.items) await as(t.dupont).put(`${A(a.id)}/textes/${x.id}`, { markdown: `Texte ${x.kind}.`, baseVersion: x.version });
    await as(t.dupont).post(`${A(a.id)}/envoi`);
  }
  if (finish) for (let i = 0; i < 10; i++) { const v = (await as(t.dupont).get(`${A(a.id)}/circuit`)).body; if (!v.currentStepKey) break; await as(t[WHO[v.currentStepKey]]).post(`${A(a.id)}/validation`, {}); }
  return a;
}

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
  seance = (await as(t.martin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: inDays(60) })).body;
  com = (await as(admin).post(`${base()}/commissions`, { nom: 'Commission Finances', sieges: 9, siegesOpposition: 2, thematiques: ['Finances'] })).body;
  await as(t.martin).post(`${base()}/commissions/${com.id}/reunions`, { dateSeance: inDays(20), dureeMinutes: 90, teams: { mode: 'aucun' } });
});
afterAll(async () => { await env.close(); });

describe('indicateurs de la séance', () => {
  let fini; let enCircuit; let brouillon;
  it('séance sans dossier : rien à terminer, compte à rebours et jalons présents', async () => {
    const r = await as(t.martin).get(K());
    expect(r.status).toBe(200);
    expect(r.body.avancement).toMatchObject({ total: 0, tauxRealisation: 100 });
    expect(r.body.aTerminer.total).toBe(0);
    expect(r.body.compteARebours.jours).toBeGreaterThanOrEqual(59);
    expect(r.body.compteARebours.jalons.some((j) => j.code === 'redaction')).toBe(true);
  });

  it('compte les dossiers terminés, en circuit et en rédaction, et calcule le taux de réalisation', async () => {
    fini = await mk('Dossier terminé', { finish: true });
    enCircuit = await mk('Dossier en circuit', { submit: true });
    brouillon = await mk('Dossier en rédaction');
    const r = (await as(t.martin).get(K())).body;
    expect(r.avancement).toMatchObject({ total: 3, prets: 1, enCircuit: 1, brouillons: 1, aCorriger: 0, tauxRealisation: 33 });
    expect(r.aTerminer.total).toBe(2);
    expect(r.aTerminer.items.map((i) => i.acteId).sort()).toEqual([enCircuit.id, brouillon.id].sort());
    expect(r.aTerminer.items.find((i) => i.acteId === enCircuit.id)).toMatchObject({ etat: 'en_circuit', etape: 'Chef de service', holders: ['durand'], enRetard: false });
  });

  it('donne le numéro d\'ordre du jour et le lien (identifiant) des dossiers inscrits', async () => {
    await as(t.martin).post(`${base()}/seances/${seance.id}/odj/affectations`, { acteIds: [fini.id, enCircuit.id] });
    const r = (await as(t.martin).get(K())).body;
    const it = r.aTerminer.items.find((i) => i.acteId === enCircuit.id);
    expect(it.numero).toMatch(/\d/); // numérotation provisoire du Conseil
    expect(it.dansOdj).toBe(true);
    expect(r.aTerminer.items.find((i) => i.acteId === brouillon.id).numero).toBeNull();
    expect(r.avancement.dansOdj).toBe(2);
  });

  it('détaille les directions, avec celles en retard quand la date limite de rédaction est dépassée', async () => {
    const r = (await as(t.martin).get(K())).body;
    expect(r.directions.items.length).toBeGreaterThan(0);
    expect(r.directions.items[0]).toMatchObject({ total: 3, prets: 1, aTerminer: 2 });
    expect(r.directions.enRetard).toBe(0);
    const late = (await as(t.martin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: inDays(14), dateLimiteRedaction: inDays(-2), dateLimiteDgs: inDays(3) })).body;
    await mk('Brouillon hors délai', { seanceId: late.id });
    const k = (await as(t.martin).get(K(late.id))).body;
    expect(k.directions.enRetard).toBe(1);
    expect(k.aTerminer.enRetard).toBe(1);
    expect(k.aTerminer.items[0]).toMatchObject({ enRetard: true, motifRetard: 'date limite de rédaction dépassée' });
    expect(k.compteARebours.prochainJalon.code).toBe('dgs');
  });

  it('suit chaque commission : actes terminés / prévus et compte à rebours de sa réunion', async () => {
    expect((await as(t.martin).post(`${A(fini.id)}/commissions`, { commissionId: com.id })).status).toBe(201);
    expect((await as(t.martin).post(`${A(enCircuit.id)}/commissions`, { commissionId: com.id })).status).toBe(201);
    let r = (await as(t.martin).get(K())).body;
    expect(r.commissions).toHaveLength(1);
    expect(r.commissions[0]).toMatchObject({ nom: 'Commission Finances', prevus: 2, termines: 0, tauxRealisation: 0 });
    expect(r.commissions[0].prochaineReunion.jours).toBeGreaterThanOrEqual(19);
    expect(r.commissions[0].restants).toHaveLength(2);
    await env.db.run("UPDATE acte_commissions SET avis = 'favorable', avis_at = now() WHERE acte_id = $1 AND commission_id = $2", [fini.id, com.id]); // (la saisie de l'avis a son propre test : lot4c)
    r = (await as(t.martin).get(K())).body;
    expect(r.commissions[0]).toMatchObject({ prevus: 2, termines: 1, tauxRealisation: 50 });
    expect(r.commissions[0].restants.map((x) => x.acteId)).toEqual([enCircuit.id]);
  });

  it('est réservé au SCC et aux administrateurs, et n\'existe pas pour une séance d\'une autre collectivité', async () => {
    expect((await as(t.dupont).get(K())).status).toBe(403);
    expect((await as(t.martin).get(K(999999))).status).toBe(404);
  });
});
