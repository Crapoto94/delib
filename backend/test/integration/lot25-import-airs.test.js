const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const base = (o = ville) => `/api/v1/organismes/${o.id}/import-airs`;
const trouve = (items, axe, code) => items.find((c) => c.axe === axe && c.sourceCode === code);

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = {};
  for (const [u, p] of [['dupont', 'pw-dupont'], ['martin', 'pw-martin']]) t[u] = await loginAs(env, u, p);
});
afterAll(async () => { await env.close(); });

describe('import AIRS DELIB : sas, concordances, publication (D111, IMP-01 à IMP-20)', () => {
  let lotId;

  it('réservé à l’administrateur ou au SCC ; un agent ordinaire est refusé', async () => {
    expect((await as(t.dupont).get(base())).status).toBe(403);
    expect((await as(admin).get(base())).status).toBe(200);
  });

  it('mapping déclaratif fourni par défaut, modifiable par l’administrateur', async () => {
    const m = (await as(admin).get(`${base()}/mapping`)).body.items;
    expect(m.map((x) => x.table_name)).toEqual(expect.arrayContaining(['seances', 'rapports']));
    const r = await as(admin).put(`${base()}/mapping`, { items: [{ tableName: 'seances', libelle: 'Séances AIRS', entiteCible: 'seance', cleColonne: 'id', colonnes: [{ source: 'id', cible: 'numero' }, { source: 'instance', cible: 'instance' }, { source: 'date', cible: 'date' }] }] });
    expect(r.status).toBe(200);
  });

  it('un lot se crée, se charge (jeu d’essai) et s’analyse : rien n’entre dans les tables métier', async () => {
    const lot = (await as(admin).post(`${base()}/lots`, { label: 'Reprise 2023', mode: 'passes' })).body;
    expect(lot.statut).toBe('brouillon');
    lotId = lot.id;
    const ch = (await as(admin).post(`${base()}/lots/${lotId}/charger-demo`, {})).body;
    expect(ch.inventaire).toMatchObject({ seances: 2, rapports: 2 });
    expect(ch.lot.inventaire.tables).toMatchObject({ seances: 2, rapports: 2 });
    expect(Number(await env.db.get("SELECT count(*)::int AS n FROM actes WHERE organisme_id = $1 AND custom ? 'airs'", [ville.id]).then((r) => r.n))).toBe(0);

    const d = (await as(admin).post(`${base()}/lots/${lotId}/analyser`, {})).body;
    expect(d.compteurs).toMatchObject({ seances: 2, actes: 2, publies: 0 });
    expect(d.items.filter((x) => x.kind === 'acte').every((x) => x.statut === 'en_attente')).toBe(true);
    // concordances proposées : direction et service (bloquants) restent à décider
    const c = d.concordances.items;
    expect(trouve(c, 'direction', 'DIRECTION DES FINANCES').etat).toBe('proposee');
    expect(trouve(c, 'type_acte', 'deliberation').cibleCode).toBe('deliberation');
    expect(trouve(c, 'rubrique', 'SPORTS').cibleLibelle).toBe('SPORTS');
    expect(trouve(c, 'nature', 'Delibérations').cibleCode).toBe('delib');
    expect(d.blocage.bloquantesNonResolues).toBeGreaterThan(0);
  });

  it('la publication est bloquée tant que les concordances bloquantes ne sont pas résolues', async () => {
    const r = await as(admin).post(`${base()}/lots/${lotId}/publier`, {});
    expect(r.status).toBe(200); expect(r.body.publies).toBe(0);
    expect(r.body.ignores.every((x) => x.missing?.some((m) => /Concordance/.test(m.label)))).toBe(true);
  });

  it('les concordances se décident ; les items deviennent prêts', async () => {
    const c = (await as(admin).get(`${base()}/lots/${lotId}/concordances`)).body.items;
    const cible = { 'DIRECTION DES FINANCES': 'A1', 'DIRECTION CCAS': 'J', BUDGET: 'A1a', 'AIDE SOCIALE': 'Ja' };
    for (const x of c.filter((y) => y.bloquant && !['manuelle', 'ignoree'].includes(y.etat))) {
      const r = (await as(admin).post(`${base()}/lots/${lotId}/concordances/${x.id}`, { cibleType: x.axe === 'direction' ? 'directions' : 'services', cibleCode: cible[x.sourceCode], cibleLibelle: x.sourceCode })).body;
      expect(r.etat).toBe('manuelle');
    }
    const items = (await as(admin).get(`${base()}/lots/${lotId}/actes`)).body.items.filter((x) => x.kind === 'acte');
    expect(items.length).toBe(2);
    expect(items.every((x) => x.statut === 'pret')).toBe(true);
  });

  it('la publication crée les actes, séances, textes et points d’ordre du jour ; elle est idempotente', async () => {
    const r = (await as(admin).post(`${base()}/lots/${lotId}/publier`, {})).body;
    expect(r.publies).toBe(2);
    const actes = await env.db.all("SELECT id, statut, direction_code, custom, seance_id FROM actes WHERE organisme_id = $1 AND custom ? 'airs' ORDER BY id", [ville.id]);
    expect(actes.length).toBe(2);
    expect(actes.every((a) => a.statut === 'archive' && a.seance_id)).toBe(true);
    expect(actes.find((a) => a.direction_code === 'A1')).toBeTruthy();
    const textes = await env.db.get("SELECT count(*)::int AS n FROM tracked_texts tt JOIN actes a ON a.id = tt.acte_id WHERE a.organisme_id = $1 AND a.custom ? 'airs'", [ville.id]);
    expect(textes.n).toBeGreaterThanOrEqual(4);
    // idempotent : rejouer ne duplique pas
    const encore = (await as(admin).post(`${base()}/lots/${lotId}/publier`, {})).body;
    expect(encore.publies).toBe(0);
    expect(Number((await env.db.get("SELECT count(*)::int AS n FROM actes WHERE organisme_id = $1 AND custom ? 'airs'", [ville.id])).n)).toBe(2);
    expect((await as(admin).get(`${base()}/lots/${lotId}`)).body.lot.statut).toBe('publie');
  });

  it('dépublier retire les actes sans les supprimer ; annuler clôt le lot', async () => {
    const r = (await as(admin).post(`${base()}/lots/${lotId}/depublier`, {})).body;
    expect(r.retires).toBe(2);
    const actes = await env.db.all("SELECT statut FROM actes WHERE organisme_id = $1 AND custom ? 'airs'", [ville.id]);
    expect(actes.every((a) => a.statut === 'abandonne')).toBe(true);
    expect((await as(admin).post(`${base()}/lots/${lotId}/annuler`, {})).body.statut).toBe('annule');
  });

  it('contrôle AD/RH des agents jamais connectés, sans jamais créer de compte', async () => {
    const r = (await as(admin).post(`${base()}/agents/verifier`, { valeurs: [{ identifiant: 'dupont' }, { nom: 'Inconnu Zzz' }] })).body;
    expect(r.sansCreation).toBe(true);
    expect(r.items.find((x) => x.identifiant === 'dupont').statut).toBe('connu');
    expect(r.items.find((x) => x.nom === 'Inconnu Zzz').statut).toBe('absent');
  });
});
