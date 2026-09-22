const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t; let typeDelib; let typeDecision; let typeArrete; let matiere; let rubrique;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const P = (id) => `${base()}/parapheur/actes/${id}`;

async function readyActe(typeId, titre) {
  const a = (await as(t.dupont).post(`${base()}/actes`, { typeId, titre })).body;
  await as(t.dupont).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubrique.id, incidenceFinanciere: false, rapporteurId: 1 });
  const texts = (await as(t.dupont).get(`${A(a.id)}/textes`)).body.items;
  for (const x of texts) await as(t.dupont).put(`${A(a.id)}/textes/${x.id}`, { markdown: `Texte ${x.kind}.`, baseVersion: x.version });
  return a;
}
const cur = async (id, tok = t.dupont) => (await as(tok).get(`${A(id)}/circuit`)).body;
const WHO = { resp_intermediaire: 'dupont', chef_service: 'durand', directeur: 'leroy', financier: 'moreau', juridique: 'nouveau', dga: 'petit', dgs: 'boot', scc: 'martin' };
async function runCircuit(id) {
  for (let i = 0; i < 12; i++) {
    const v = await cur(id);
    if (!v.currentStepKey) return v;
    const r = await as(t[WHO[v.currentStepKey]]).post(`${A(id)}/validation`, {});
    if (r.status !== 200) throw new Error(`validation ${v.currentStepKey}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  throw new Error('trop d’étapes');
}

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = { boot: admin };
  for (const [u, p] of [['dupont', 'pw-dupont'], ['durand', 'pw-durand'], ['leroy', 'pw-leroy'], ['petit', 'pw-petit'], ['martin', 'pw-martin'], ['nouveau', 'pw-nouveau'], ['moreau', 'pw-moreau']]) t[u] = await loginAs(env, u, p);
  const items = (k) => as(admin).get(`${base()}/referentiels/${k}`).then((r) => r.body.items);
  matiere = (await items('matiere')).find((x) => x.code === '7.5');
  rubrique = (await items('rubrique')).find((x) => x.libelle === 'FINANCES');
  typeDelib = (await items('type_acte')).find((x) => x.code === 'deliberation');
  typeDecision = (await items('type_acte')).find((x) => x.code === 'decision');
  typeArrete = (await items('type_acte')).find((x) => x.code === 'arrete');
  const tit = (fonction, username, extra = {}) => as(admin).post(`${base()}/titulaires`, { fonction, username, ...extra });
  await tit('chef_service', 'durand', { directionCode: 'A1', serviceCode: 'A1a' });
  await tit('directeur', 'leroy', { directionCode: 'A1' });
  await tit('dga', 'petit', { directionCode: 'A1' });
  await tit('dgs', 'boot');
  const groups = (await as(admin).get(`${base()}/groupes`)).body.items;
  const setMembers = (code, usernames) => as(admin).put(`${base()}/groupes/${groups.find((g) => g.code === code).id}/membres`, { usernames });
  await setMembers('financier', ['moreau']);
  await setMembers('juridique', ['nouveau']);
  await setMembers('scc', ['martin']);
  await as(admin).post(`${base()}/roles`, { username: 'martin', role: 'scc' });
});
afterAll(async () => { await env.close(); });

describe('types d’acte décision et arrêté', () => {
  it('propose les trois types dès la création (délibération, décision, arrêté)', async () => {
    const codes = [typeDelib, typeDecision, typeArrete].map((x) => x?.code);
    expect(codes).toEqual(['deliberation', 'decision', 'arrete']);
    expect(typeDecision.meta?.signature).toBe(true);
    expect(typeDecision.meta?.autorisations).toBe(true);
    expect(typeArrete.meta?.signature).toBe(true);
    expect(typeDecision.meta?.aide).toBeTruthy();
  });
});

describe('délibérations d’autorisation d’une décision', () => {
  it('refuse une délibération non adoptée puis accepte une délibération adoptée', async () => {
    const delib = await readyActe(typeDelib.id, 'Délibération autorisant le maire à signer les tickets restaurant');
    const decision = await readyActe(typeDecision.id, 'Décision d’attribution des tickets restaurant');
    expect((await as(t.dupont).post(`${A(decision.id)}/liens`, { cibleActeId: delib.id })).status).toBe(400);
    await env.db.run("UPDATE actes SET statut = 'adopte' WHERE id = $1", [delib.id]);
    const r = await as(t.dupont).post(`${A(decision.id)}/liens`, { cibleActeId: delib.id });
    expect(r.status).toBe(201);
    expect(r.body.items).toHaveLength(1);
    const got = await as(t.dupont).get(A(decision.id));
    expect(got.body.liens.map((l) => l.cibleActeId)).toEqual([delib.id]);
  });

  it('rend la décision incomplète tant qu’aucune autorisation n’est liée', async () => {
    const decision = await readyActe(typeDecision.id, 'Décision sans autorisation');
    const g = await as(t.dupont).get(A(decision.id));
    expect(g.body.completude.complete).toBe(false);
    expect(g.body.completude.missing.map((m) => m.code)).toContain('autorisation');
  });
});

describe('circuit d’une décision : signature à la place du conseil', () => {
  it('une délibération terminée reste « en attente SCC »', async () => {
    const delib = await readyActe(typeDelib.id, 'Délibération ordinaire');
    await as(t.dupont).post(`${A(delib.id)}/envoi`);
    await runCircuit(delib.id);
    expect((await as(t.dupont).get(A(delib.id))).body.statut).toBe('en_attente_scc');
  });

  it('paramètre le parapheur (DSIHUB, mode dev) et ne renvoie jamais le mot de passe', async () => {
    const put = await as(admin).put(`${base()}/parapheur/config`, { fournisseur: 'dsihub', actif: true, mode: 'dev', url: '', utilisateur: 'parapheur', motDePasse: 'secret-hub', email_test: 'parapheur-dev@ivry.test', signataire_nom: 'Maire', signataire_qualite: 'Maire' });
    expect(put.status).toBe(200);
    expect(put.body.secretDefini).toBe(true);
    expect(JSON.stringify(put.body)).not.toContain('secret-hub');
    const get = await as(admin).get(`${base()}/parapheur/config`);
    expect(get.body.fournisseurs.map((f) => f.code)).toEqual(['dsihub', 'iparapheur']);
  });

  it('refuse iParapheur (non implémenté)', async () => {
    const r = await as(admin).put(`${base()}/parapheur/config`, { fournisseur: 'iparapheur' });
    expect(r.status).toBe(409);
  });

  it('termine le circuit en « à signer » et envoie automatiquement en signature, avec journal', async () => {
    const delib = await readyActe(typeDelib.id, 'Autorisation du maire (délibération)');
    await env.db.run("UPDATE actes SET statut = 'adopte' WHERE id = $1", [delib.id]);
    const decision = await readyActe(typeDecision.id, 'Décision prise par délégation');
    await as(t.dupont).post(`${A(decision.id)}/liens`, { cibleActeId: delib.id });
    await as(t.dupont).put(`${A(decision.id)}/signature-position`, { page: 1, x: 75, y: 85, w: 150, h: 60 });
    await as(t.dupont).post(`${A(decision.id)}/envoi`);
    await runCircuit(decision.id);
    const after = await as(t.dupont).get(A(decision.id));
    expect(after.body.statut).toBe('a_signer');
    const etat = await as(t.martin).get(P(decision.id));
    expect(etat.status).toBe(200);
    expect(etat.body.envoi.statut).toBe('a_signer');
    expect(etat.body.envoi.signataireEmail).toBe('parapheur-dev@ivry.test');
    expect(etat.body.journal.some((x) => x.sens === 'sortant')).toBe(true);
    expect(etat.body.journal.some((x) => x.sens === 'entrant')).toBe(true);
  });

  it('simule le retour du parapheur : la décision devient signée', async () => {
    const delib = await readyActe(typeDelib.id, 'Autorisation n°2');
    await env.db.run("UPDATE actes SET statut = 'adopte' WHERE id = $1", [delib.id]);
    const decision = await readyActe(typeDecision.id, 'Décision à signer n°2');
    await as(t.dupont).post(`${A(decision.id)}/liens`, { cibleActeId: delib.id });
    await as(t.dupont).put(`${A(decision.id)}/signature-position`, { page: 1, x: 75, y: 85, w: 150, h: 60 });
    await as(t.dupont).post(`${A(decision.id)}/envoi`);
    await runCircuit(decision.id);
    const r = await as(t.martin).post(`${P(decision.id)}/retour`, { statut: 'signe' });
    expect(r.status).toBe(200);
    expect((await as(t.dupont).get(A(decision.id))).body.statut).toBe('signe');
  });

  it('un refus de signature met le dossier en « signature refusée »', async () => {
    const delib = await readyActe(typeDelib.id, 'Autorisation n°3');
    await env.db.run("UPDATE actes SET statut = 'adopte' WHERE id = $1", [delib.id]);
    const decision = await readyActe(typeDecision.id, 'Décision refusée');
    await as(t.dupont).post(`${A(decision.id)}/liens`, { cibleActeId: delib.id });
    await as(t.dupont).put(`${A(decision.id)}/signature-position`, { page: 1, x: 75, y: 85, w: 150, h: 60 });
    await as(t.dupont).post(`${A(decision.id)}/envoi`);
    await runCircuit(decision.id);
    await as(t.martin).post(`${P(decision.id)}/retour`, { statut: 'refuse', motif: 'Pièce manquante' });
    expect((await as(t.dupont).get(A(decision.id))).body.statut).toBe('signature_refusee');
  });
});
