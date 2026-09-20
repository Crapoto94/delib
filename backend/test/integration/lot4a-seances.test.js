const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

const HUB_ELUS = [
  { externalId: 'h1', nom: 'Durif', prenom: 'Paul', email: 'paul.durif@ivry.test', telephone: null, role: 'Maire', delegation: null },
  { externalId: 'h2', nom: 'Lemaire', prenom: 'Inès', email: 'ines.lemaire@ivry.test', telephone: null, role: 'Adjointe', delegation: 'Finances' },
];
let env; let admin; let ville; let t; let typeDelib; let matiere; let rubrique; let instance;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

async function readyActe({ titre = 'Acte de test', seanceId, commissions = [] } = {}) {
  const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre })).body;
  await as(t.dupont).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubrique.id, incidenceFinanciere: false, rapporteurId: 1, ...(seanceId ? { seanceViseeId: seanceId } : {}) });
  const texts = (await as(t.dupont).get(`${A(a.id)}/textes`)).body.items;
  for (const x of texts) await as(t.dupont).put(`${A(a.id)}/textes/${x.id}`, { markdown: `Texte ${x.kind}.`, baseVersion: x.version });
  for (const c of commissions) await as(t.dupont).post(`${A(a.id)}/commissions`, { commissionId: c });
  return a;
}
const seance = async (date, extra = {}) => (await as(admin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: date, ...extra }));
const advance = async (id, stop) => {
  const who = { chef_service: 'durand', directeur: 'leroy', juridique: 'nouveau', dga: 'petit', dgs: 'boot', scc: 'martin' };
  for (let i = 0; i < 10; i++) {
    const v = (await as(t.dupont).get(`${A(id)}/circuit`)).body;
    if (v.currentStepKey === stop || !v.currentStepKey) return v;
    const r = await as(t[who[v.currentStepKey]]).post(`${A(id)}/validation`, {});
    if (r.status !== 200) throw new Error(`validation ${v.currentStepKey}: ${r.status} ${JSON.stringify(r.body)}`);
  }
};

beforeAll(async () => {
  env = await createTestEnv({ elus: HUB_ELUS });
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
  const groups = (await as(admin).get(`${base()}/groupes`)).body.items;
  const setMembers = (code, usernames) => as(admin).put(`${base()}/groupes/${groups.find((g) => g.code === code).id}/membres`, { usernames });
  await setMembers('financier', ['moreau']); await setMembers('juridique', ['nouveau']); await setMembers('scc', ['martin']);
  await as(admin).post(`${base()}/roles`, { username: 'martin', role: 'scc' });
  instance = (await as(admin).get(`${base()}/instances`)).body.items[0];
});
afterAll(async () => { await env.close(); });

describe('élus et groupes politiques', () => {
  it('synchronise le Hub sans écraser la surcouche locale, désactive les absents', async () => {
    const r = await as(admin).post(`${base()}/elus/synchronisation`);
    expect(r.body).toMatchObject({ created: 2, updated: 0, deactivated: 0 });
    // le Hub saisit le groupe politique dans la colonne « délégation » : l'élu est rattaché au groupe de ce nom (créé au besoin) ; sans délégation, aucun groupe
    expect(r.body).toMatchObject({ groupesCrees: 1, elusRattaches: 1 });
    const lem = (await as(admin).get(`${base()}/elus`)).body.items.find((e) => e.nom === 'Lemaire');
    expect(lem.groupe).toBe('Finances');
    expect((await as(admin).get(`${base()}/elus`)).body.items.find((e) => e.nom === 'Durif').groupe).toBeUndefined();
    const g = (await as(admin).post(`${base()}/groupes-politiques`, { nom: 'Majorité' })).body;
    const paul = (await as(admin).get(`${base()}/elus`)).body.items.find((e) => e.nom === 'Durif');
    expect((await as(admin).put(`${base()}/elus/${paul.id}`, { groupeId: g.id, mandatDebut: '2020-07-04' })).body.groupe).toBe('Majorité');
    expect((await as(admin).put(`${base()}/elus/${paul.id}`, { nom: 'Autre' })).status).toBe(409); // identité issue du Hub
    await as(admin).put(`${base()}/elus/${lem.id}`, { groupeId: g.id }); // choix local : la resynchronisation ne l'écrase jamais
    expect((await as(admin).post(`${base()}/elus/synchronisation`)).body).toMatchObject({ elusRattaches: 0, groupesCrees: 0 });
    expect((await as(admin).get(`${base()}/elus/${lem.id}`)).body.groupe).toBe('Majorité');
    HUB_ELUS.pop();
    const r2 = await as(admin).post(`${base()}/elus/synchronisation`);
    expect(r2.body).toMatchObject({ created: 0, deactivated: 1 });
    expect((await as(admin).get(`${base()}/elus/${paul.id}`)).body.groupe).toBe('Majorité');
  });

  it('saisie manuelle, groupe inconnu refusé, droits réservés', async () => {
    expect((await as(admin).post(`${base()}/elus`, { nom: 'Membre', prenom: 'Non élu', estElu: false })).status).toBe(201);
    expect((await as(admin).post(`${base()}/elus`, { nom: 'X', groupeId: 9999 })).status).toBe(400);
    expect((await as(t.dupont).post(`${base()}/elus`, { nom: 'Y' })).status).toBe(403);
    expect((await as(t.dupont).get(`${base()}/elus`)).status).toBe(200);
  });

  it('le rapporteur d\'un acte doit être un élu de l\'organisme', async () => {
    const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre: 'Rapporteur inconnu' })).body;
    expect((await as(t.dupont).put(A(a.id), { rapporteurId: 99999 })).status).toBe(400);
    expect((await as(t.dupont).put(A(a.id), { rapporteurId: 1 })).status).toBe(200);
  });
});

describe('séances et dates clés', () => {
  it('propose les dates clés depuis la date de séance (jours ouvrés)', async () => {
    const r = await seance('2027-03-11T18:30:00Z', { lieu: 'Salle du conseil' });
    expect(r.status).toBe(201);
    const s = r.body;
    expect(s.statut).toBe('planifiee');
    expect(new Date(s.dateLimiteRedaction).getTime()).toBeLessThan(new Date(s.dateLimiteDgs).getTime());
    expect(new Date(s.dateLimiteDgs).getTime()).toBeLessThan(new Date(s.dateLimiteMadCommissions).getTime());
    expect(new Date(s.dateLimiteMadCommissions).getTime()).toBeLessThan(new Date(s.dateLimiteRedaction).getTime() + 40 * 86400000);
    expect(s.jalons.map((j) => j.code)).toEqual(['redaction', 'dgs', 'mad_commissions', 'convocation', 'seance']);
    // 30 jours ouvrés avant le jeudi 11 mars 2027 = jeudi 28 janvier 2027 (fin de journée)
    expect(s.dateLimiteRedaction.slice(0, 10)).toBe('2027-01-28');
  });

  it('accepte une date limite saisie (fin de journée à Paris) et un jalon complémentaire', async () => {
    const r = await seance('2027-06-10T18:00:00Z', { dateLimiteRedaction: '2027-05-01', jalonsExtra: [{ code: 'bureau', label: 'Bureau municipal', date: '2027-05-20T09:00:00Z' }] });
    expect(r.body.dateLimiteRedaction).toBe('2027-05-01T21:59:00.000Z');
    expect(r.body.jalons.some((j) => j.code === 'bureau')).toBe(true);
  });

  it('réserve la création au SCC / administrateur, valide les transitions de statut', async () => {
    expect((await as(t.dupont).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: inDays(60) })).status).toBe(403);
    const s = (await seance(inDays(90))).body;
    expect((await as(t.martin).put(`${base()}/seances/${s.id}`, { statut: 'close' })).status).toBe(409);
    expect((await as(t.martin).put(`${base()}/seances/${s.id}`, { statut: 'convoquee' })).status).toBe(409); // ODJ pas arrêté
    expect((await as(t.martin).put(`${base()}/seances/${s.id}`, { lieu: 'Mairie annexe' })).body.lieu).toBe('Mairie annexe');
  });

  it('une séance terminée ou annulée ne peut plus être visée', async () => {
    const s = (await seance(inDays(120))).body;
    await as(admin).put(`${base()}/seances/${s.id}`, { statut: 'annulee' });
    const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre: 'Séance annulée' })).body;
    expect((await as(t.dupont).put(A(a.id), { seanceViseeId: s.id })).status).toBe(400);
    expect((await as(t.dupont).put(A(a.id), { seanceViseeId: 99999 })).status).toBe(400);
  });

  it('compte les actes en attente d\'affectation et historise la séance visée', async () => {
    const s = (await seance(inDays(150))).body;
    const a = await readyActe({ titre: 'Vise la séance', seanceId: s.id });
    expect((await as(t.dupont).get(`${base()}/seances/${s.id}`)).body.actesEnAttente).toBe(1);
    const h = (await as(t.dupont).get(`${A(a.id)}/seance-historique`)).body.items;
    expect(h[0]).toMatchObject({ kind: 'visee', to: s.id, actor: 'dupont' });
  });
});

describe('date limite de rédaction et dérogations', () => {
  let passee; let suivante;
  beforeAll(async () => {
    passee = (await seance(inDays(20), { dateLimiteRedaction: new Date(Date.now() - 86400000).toISOString() })).body;
    suivante = (await seance(inDays(50))).body;
  });

  it('bloque l\'envoi au circuit après la date limite, le brouillon reste enregistrable', async () => {
    const a = await readyActe({ titre: 'Trop tard', seanceId: passee.id });
    expect((await as(t.dupont).put(A(a.id), { titre: 'Trop tard (modifié)' })).status).toBe(200);
    const r = await as(t.dupont).post(`${A(a.id)}/envoi`);
    expect(r.status).toBe(423);
    expect(r.body.details).toMatchObject({ seanceId: passee.id, derogationPossible: true, seanceSuivanteId: expect.any(Number) });
  });

  it('liste l\'acte dans « hors délai » côté SCC uniquement', async () => {
    const l = await as(t.martin).get(`${base()}/seances/hors-delai`);
    expect(l.body.items.some((x) => x.titre.startsWith('Trop tard'))).toBe(true);
    expect((await as(t.dupont).get(`${base()}/seances/hors-delai`)).status).toBe(403);
  });

  it('demande, refus sans motif impossible, accord limité dans le temps puis blocage rétabli', async () => {
    const a = await readyActe({ titre: 'Dérogation', seanceId: passee.id });
    expect((await as(t.moreau).post(`${A(a.id)}/derogations`, { motif: 'Je veux passer' })).status).toBe(404); // ne voit pas l'acte
    const d = await as(t.dupont).post(`${A(a.id)}/derogations`, { motif: 'Dossier urgent pour le maire' });
    expect(d.status).toBe(201);
    expect((await as(t.dupont).post(`${A(a.id)}/derogations`, { motif: 'Deuxième demande' })).status).toBe(409);
    expect((await as(t.durand).post(`${base()}/derogations/${d.body.id}/decision`, { decision: 'accordee' })).status).toBe(403);
    expect((await as(t.martin).post(`${base()}/derogations/${d.body.id}/decision`, { decision: 'refusee' })).status).toBe(400);
    // notification aux décideurs
    const n = (await as(t.martin).get(`${base()}/notifications`)).body.items;
    expect(n.some((x) => x.title.includes('Dérogation demandée'))).toBe(true);
    const ok = await as(t.martin).post(`${base()}/derogations/${d.body.id}/decision`, { decision: 'accordee', valideJusquAu: inDays(2) });
    expect(ok.body.statut).toBe('accordee');
    expect((await as(t.dupont).get(`${base()}/notifications`)).body.items.some((x) => x.title.includes('Dérogation accordé'))).toBe(true);
    expect((await as(t.dupont).post(`${A(a.id)}/envoi`)).status).toBe(200);

    // limitée dans le temps : passé le délai, le blocage se réapplique
    const b = await readyActe({ titre: 'Dérogation expirée', seanceId: passee.id });
    const d2 = (await as(t.dupont).post(`${A(b.id)}/derogations`, { motif: 'Encore un dossier urgent' })).body;
    await as(t.martin).post(`${base()}/derogations/${d2.id}/decision`, { decision: 'accordee', valideJusquAu: inDays(1) });
    await env.db.query("UPDATE derogations SET valide_jusqu_au = now() - interval '1 minute' WHERE id = $1", [d2.id]);
    expect((await as(t.dupont).post(`${A(b.id)}/envoi`)).status).toBe(423);
  });

  it('le DGS peut aussi décider (rôles paramétrables), pas le SCC seul si retiré', async () => {
    const a = await readyActe({ titre: 'Décision DGS', seanceId: passee.id });
    const d = (await as(t.dupont).post(`${A(a.id)}/derogations`, { motif: 'Pour le DGS' })).body;
    await env.db.query("INSERT INTO settings (scope, scope_id, key, value, updated_by) VALUES ('organisme', $1, 'derogations.roles', '[\"dgs\"]'::jsonb, 't')", [String(ville.id)]);
    expect((await as(t.martin).post(`${base()}/derogations/${d.id}/decision`, { decision: 'accordee' })).status).toBe(403);
    expect((await as(admin).post(`${base()}/derogations/${d.id}/decision`, { decision: 'accordee' })).status).toBe(200); // admin plateforme
    await env.db.query("DELETE FROM settings WHERE key = 'derogations.roles'");
  });

  it('mode « alerter » : l\'envoi passe malgré la date limite dépassée', async () => {
    await env.db.query("INSERT INTO settings (scope, scope_id, key, value, updated_by) VALUES ('organisme', $1, 'seances.blocage_date_limite', '\"alerter\"'::jsonb, 't')", [String(ville.id)]);
    const a = await readyActe({ titre: 'Alerte seule', seanceId: passee.id });
    expect((await as(t.dupont).post(`${A(a.id)}/envoi`)).status).toBe(200);
    await env.db.query("DELETE FROM settings WHERE key = 'seances.blocage_date_limite'");
  });

  it('reporte l\'acte à la séance suivante avec trace, ensuite l\'envoi est possible', async () => {
    const a = await readyActe({ titre: 'À reporter', seanceId: passee.id });
    expect((await as(t.durand).post(`${A(a.id)}/report`, { motif: 'Pas mon rôle' })).status).toBe(403);
    const r = await as(t.dupont).post(`${A(a.id)}/report`, { motif: 'Date limite dépassée' });
    expect(r.body).toMatchObject({ from: passee.id, seanceViseeId: suivante.id });
    const h = (await as(t.dupont).get(`${A(a.id)}/seance-historique`)).body.items;
    expect(h.some((x) => x.kind === 'report' && x.motif === 'Date limite dépassée')).toBe(true);
    expect((await as(t.dupont).post(`${A(a.id)}/envoi`)).status).toBe(200);
  });

  it('un changement de date limite recalcule les relances (clé liée à la date)', async () => {
    const s = (await seance(inDays(60), { dateLimiteRedaction: inDays(40) })).body;
    const a = await readyActe({ titre: 'Relance date limite', seanceId: s.id });
    const N = env.c.notifications;
    const at = (n) => new Date(Date.now() + n * 86400000);
    const plan = async (when) => (await N.simulate(ville.id, { at: when.toISOString() })).items.filter((i) => i.acteId === a.id && i.rule === 'relance.date_limite');
    expect((await plan(at(0))).length).toBe(0);
    const j = await plan(at(28));
    expect(j.map((i) => i.rule)).toContain('relance.date_limite');
    expect(j.map((i) => i.recipient)).toEqual(expect.arrayContaining(['dupont']));
    await as(admin).put(`${base()}/seances/${s.id}`, { dateLimiteRedaction: '2030-01-01' });
    expect((await plan(at(28))).length).toBe(0);
  });
});

describe('commissions', () => {
  let com; let com2;
  it('crée une commission, ses membres (un président) et ses secrétaires', async () => {
    com = (await as(admin).post(`${base()}/commissions`, { nom: 'La Ville qui débat' })).body;
    expect((await as(admin).post(`${base()}/commissions`, { nom: 'La Ville qui débat' })).status).toBe(409);
    com2 = (await as(admin).post(`${base()}/commissions`, { nom: 'La Ville solidaire' })).body;
    const elus = (await as(admin).get(`${base()}/elus`)).body.items;
    expect((await as(admin).put(`${base()}/commissions/${com.id}/membres`, { membres: [{ eluId: elus[0].id, fonction: 'president' }, { eluId: elus[1].id, fonction: 'president' }] })).status).toBe(400);
    const r = await as(admin).put(`${base()}/commissions/${com.id}/membres`, { membres: [{ eluId: elus[0].id, fonction: 'president' }, { eluId: elus[1].id }] });
    expect(r.body.membres.map((m) => m.fonction)).toEqual(['president', 'membre']);
    expect((await as(admin).put(`${base()}/commissions/${com.id}/membres`, { membres: [{ eluId: 99999 }] })).status).toBe(400);
    const s = await as(admin).put(`${base()}/commissions/${com.id}/secretaires`, { usernames: ['Nouveau'] });
    expect(s.body.secretaires).toEqual(['nouveau']);
    expect((await as(t.dupont).post(`${base()}/commissions`, { nom: 'Interdit' })).status).toBe(403);
  });

  it('met à disposition à la validation DGS, prévient membres et secrétaires, puis avis', async () => {
    const a = await readyActe({ titre: 'Passe en commission', commissions: [com.id] });
    expect((await as(t.dupont).get(`${A(a.id)}/commissions`)).body.horsCommission).toBe(false);
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    await advance(a.id, 'scc');
    const mine = (await as(t.dupont).get(`${A(a.id)}/commissions`)).body.items[0];
    expect(mine.misADispositionAt).toBeTruthy();
    const log = await env.db.all("SELECT recipient FROM notification_log WHERE acte_id = $1 AND rule_code = 'commission.mise_a_disposition'", [a.id]);
    expect(log.map((l) => l.recipient).sort()).toEqual([expect.stringMatching(/^elu:/), expect.stringMatching(/^elu:/), 'nouveau'].sort());
    expect(log.some((l) => l.recipient.startsWith('elu:'))).toBe(true);
    // avis : secrétaire seulement
    expect((await as(t.dupont).put(`${A(a.id)}/commissions/${com.id}/avis`, { avis: 'favorable' })).status).toBe(403);
    const av = await as(t.nouveau).put(`${A(a.id)}/commissions/${com.id}/avis`, { avis: 'reserve', commentaire: 'Sous réserve du chiffrage', datePassage: '2027-02-02' });
    expect(av.body).toMatchObject({ avis: 'reserve', avisPar: 'nouveau' });
    expect((await as(t.dupont).get(`${base()}/notifications`)).body.items.some((n) => n.title.includes('Avis de commission'))).toBe(true);
  });

  it('avis impossible avant la mise à disposition ; retrait avec motif obligatoire ; « hors commission »', async () => {
    const a = await readyActe({ titre: 'Pas encore', commissions: [com.id] });
    expect((await as(admin).put(`${A(a.id)}/commissions/${com.id}/avis`, { avis: 'favorable' })).status).toBe(409);
    expect((await as(t.dupont).del(`${A(a.id)}/commissions/${com.id}`)).status).toBe(200); // pas encore mis à disposition : pas de motif
    expect((await as(t.dupont).get(`${A(a.id)}/commissions`)).body.horsCommission).toBe(true);
    expect((await as(t.dupont).post(`${A(a.id)}/commissions`, { commissionId: 9999 })).status).toBe(400);
  });

  it('suspend la mise à disposition au renvoi, la reprend à la nouvelle validation DGS, retrait motivé', async () => {
    const a = await readyActe({ titre: 'Suspendu puis repris', commissions: [com2.id] });
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    await advance(a.id, 'scc');
    expect((await as(t.dupont).get(`${A(a.id)}/commissions`)).body.items[0].misADispositionAt).toBeTruthy();
    await as(t.martin).post(`${A(a.id)}/refus`, { target: 'first', motif: 'Erreur dans le dispositif' });
    expect((await as(t.dupont).get(`${A(a.id)}/commissions`)).body.items[0].suspendue).toBe(true);
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    await advance(a.id, 'scc');
    expect((await as(t.dupont).get(`${A(a.id)}/commissions`)).body.items[0].suspendue).toBe(false);
    expect((await as(t.dupont).del(`${A(a.id)}/commissions/${com2.id}`)).status).toBe(403); // en circuit : le rédacteur ne modifie plus
    expect((await as(t.martin).del(`${A(a.id)}/commissions/${com2.id}`)).status).toBe(400); // motif requis
    expect((await as(t.martin).del(`${A(a.id)}/commissions/${com2.id}?motif=Sujet%20retir%C3%A9`)).status).toBe(200);
    const items = (await as(t.dupont).get(`${A(a.id)}/commissions`)).body;
    expect(items.horsCommission).toBe(true);
    expect(items.items[0].retireeMotif).toBe('Sujet retiré');
  });
});

describe('documentation', () => {
  it('expose élus, commissions, séances et dérogations dans Swagger', async () => {
    const paths = Object.keys((await env.http().get('/swagger.json')).body.paths);
    for (const p of ['/elus', '/commissions', '/seances', '/derogations', '/report']) expect(paths.some((x) => x.includes(p))).toBe(true);
  });
});
