const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubrique;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const suivi = async (tok) => (await as(tok).get(`${base()}/circuit/suivi`)).body;

async function acte(titre, { submit = false } = {}) {
  const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre })).body;
  await as(t.dupont).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubrique.id, incidenceFinanciere: false, rapporteurId: 1 });
  for (const x of (await as(t.dupont).get(`${A(a.id)}/textes`)).body.items) await as(t.dupont).put(`${A(a.id)}/textes/${x.id}`, { markdown: 'Texte.', baseVersion: x.version });
  if (submit) await as(t.dupont).post(`${A(a.id)}/envoi`);
  return a;
}

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = {};
  for (const [u, p] of [['dupont', 'pw-dupont'], ['durand', 'pw-durand'], ['leroy', 'pw-leroy'], ['petit', 'pw-petit'], ['martin', 'pw-martin'], ['nouveau', 'pw-nouveau']]) t[u] = await loginAs(env, u, p);
  const items = (k) => as(admin).get(`${base()}/referentiels/${k}`).then((r) => r.body.items);
  matiere = (await items('matiere')).find((x) => x.code === '7.5'); rubrique = (await items('rubrique')).find((x) => x.libelle === 'FINANCES');
  typeDelib = (await items('type_acte')).find((x) => x.code === 'deliberation');
  const tit = (fonction, username, extra = {}) => as(admin).post(`${base()}/titulaires`, { fonction, username, ...extra });
  await tit('chef_service', 'durand', { directionCode: 'A1', serviceCode: 'A1a' }); await tit('directeur', 'leroy', { directionCode: 'A1' });
  await tit('dga', 'petit', { directionCode: 'A1' }); await tit('dgs', 'boot');
  const groups = (await as(admin).get(`${base()}/groupes`)).body.items;
  const setMembers = (code, usernames) => as(admin).put(`${base()}/groupes/${groups.find((g) => g.code === code).id}/membres`, { usernames });
  await setMembers('juridique', ['nouveau']); await setMembers('scc', ['martin']); await setMembers('financier', ['moreau']);
});
afterAll(async () => { await env.close(); });

describe('suivi du tableau de bord', () => {
  let draft; let inCircuit;
  it('le directeur voit ce que ses collaborateurs rédigent (brouillon) et font valider (en circuit)', async () => {
    draft = await acte('Brouillon de mon équipe');
    inCircuit = await acte('En circuit dans mon équipe', { submit: true });
    const s = await suivi(t.leroy);
    const d = s.equipe.find((x) => x.acte.id === draft.id); const c = s.equipe.find((x) => x.acte.id === inCircuit.id);
    expect(d).toMatchObject({ phase: 'redaction', step: null });
    expect(c).toMatchObject({ phase: 'validation', step: { key: 'chef_service', holders: ['durand'] } });
    expect(c.acte.redacteur).toBe('dupont');
  });

  it('le chef de service voit aussi son service ; un agent ordinaire ne voit pas d\'équipe', async () => {
    expect((await suivi(t.durand)).equipe.some((x) => x.acte.id === draft.id)).toBe(true);
    expect((await suivi(t.dupont)).equipe).toEqual([]);
    expect((await suivi(t.martin)).equipe).toEqual([]);
  });

  it('n\'y met pas mes propres actes ni ceux qui attendent MA validation (déjà dans « à traiter »)', async () => {
    expect((await suivi(t.durand)).equipe.some((x) => x.acte.id === inCircuit.id)).toBe(false); // à valider par durand
    const s = await suivi(t.dupont);
    expect(s.equipe.some((x) => x.acte.id === draft.id)).toBe(false);
  });

  it('les actes que j\'ai validés apparaissent tant qu\'ils poursuivent le circuit, avec l\'étape actuelle', async () => {
    await as(t.durand).post(`${A(inCircuit.id)}/validation`, {});
    const s = await suivi(t.durand);
    const v = s.valides.find((x) => x.acte.id === inCircuit.id);
    expect(v).toMatchObject({ validatedStep: expect.stringContaining('Chef de service'), step: { key: 'directeur', holders: ['leroy'] } });
    expect(s.equipe.some((x) => x.acte.id === inCircuit.id)).toBe(true); // et reste visible côté équipe (ce n'est plus lui qui le détient)
    expect((await suivi(t.dupont)).valides).toEqual([]);
  });

  it('un acte validé par un délégué apparaît chez le délégant', async () => {
    const a = await acte('Validé par délégation', { submit: true });
    await as(t.durand).post(`${base()}/delegations`, { delegue: 'nouveau', scope: 'all' });
    await as(t.nouveau).post(`${A(a.id)}/validation`, {});
    expect((await suivi(t.durand)).valides.some((x) => x.acte.id === a.id)).toBe(true);
    expect((await suivi(t.nouveau)).valides.some((x) => x.acte.id === a.id)).toBe(true);
  });

  it('l\'acte disparaît du suivi quand son circuit est terminé', async () => {
    const a = await acte('Termine son circuit', { submit: true });
    const who = { chef_service: 'durand', directeur: 'leroy', juridique: 'nouveau', dga: 'petit', dgs: 'boot', scc: 'martin' };
    for (let i = 0; i < 10; i++) {
      const v = (await as(t.dupont).get(`${A(a.id)}/circuit`)).body;
      if (!v.currentStepKey) break;
      await as(who[v.currentStepKey] === 'boot' ? admin : t[who[v.currentStepKey]]).post(`${A(a.id)}/validation`, {});
    }
    expect((await suivi(t.durand)).valides.some((x) => x.acte.id === a.id)).toBe(false);
    expect((await suivi(t.leroy)).equipe.some((x) => x.acte.id === a.id)).toBe(false);
  });

  it('le DGS voit tous les actes en cours de l\'organisme', async () => {
    const s = await suivi(admin);
    expect(s.equipe.length).toBeGreaterThan(0);
  });
});
