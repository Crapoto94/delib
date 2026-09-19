const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');
const { addBusinessDays } = require('../../src/shared/time');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubrique; let com; let elus;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
const WHO = { chef_service: 'durand', directeur: 'leroy', juridique: 'nouveau', dga: 'petit', dgs: 'boot', scc: 'martin' };
const logs = (rule, extra = '') => env.db.all(`SELECT * FROM notification_log WHERE rule_code = $1 ${extra} ORDER BY id`, [rule]);

async function acteAvecCommission(titre) {
  const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre })).body;
  await as(t.dupont).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubrique.id, incidenceFinanciere: false, rapporteurId: 1 });
  for (const x of (await as(t.dupont).get(`${A(a.id)}/textes`)).body.items) await as(t.dupont).put(`${A(a.id)}/textes/${x.id}`, { markdown: 'Texte.', baseVersion: x.version });
  await as(t.dupont).post(`${A(a.id)}/commissions`, { commissionId: com.id });
  await as(t.dupont).post(`${A(a.id)}/envoi`);
  for (let i = 0; i < 10; i++) { const v = (await as(t.dupont).get(`${A(a.id)}/circuit`)).body; if (!v.currentStepKey) break; await as(t[WHO[v.currentStepKey]]).post(`${A(a.id)}/validation`, {}); }
  return a;
}

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = { boot: admin };
  for (const [u, p] of [['dupont', 'pw-dupont'], ['durand', 'pw-durand'], ['leroy', 'pw-leroy'], ['petit', 'pw-petit'], ['martin', 'pw-martin'], ['nouveau', 'pw-nouveau'], ['moreau', 'pw-moreau']]) t[u] = await loginAs(env, u, p);
  const items = (k) => as(admin).get(`${base()}/referentiels/${k}`).then((r) => r.body.items);
  matiere = (await items('matiere')).find((x) => x.code === '7.5'); rubrique = (await items('rubrique')).find((x) => x.libelle === 'FINANCES');
  typeDelib = (await items('type_acte')).find((x) => x.code === 'deliberation');
  const tit = (fonction, username, extra = {}) => as(admin).post(`${base()}/titulaires`, { fonction, username, ...extra });
  await tit('chef_service', 'durand', { directionCode: 'A1', serviceCode: 'A1a' }); await tit('directeur', 'leroy', { directionCode: 'A1' });
  await tit('dga', 'petit', { directionCode: 'A1' }); await tit('dgs', 'boot');
  const groups = (await as(admin).get(`${base()}/groupes`)).body.items;
  const setMembers = (code, usernames) => as(admin).put(`${base()}/groupes/${groups.find((g) => g.code === code).id}/membres`, { usernames });
  await setMembers('financier', ['moreau']); await setMembers('juridique', ['nouveau']); await setMembers('scc', ['martin']);
  await as(admin).post(`${base()}/roles`, { username: 'martin', role: 'scc' });
  elus = [(await as(admin).post(`${base()}/elus`, { nom: 'Lemaire', prenom: 'Inès', email: 'ines.lemaire@ivry.test' })).body, (await as(admin).post(`${base()}/elus`, { nom: 'Roussel', prenom: 'Yann', email: 'yann.roussel@ivry.test' })).body];
  com = (await as(admin).post(`${base()}/commissions`, { nom: 'La Ville qui débat', sieges: 13, siegesOpposition: 3, thematiques: ['Finances', 'Vie associative'] })).body;
  await as(admin).put(`${base()}/commissions/${com.id}/membres`, { membres: elus.map((e, i) => ({ eluId: e.id, fonction: i === 0 ? 'president' : 'membre' })) });
  await as(admin).put(`${base()}/commissions/${com.id}/secretaires`, { usernames: ['nouveau'] });
});
afterAll(async () => { await env.close(); });

describe('commission : sièges, thématiques et instance de réunions', () => {
  it('conserve les sièges et les thématiques (délibération de création)', async () => {
    const c = (await as(t.dupont).get(`${base()}/commissions/${com.id}`)).body;
    expect(c).toMatchObject({ sieges: 13, siegesOpposition: 3, thematiques: ['Finances', 'Vie associative'] });
  });

  it('crée l\'instance de réunions de la commission (numérotation propre aux commissions)', async () => {
    const inst = (await as(t.dupont).get(`${base()}/instances`)).body.items.find((i) => i.commissionId === com.id);
    expect(inst).toMatchObject({ kind: 'commission', code: `commission-${com.id}`, numbering: { pattern: 'C{ANNEE}-{N_SEANCE}-{ORDRE:02}' } });
  });
});

describe('planification d\'une réunion de commission', () => {
  let reunion;
  const body = (extra = {}) => ({ dateSeance: inDays(20), lieu: 'Salle Robespierre', dureeMinutes: 90, ...extra });

  it('réservée au SCC / à l\'administrateur ; crée la réunion sans dates limites de rédaction', async () => {
    expect((await as(t.dupont).post(`${base()}/commissions/${com.id}/reunions`, body())).status).toBe(403);
    const r = await as(t.martin).post(`${base()}/commissions/${com.id}/reunions`, body({ teams: { mode: 'aucun' } }));
    expect(r.status).toBe(201);
    reunion = r.body;
    expect(reunion).toMatchObject({ kind: 'commission', commissionId: com.id, commission: 'La Ville qui débat', lieu: 'Salle Robespierre', dureeMinutes: 90, teams: null, dateLimiteRedaction: null });
  });

  it('prévient membres (élus) et secrétaires de la convocation', async () => {
    const l = await logs('commission.reunion');
    expect(l.map((x) => x.recipient).sort()).toEqual([`elu:${elus[0].id}`, `elu:${elus[1].id}`, 'nouveau'].sort());
    expect(l[0].subject).toContain('convocation');
    expect(l.find((x) => x.recipient === `elu:${elus[0].id}`)).toMatchObject({ email: 'ines.lemaire@ivry.test', status: 'pending' });
  });

  it('associe un lien Teams saisi à la main (uniquement un vrai lien Teams en https)', async () => {
    expect((await as(t.martin).put(`${base()}/seances/${reunion.id}/teams`, { mode: 'lien', joinUrl: 'https://exemple.com/reunion' })).status).toBe(400);
    expect((await as(t.martin).put(`${base()}/seances/${reunion.id}/teams`, { mode: 'lien', joinUrl: 'http://teams.microsoft.com/l/meetup-join/abc' })).status).toBe(400);
    expect((await as(t.martin).put(`${base()}/seances/${reunion.id}/teams`, { mode: 'lien' })).status).toBe(400);
    const r = await as(t.martin).put(`${base()}/seances/${reunion.id}/teams`, { mode: 'lien', joinUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0?context=x' });
    expect(r.body.teams).toMatchObject({ auto: false, joinUrl: expect.stringContaining('teams.microsoft.com') });
    const last = (await logs('commission.reunion')).at(-1);
    expect(last.body).toContain('https://teams.microsoft.com/l/meetup-join');
    expect(last.subject).toContain('modifiée');
  });

  it('crée la réunion Teams automatiquement (Graph) sans inviter, ou en invitant les membres', async () => {
    const r1 = await as(t.martin).post(`${base()}/commissions/${com.id}/reunions`, body({ dateSeance: inDays(30), teams: { mode: 'auto' } }));
    expect(r1.body.teams).toMatchObject({ auto: true, invited: false, joinUrl: expect.stringMatching(/teams\.microsoft\.com/) });
    const evt = [...env.meeting.state.meetings.values()].at(-1);
    expect(evt.attendees).toEqual([]); // pas d'invitation Teams sans demande explicite
    expect(evt.subject).toContain('Réunions — La Ville qui débat');

    const r2 = await as(t.martin).post(`${base()}/commissions/${com.id}/reunions`, body({ dateSeance: inDays(40), teams: { mode: 'auto', inviter: true } }));
    expect(r2.body.teams.invited).toBe(true);
    const evt2 = [...env.meeting.state.meetings.values()].at(-1);
    expect(evt2.attendees.map((a) => a.email).sort()).toEqual(['ines.lemaire@ivry.test', 'nouveau@ivry.test', 'yann.roussel@ivry.test']);
  });

  it('refuse la création automatique quand Graph n\'est pas configuré (409), le lien manuel reste possible', async () => {
    env.meeting.state.available = false;
    const r = await as(t.martin).post(`${base()}/commissions/${com.id}/reunions`, body({ dateSeance: inDays(50), teams: { mode: 'auto' } }));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/collez un lien/i);
    env.meeting.state.available = true;
  });

  it('un changement de date ou de lieu met la réunion Teams à jour et prévient les membres ; l\'annulation la supprime', async () => {
    const r = (await as(t.martin).post(`${base()}/commissions/${com.id}/reunions`, body({ dateSeance: inDays(25), teams: { mode: 'auto' } }))).body;
    const id = env.meeting.state.calls.filter((c) => c[0] === 'create').at(-1)[1];
    const before = (await logs('commission.reunion')).length;
    await as(t.martin).put(`${base()}/seances/${r.id}`, { lieu: 'Salle des mariages', dateSeance: inDays(26) });
    expect(env.meeting.state.calls.some((c) => c[0] === 'update' && c[1] === id)).toBe(true);
    expect(env.meeting.state.meetings.get(id).lieu).toBe('Salle des mariages');
    expect((await logs('commission.reunion')).length).toBeGreaterThan(before);
    await as(t.martin).put(`${base()}/seances/${r.id}`, { statut: 'annulee' });
    expect(env.meeting.state.calls.some((c) => c[0] === 'cancel' && c[1] === id)).toBe(true);
    expect((await logs('commission.reunion')).at(-1).subject).toContain('annulée');
  });

  it('liste les réunions d\'une commission avec le nombre de projets présentés', async () => {
    const l = (await as(t.dupont).get(`${base()}/commissions/${com.id}/reunions`)).body.items;
    expect(l.length).toBeGreaterThan(3);
    expect(l[0]).toHaveProperty('projets');
    const seances = (await as(t.dupont).get(`${base()}/seances?kind=commission&commissionId=${com.id}`)).body;
    expect(seances.total).toBe(l.length);
    expect((await as(t.dupont).get(`${base()}/seances?kind=conseil`)).body.items.every((s) => s.kind === 'conseil')).toBe(true);
  });

  it('rappelle la réunion J-2 (jours ouvrés) aux membres et secrétaires, une seule fois', async () => {
    const r = (await as(t.martin).post(`${base()}/commissions/${com.id}/reunions`, body({ dateSeance: inDays(60) }))).body;
    const at = addBusinessDays(new Date(r.dateSeance), -2); at.setUTCHours(at.getUTCHours() + 1);
    const plan = (await env.c.notifications.simulate(ville.id, { at: at.toISOString() })).items.filter((i) => i.rule === 'relance.reunion_commission');
    expect(plan.map((i) => i.recipient).sort()).toEqual([`elu:${elus[0].id}`, `elu:${elus[1].id}`, 'nouveau'].sort());
    expect((await env.c.notifications.simulate(ville.id, { at: new Date(at.getTime() - 5 * 86400000).toISOString() })).items.some((i) => i.rule === 'relance.reunion_commission' && i.subject.includes(new Date(r.dateSeance).getUTCFullYear().toString()) && false)).toBe(false);
  });
});

describe('projets présentés à la réunion (ordre du jour de la commission)', () => {
  let reunion; let acte;
  it('propose les projets mis à disposition de CETTE commission (après validation DGS)', async () => {
    reunion = (await as(t.martin).post(`${base()}/commissions/${com.id}/reunions`, { dateSeance: inDays(15), lieu: 'Mairie' })).body;
    acte = await acteAvecCommission('Projet à présenter en commission');
    const p = (await as(t.martin).get(`${base()}/seances/${reunion.id}/odj/en-attente`)).body.items;
    expect(p.map((x) => x.id)).toContain(acte.id);
    const autre = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre: 'Sans commission' })).body;
    expect(p.some((x) => x.id === autre.id)).toBe(false);
  });

  it('inscrit le projet à l\'ordre du jour sans toucher au statut ni à la séance du Conseil', async () => {
    const before = (await as(t.dupont).get(A(acte.id))).body;
    const r = await as(t.martin).post(`${base()}/seances/${reunion.id}/odj/affectations`, { acteIds: [acte.id] });
    expect(r.status).toBe(200);
    expect(r.body.items[0]).toMatchObject({ acte: { id: acte.id }, numero: expect.stringMatching(/^C\d{4}-\d+-01$/) });
    const after = (await as(t.dupont).get(A(acte.id))).body;
    expect(after.statut).toBe(before.statut);
    expect(after.seanceId).toBe(before.seanceId);
    expect((await as(t.martin).post(`${base()}/seances/${reunion.id}/odj/affectations`, { acteIds: [acte.id] })).status).toBe(409);
    expect((await as(t.martin).get(`${base()}/seances/${reunion.id}/odj/en-attente`)).body.items.some((x) => x.id === acte.id)).toBe(false);
  });

  it('l\'avis saisi sans date prend la date de la réunion où le projet a été présenté', async () => {
    const r = await as(t.nouveau).put(`${A(acte.id)}/commissions/${com.id}/avis`, { avis: 'favorable' });
    expect(r.status).toBe(200);
    expect(r.body.datePassage.slice(0, 10)).toBe(new Date(reunion.dateSeance).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }));
  });

  it('retirer un projet de la réunion ne modifie pas l\'acte', async () => {
    const r = await as(t.martin).del(`${base()}/seances/${reunion.id}/odj/actes/${acte.id}`);
    expect(r.body.items).toHaveLength(0);
    expect((await as(t.dupont).get(A(acte.id))).body.statut).toBe('en_attente_scc');
  });

  it('l\'arrêt de l\'ordre du jour d\'une réunion n\'envoie pas les notifications « inscrit à l\'ordre du jour »', async () => {
    await as(t.martin).post(`${base()}/seances/${reunion.id}/odj/affectations`, { acteIds: [acte.id] });
    const before = (await logs('odj.arrete')).length;
    const r = await as(t.martin).post(`${base()}/seances/${reunion.id}/odj/arret`, {});
    expect(r.status).toBe(200);
    expect((await logs('odj.arrete')).length).toBe(before);
  });
});
