const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubrique;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;

/** Acte complet, prêt à l'envoi (fiche + textes). */
async function readyActe({ financier = false, tok = t.dupont } = {}) {
  const a = (await as(tok).post(`${base()}/actes`, { typeId: typeDelib.id, titre: 'Subvention à l\'association Les Amis du Sport' })).body;
  await as(tok).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubrique.id, incidenceFinanciere: financier, rapporteurId: 1 });
  const texts = (await as(tok).get(`${A(a.id)}/textes`)).body.items;
  for (const x of texts) await as(tok).put(`${A(a.id)}/textes/${x.id}`, { markdown: `Texte ${x.kind} de l'acte.`, baseVersion: x.version });
  return a;
}
const steps = (v) => v.path.filter((p) => p.state !== 'skipped').map((p) => p.key);
const cur = async (id, tok = t.dupont) => (await as(tok).get(`${A(id)}/circuit`)).body;
const canValidate = async (id, tok) => (await as(tok).get(`${A(id)}/circuit`)).body.actions?.validate ?? false;
const validate = (tok, id, comment) => as(tok).post(`${A(id)}/validation`, comment ? { comment } : {});
/** Fait avancer l'acte jusqu'à l'étape voulue (chaque titulaire valide à son tour). */
const WHO = { resp_intermediaire: 'dupont', chef_service: 'durand', directeur: 'leroy', financier: 'moreau', juridique: 'nouveau', dga: 'petit', dgs: 'boot', scc: 'martin' };
async function advanceTo(id, key) {
  for (let i = 0; i < 12; i++) {
    const v = await cur(id);
    if (v.currentStepKey === key) return v;
    const r = await validate(t[WHO[v.currentStepKey]], id);
    if (r.status !== 200) throw new Error(`avance impossible à ${v.currentStepKey}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  throw new Error('trop d\'étapes');
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
  const tit = (fonction, username, extra = {}) => as(admin).post(`${base()}/titulaires`, { fonction, username, ...extra });
  await tit('chef_service', 'durand', { directionCode: 'A1', serviceCode: 'A1a' });
  await tit('directeur', 'leroy', { directionCode: 'A1' });
  await tit('dga', 'petit', { directionCode: 'A1' });
  await tit('dgs', 'boot');
  // le circuit standard référence les groupes financier / juridique / scc (créés à l'amorçage)
  const groups = (await as(admin).get(`${base()}/groupes`)).body.items;
  const setMembers = (code, usernames) => as(admin).put(`${base()}/groupes/${groups.find((g) => g.code === code).id}/membres`, { usernames });
  await setMembers('financier', ['moreau']);
  await setMembers('juridique', ['nouveau']);
  await setMembers('scc', ['martin']);
  await as(admin).post(`${base()}/roles`, { username: 'martin', role: 'scc' });
});
afterAll(async () => { await env.close(); });

describe('circuits par défaut et éditeur', () => {
  it('amorce le circuit Ivry publié pour l\'organisme, et les groupes', async () => {
    const list = (await as(t.dupont).get(`${base()}/circuits`)).body.items;
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toMatchObject({ code: 'ivry-standard' });
    const ids = (await as(admin).get(`${base()}/groupes`)).body.items.map((g) => g.code);
    expect(ids).toEqual(expect.arrayContaining(['financier', 'juridique', 'scc']));
  });

  it('propose des modèles', async () => {
    const r = await as(t.dupont).get(`${base()}/circuits/modeles`);
    expect(r.body.items.map((m) => m.code)).toEqual(expect.arrayContaining(['ivry-standard', 'simple']));
  });

  it('réserve la modification à l\'administrateur et au SCC', async () => {
    const r = await as(t.dupont).post(`${base()}/circuits`, { code: 'perso', nom: 'Perso', fromTemplate: 'simple' });
    expect(r.status).toBe(403);
  });
});

describe('parcours nominal', () => {
  it('sans incidence financière : la branche financière est ignorée et les étapes sans titulaire optionnelles sont sautées', async () => {
    const a = await readyActe({ financier: false });
    const v = await as(t.dupont).post(`${A(a.id)}/envoi`);
    expect(v.status).toBe(200);
    expect(v.body.statut).toBe('en_circuit');
    // dupont est rédacteur ET responsable de son service : chef_service = durand ; resp_intermediaire n'a pas de titulaire → sauté
    expect(v.body.currentStepKey).toBe('chef_service');
    expect(steps(v.body)).not.toContain('financier');
    expect(steps(v.body)).toEqual(expect.arrayContaining(['redaction', 'chef_service', 'directeur', 'juridique', 'dga', 'dgs', 'scc']));
    for (const k of ['chef_service', 'directeur', 'juridique', 'dga', 'dgs']) await advanceTo(a.id, k);
    const fin = await advanceTo(a.id, 'scc');
    expect(fin.statut).toBe('en_attente_scc');
    const last = await validate(t.martin, a.id);
    expect(last.status).toBe(200);
    const done = await cur(a.id);
    expect(done.currentStepKey).toBeNull();
  });

  it('avec incidence financière : passe par le service financier', async () => {
    const a = await readyActe({ financier: true });
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    const v = await advanceTo(a.id, 'financier');
    expect(v.path.some((p) => p.key === 'financier' && p.state === 'current')).toBe(true);
    expect(steps(v)).toContain('financier');
  });

  it('valide le statut « validé DGS » à la sortie de l\'étape DGS', async () => {
    const a = await readyActe();
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    await advanceTo(a.id, 'scc');
    expect((await as(t.dupont).get(A(a.id))).body.statut).toBe('en_attente_scc');
  });

  it('démarre le suivi des modifications à l\'envoi', async () => {
    const a = await readyActe();
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    const texts = (await as(t.dupont).get(`${A(a.id)}/textes`)).body.items;
    expect(texts.every((x) => x.tracking === true)).toBe(true);
  });

  it('tout le circuit voit l\'acte dès l\'envoi', async () => {
    const a = await readyActe();
    expect((await as(t.moreau).get(A(a.id))).status).toBe(404); // brouillon : invisible hors service
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    expect((await as(t.leroy).get(A(a.id))).status).toBe(200);
    expect((await as(t.petit).get(A(a.id))).status).toBe(200);
    expect((await as(t.nouveau).get(A(a.id))).status).toBe(200);
  });
});

describe('contrôles à l\'envoi', () => {
  it('refuse un dossier incomplet (422 avec la liste)', async () => {
    const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre: 'Incomplet' })).body;
    const r = await as(t.dupont).post(`${A(a.id)}/envoi`);
    expect(r.status).toBe(422);
    expect(r.body.details.length || r.body.details.missing?.length).toBeGreaterThan(0);
  });

  it('seul le rédacteur envoie', async () => {
    const a = await readyActe();
    expect((await as(t.durand).post(`${A(a.id)}/envoi`)).status).toBe(403);
  });

  it('refuse l\'envoi si une étape obligatoire n\'a pas de titulaire (409)', async () => {
    const a = await readyActe({ tok: t.martin }); // martin : service AIDE SOCIALE / direction J, aucun titulaire
    const r = await as(t.martin).post(`${A(a.id)}/envoi`);
    expect(r.status).toBe(409);
    expect(r.body.details.steps.length).toBeGreaterThan(0);
  });

  it('un acte déjà envoyé ne peut pas l\'être deux fois', async () => {
    const a = await readyActe();
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    expect((await as(t.dupont).post(`${A(a.id)}/envoi`)).status).toBe(409);
  });
});

describe('validation', () => {
  it('seul le détenteur de l\'étape valide', async () => {
    const a = await readyActe();
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    expect((await validate(t.leroy, a.id)).status).toBe(403);
    expect((await validate(t.dupont, a.id)).status).toBe(403); // le rédacteur ne valide pas sa propre étape
    const r = await validate(t.durand, a.id, 'Vu, OK');
    expect(r.status).toBe(200);
    expect(r.body.currentStepKey).toBe('directeur');
    const c = (await as(t.dupont).get(`${A(a.id)}/commentaires`)).body;
    expect(JSON.stringify(c)).toContain('Vu, OK');
  });

  it('historise chaque transition', async () => {
    const a = await readyActe();
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    await validate(t.durand, a.id);
    const v = await cur(a.id);
    expect(v.events.map((e) => e.action)).toEqual(expect.arrayContaining(['submit', 'enter', 'validate']));
  });

  it('valide par lot sans que l\'échec de l\'un arrête les autres', async () => {
    const a1 = await readyActe(); const a2 = await readyActe();
    await as(t.dupont).post(`${A(a1.id)}/envoi`); await as(t.dupont).post(`${A(a2.id)}/envoi`);
    const r = await as(t.durand).post(`${base()}/circuit/lot/validation`, { ids: [a1.id, 999999, a2.id] });
    expect(r.body.validated).toBe(2);
    expect(r.body.results[1].ok).toBe(false);
  });

  it('liste ma file de travail', async () => {
    const a = await readyActe();
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    const r = await as(t.durand).get(`${base()}/circuit/a-traiter`);
    expect(r.body.items.map((i) => i.acte.id)).toContain(a.id);
    expect((await as(t.moreau).get(`${base()}/circuit/a-traiter`)).body.items.map((i) => i.acte.id)).not.toContain(a.id);
  });
});

describe('refus', () => {
  it('« previous » renvoie à l\'étape réellement traversée, motif obligatoire', async () => {
    const a = await readyActe();
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    await advanceTo(a.id, 'directeur');
    expect((await as(t.leroy).post(`${A(a.id)}/refus`, { target: 'previous' })).status).toBe(400);
    const r = await as(t.leroy).post(`${A(a.id)}/refus`, { target: 'previous', resume: 'direct', motif: 'Précisez le montant' });
    expect(r.status).toBe(200);
    expect(r.body.statut).toBe('modification_demandee');
    expect(r.body.currentStepKey).toBe('chef_service');
    expect(r.body.resume).toMatchObject({ step: 'directeur' });
  });

  it('« previous » tient compte de la branche empruntée (financier)', async () => {
    const a = await readyActe({ financier: true });
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    await advanceTo(a.id, 'juridique');
    const r = await as(t.nouveau).post(`${A(a.id)}/refus`, { target: 'previous', motif: 'À revoir côté finances' });
    expect(r.body.currentStepKey).toBe('financier');
  });

  it('« first » renvoie au rédacteur, qui renvoie au circuit ; reprise directe → retour au refuseur', async () => {
    const a = await readyActe();
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    await advanceTo(a.id, 'dga');
    const r = await as(t.petit).post(`${A(a.id)}/refus`, { target: 'first', resume: 'direct', motif: 'Refonte du dispositif' });
    expect(r.body.currentStepKey).toBe('redaction');
    expect((await as(t.dupont).get(`${base()}/circuit/a-traiter`)).body.items.map((i) => i.acte.id)).toContain(a.id);
    const back = await as(t.dupont).post(`${A(a.id)}/envoi`);
    expect(back.status).toBe(200);
    expect(back.body.currentStepKey).toBe('dga');
    expect(back.body.statut).toBe('en_circuit');
  });

  it('reprise complète : repasse par toutes les étapes', async () => {
    const a = await readyActe();
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    await advanceTo(a.id, 'dga');
    await as(t.petit).post(`${A(a.id)}/refus`, { target: 'first', resume: 'complet', motif: 'Tout reprendre' });
    const back = await as(t.dupont).post(`${A(a.id)}/envoi`);
    expect(back.body.currentStepKey).toBe('chef_service');
  });

  it('cible libre : n\'importe quelle étape antérieure', async () => {
    const a = await readyActe();
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    await advanceTo(a.id, 'dga');
    expect((await as(t.petit).post(`${A(a.id)}/refus`, { target: 'dgs', motif: 'Étape postérieure' })).status).toBe(400);
    const r = await as(t.petit).post(`${A(a.id)}/refus`, { target: 'directeur', motif: 'Directeur : à revoir' });
    expect(r.body.currentStepKey).toBe('directeur');
  });

  it('enregistre le motif dans la discussion', async () => {
    const a = await readyActe();
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    await as(t.durand).post(`${A(a.id)}/refus`, { target: 'first', motif: 'Motif du refus test' });
    expect(JSON.stringify((await as(t.dupont).get(`${A(a.id)}/commentaires`)).body)).toContain('Motif du refus test');
  });

  it('un tiers ne peut pas refuser', async () => {
    const a = await readyActe();
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    expect((await as(t.leroy).post(`${A(a.id)}/refus`, { target: 'first', motif: 'Pas mon tour' })).status).toBe(403);
  });
});

describe('délégations', () => {
  it('co-détention : le délégué agit, le délégant garde ses droits', async () => {
    const a = await readyActe();
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    const d = await as(t.durand).post(`${base()}/delegations`, { delegue: 'leroy', scope: 'all' });
    expect(d.status).toBe(201);
    const v = await cur(a.id, t.leroy);
    expect(v.actions.validate).toBe(true);
    expect(v.actions.onBehalfOf).toBe('durand');
    expect((await validate(t.leroy, a.id)).status).toBe(200);
    expect((await cur(a.id)).events.find((e) => e.action === 'validate').onBehalfOf).toBe('durand');
    await as(t.durand).del(`${base()}/delegations/${d.body.id}`);
  });

  it('ne délègue pas au rédacteur de l\'acte, ni en cycle, ni en sous-délégation', async () => {
    expect((await as(t.durand).post(`${base()}/delegations`, { delegue: 'durand', scope: 'all' })).status).toBe(400);
    const d1 = await as(t.durand).post(`${base()}/delegations`, { delegue: 'leroy', scope: 'all' });
    expect((await as(t.leroy).post(`${base()}/delegations`, { delegue: 'durand', scope: 'all' })).status).toBe(409);
    await as(t.durand).del(`${base()}/delegations/${d1.body.id}`);
    const a = await readyActe();
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    const dd = await as(t.durand).post(`${base()}/delegations`, { delegue: 'moreau', scope: 'all' });
    // moreau n'est pas détenteur : il ne peut pas re-déléguer ce qu'il a reçu
    const sub = await as(t.moreau).post(`${base()}/delegations`, { delegue: 'nouveau', scope: 'all' });
    if (sub.status === 201) expect((await validate(t.nouveau, a.id)).status).toBe(403);
    await as(t.durand).del(`${base()}/delegations/${dd.body.id}`);
  });

  it('le DGS ne délègue pas (étape non déléguable)', async () => {
    const a = await readyActe();
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    await advanceTo(a.id, 'dgs');
    const d = await as(t.admin ?? admin).post(`${base()}/delegations`, { delegue: 'moreau', scope: 'all' });
    expect([201, 400, 409]).toContain(d.status);
    expect((await validate(t.moreau, a.id)).status).toBe(403);
    await as(admin).del(`${base()}/delegations/${d.body.id}`);
  });

  it('délègue un acte précis, révocation immédiate', async () => {
    const a = await readyActe();
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    const d = await as(t.durand).post(`${A(a.id)}/deleguer`, { delegue: 'moreau' });
    expect(d.status).toBe(201);
    expect(await canValidate(a.id, t.moreau)).toBe(true);
    await as(t.durand).del(`${base()}/delegations/${d.body.id}`);
    expect(await canValidate(a.id, t.moreau)).toBe(false);
  });

  it('une délégation expirée ne donne plus aucun droit', async () => {
    const a = await readyActe();
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    const d = await as(t.durand).post(`${base()}/delegations`, { delegue: 'moreau', scope: 'all', startsAt: '2020-01-01T00:00:00Z', endsAt: '2020-02-01T00:00:00Z' });
    expect([201, 400]).toContain(d.status);
    expect(await canValidate(a.id, t.moreau)).toBe(false);
  });
});

describe('recalcul et étapes ponctuelles', () => {
  it('changer l\'incidence financière en cours de circuit ajoute l\'étape financière', async () => {
    const a = await readyActe({ financier: false });
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    const before = await cur(a.id);
    expect(steps(before)).not.toContain('financier');
    // un valideur éditant l'acte (étape éditable) modifie le champ pilote
    await as(t.durand).put(A(a.id), { incidenceFinanciere: true });
    const after = await cur(a.id);
    expect(steps(after)).toContain('financier');
  });

  it('ajoute une étape ponctuelle réservée à l\'administrateur, au SCC ou au DGS', async () => {
    const a = await readyActe();
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    const body = { afterKey: 'directeur', label: 'Avis complémentaire', motif: 'Avis du juriste', resolver: { kind: 'agent', username: 'moreau' } };
    expect((await as(t.durand).post(`${A(a.id)}/circuit/etape`, body)).status).toBe(403);
    const r = await as(admin).post(`${A(a.id)}/circuit/etape`, body);
    expect(r.status).toBe(200);
    expect(steps(r.body)).toContain('adhoc_1');
    await advanceTo(a.id, 'directeur');
    const v = await validate(t.leroy, a.id);
    expect(v.body.currentStepKey).toBe('adhoc_1');
  });

  it('réaffecte les détenteurs d\'une étape (administrateur)', async () => {
    const a = await readyActe();
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    expect((await as(t.dupont).post(`${A(a.id)}/reaffectation`, { holders: ['moreau'], motif: 'Absence' })).status).toBe(403);
    const r = await as(admin).post(`${A(a.id)}/reaffectation`, { holders: ['moreau'], motif: 'Départ en congés' });
    expect(r.status).toBe(200);
    expect((await validate(t.moreau, a.id)).status).toBe(200);
  });
});

describe('éditeur de circuit', () => {
  let circuit;
  it('crée un circuit depuis un modèle, le contrôle, le simule puis le publie', async () => {
    const c = await as(t.martin).post(`${base()}/circuits`, { code: 'court', nom: 'Circuit court', fromTemplate: 'simple', directionCode: 'J' });
    expect(c.status).toBe(201);
    circuit = c.body;
    const ver = circuit.versions[0];
    expect(ver.status).toBe('draft');
    const chk = await as(t.martin).post(`${base()}/circuits/${circuit.id}/versions/${ver.version}/controle`);
    expect(chk.body.ok).toBe(true);
    const sim = await as(t.martin).post(`${base()}/circuits/${circuit.id}/versions/${ver.version}/simulation`, { directionCode: 'A1', serviceCode: 'A1a', redacteur: 'dupont' });
    expect(sim.body.path.map((p) => p.key)).toEqual(['redaction', 'chef_service', 'directeur', 'scc']);
    const pub = await as(t.martin).post(`${base()}/circuits/${circuit.id}/versions/${ver.version}/publication`, { comment: 'Première version' });
    expect(pub.status).toBe(200);
  });

  it('le circuit propre à une direction est prioritaire', async () => {
    const sel = await env.c.engine.selectCircuit(ville.id, typeDelib.id, 'J');
    expect(sel.code).toBe('court');
    const other = await env.c.engine.selectCircuit(ville.id, typeDelib.id, 'A1');
    expect(other.code).toBe('ivry-standard');
  });

  it('refuse la publication d\'un graphe invalide', async () => {
    const v2 = (await as(t.martin).post(`${base()}/circuits/${circuit.id}/versions`, {})).body;
    const g = (await as(t.martin).get(`${base()}/circuits/${circuit.id}/versions/${v2.version}`)).body.graph;
    g.transitions.push({ from: 'scc', to: 'redaction' }); // boucle
    await as(t.martin).put(`${base()}/circuits/${circuit.id}/versions/${v2.version}`, g);
    const chk = await as(t.martin).post(`${base()}/circuits/${circuit.id}/versions/${v2.version}/controle`);
    expect(chk.body.ok).toBe(false);
    expect((await as(t.martin).post(`${base()}/circuits/${circuit.id}/versions/${v2.version}/publication`, {})).status).toBe(409);
  });

  it('versionne, compare et exporte / importe', async () => {
    const v2 = (await as(t.martin).post(`${base()}/circuits/${circuit.id}/versions`, { fromVersion: 1 })).body;
    const g = (await as(t.martin).get(`${base()}/circuits/${circuit.id}/versions/${v2.version}`)).body.graph;
    g.steps.find((s) => s.key === 'chef_service').slaDays = 10;
    await as(t.martin).put(`${base()}/circuits/${circuit.id}/versions/${v2.version}`, g);
    const cmp = await as(t.martin).get(`${base()}/circuits/${circuit.id}/comparaison?a=1&b=${v2.version}`);
    expect(JSON.stringify(cmp.body)).toContain('chef_service');
    const exp = (await as(t.martin).get(`${base()}/circuits/${circuit.id}/export`)).body;
    expect(exp.format).toBe('ivrydelib.circuit/1');
    const imp = await as(t.martin).post(`${base()}/circuits/import`, { ...exp, code: 'copie', nom: 'Copie' });
    expect(imp.status).toBe(201);
  });

  it('publier avec « migrer » fait passer les actes en cours à la nouvelle version', async () => {
    const a = await readyActe();
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    const std = (await as(t.dupont).get(`${base()}/circuits`)).body.items.find((c) => c.code === 'ivry-standard');
    const nv = (await as(admin).post(`${base()}/circuits/${std.id}/versions`, {})).body;
    const g = (await as(admin).get(`${base()}/circuits/${std.id}/versions/${nv.version}`)).body.graph;
    g.steps.find((s) => s.key === 'directeur').label = 'Directeur / Directrice';
    await as(admin).put(`${base()}/circuits/${std.id}/versions/${nv.version}`, g);
    const pub = await as(admin).post(`${base()}/circuits/${std.id}/versions/${nv.version}/publication`, { effect: 'migrer' });
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    const row = await env.db.get('SELECT circuit_version_id FROM actes WHERE id = $1', [a.id]);
    const ver = await env.db.get('SELECT version_no FROM circuit_versions WHERE id = $1', [row.circuit_version_id]);
    expect(ver.version_no).toBe(nv.version);
  });
});

describe('documentation', () => {
  it('expose les routes du circuit dans Swagger', async () => {
    const r = await env.http().get('/swagger.json');
    const paths = Object.keys(r.body.paths || {});
    expect(paths.some((p) => p.includes('/circuits'))).toBe(true);
    expect(paths.some((p) => p.includes('/validation'))).toBe(true);
    expect(paths.some((p) => p.includes('/delegations'))).toBe(true);
  });
});
