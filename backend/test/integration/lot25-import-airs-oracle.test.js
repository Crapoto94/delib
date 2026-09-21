const { createTestEnv, bearer, adminToken } = require('../helpers');

const api = (e, tok) => ({
  get: (u) => e.http().get(u).set(bearer(tok)),
  post: (u, b) => e.http().post(u).set(bearer(tok)).send(b),
  delete: (u) => e.http().delete(u).set(bearer(tok)),
});
const base = (o) => `/api/v1/organismes/${o.id}/import-airs`;

/** Faux adaptateur source : rejoue les lignes canoniques que produirait la base Oracle AIRS (aucun réseau). */
const fakeSource = {
  configuree: () => true,
  cible: () => ({ service: 'TEST' }),
  ping: async () => 2,
  extraire: async () => ({
    seances: [{ id: 'sea:1', instance: 'Conseil municipal', type_seance: 'Ordinaire', date: '2024-03-15T19:00:00', lieu: 'Hôtel de ville', titre: 'Séance du 15 mars 2024' }],
    actes: [{
      id: 'act:1', seance: 'sea:1', titre: "Attribution d'une subvention", numero: 'DEL032024_1', type: 'deliberation',
      nature: '1', matiere: '7.5', rubrique: 'SPORTS', direction: 'DIRECTION DES FINANCES', service: 'BUDGET',
      redacteur: 'dupont', rapporteur: 'Martine Rapporteur', resultat: 'Adopté à la majorité', date: '2024-03-15T19:00:00',
    }],
  }),
  apercu: async (table) => (table === 'seances'
    ? [{ id: 'sea:1', instance: 'Conseil municipal', type_seance: 'Ordinaire', date: '2024-03-15T19:00:00' }]
    : [{ id: 'act:1', seance: 'sea:1', titre: "Attribution d'une subvention", type: 'deliberation' }]),
};

describe('import AIRS DELIB depuis Oracle (source directe, lecture seule)', () => {
  let env; let admin; let ville;
  beforeAll(async () => {
    env = await createTestEnv({ airsSource: fakeSource });
    admin = await adminToken(env);
    ville = (await api(env, admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  });
  afterAll(async () => { await env.close(); });

  it('expose l’état de la source Oracle et l’aperçu des tables', async () => {
    const s = (await api(env, admin).get(`${base(ville)}/source`)).body;
    expect(s).toMatchObject({ configuree: true, joignable: true });
    const ap = (await api(env, admin).get(`${base(ville)}/tables/actes/apercu`)).body;
    expect(ap.colonnes.length).toBeGreaterThan(0);
    expect(ap.apercu[0].brut.id).toBe('act:1');
    expect(ap.apercu[0].transpose.titre).toContain('subvention');
  });

  it('n’importe aucune table non validée', async () => {
    const lot = (await api(env, admin).post(`${base(ville)}/lots`, { label: 'Sans validation', mode: 'passes' })).body;
    const r = await api(env, admin).post(`${base(ville)}/lots/${lot.id}/charger-oracle`, {});
    expect(r.status).toBe(422);
    expect((await api(env, admin).get(`${base(ville)}/tables`)).body.items.every((t) => t.valide === false)).toBe(true);
  });

  it('charge le sas depuis Oracle après validation, analyse, concorde et publie — sans toucher au paramétrage', async () => {
    const refItemsAvant = Number((await env.db.get('SELECT count(*)::int AS n FROM ref_items')).n);
    const settingsAvant = Number((await env.db.get('SELECT count(*)::int AS n FROM settings')).n);

    const lot = (await api(env, admin).post(`${base(ville)}/lots`, { label: 'Reprise Oracle', mode: 'passes' })).body;
    for (const tableName of ['seances', 'actes']) {
      const v = (await api(env, admin).post(`${base(ville)}/tables/${tableName}/valider`, { valide: true })).body;
      expect(v.valide).toBe(true);
      expect(v.validePar).toBeTruthy();
    }

    const ch = (await api(env, admin).post(`${base(ville)}/lots/${lot.id}/charger-oracle`, {})).body;
    expect(ch.inventaire).toMatchObject({ seances: 1, actes: 1 });
    expect(ch.lot.inventaire.origine).toBe('oracle');

    const d = (await api(env, admin).post(`${base(ville)}/lots/${lot.id}/analyser`, {})).body;
    expect(d.compteurs).toMatchObject({ seances: 1, actes: 1 });
    // la progression de l'analyse est consultable (phase terminée, entités traitées)
    expect((await api(env, admin).get(`${base(ville)}/lots/${lot.id}/progression`)).body).toMatchObject({ enCours: false, phase: 'termine', seances: 1, actes: 1, fait: 2, total: 2 });
    // validation en une fois des assignations proposées de l'axe « instance »
    expect((await api(env, admin).post(`${base(ville)}/lots/${lot.id}/concordances/valider?axe=instance`, {})).body).toMatchObject({ validees: 1 });
    const c = d.concordances.items;
    // le « type » de séance (Ordinaire) alimente l'axe « type de conseil », jamais « type d'acte »
    expect(c.some((x) => x.axe === 'type_acte' && x.sourceCode === 'Ordinaire')).toBe(false);
    expect(c.find((x) => x.axe === 'type_seance' && x.sourceCode === 'Ordinaire').cibleCode).toBe('ordinaire');
    expect(c.find((x) => x.axe === 'type_acte' && x.sourceCode === 'deliberation').cibleCode).toBe('deliberation');
    // exemples de données source pour une valeur de concordance
    const dir = c.find((x) => x.axe === 'direction' && x.sourceCode === 'DIRECTION DES FINANCES');
    const ex = (await api(env, admin).get(`${base(ville)}/lots/${lot.id}/concordances/${dir.id}/exemples`)).body;
    expect(ex.exemples[0].titre).toContain('subvention');

    // une séance du sas se publie explicitement, comme un acte (le conseil est créé)
    const seanceItem = d.items.find((x) => x.kind === 'seance');
    expect(seanceItem.statut).toBe('pret');
    const pub = (await api(env, admin).post(`${base(ville)}/lots/${lot.id}/actes/${seanceItem.id}/publier`, {})).body;
    expect(pub.item.seanceId).toBeTruthy();

    for (const x of c.filter((y) => y.bloquant && !['manuelle', 'ignoree'].includes(y.etat))) {
      await api(env, admin).post(`${base(ville)}/lots/${lot.id}/concordances/${x.id}`, { cibleType: x.axe === 'direction' ? 'directions' : 'services', cibleCode: x.axe === 'direction' ? 'A1' : 'A1a', cibleLibelle: x.sourceCode });
    }
    const r = (await api(env, admin).post(`${base(ville)}/lots/${lot.id}/publier`, {})).body;
    expect(r.publies).toBe(1);
    const actes = await env.db.all("SELECT statut, seance_id FROM actes WHERE organisme_id = $1 AND custom ? 'airs'", [ville.id]);
    expect(actes.length).toBe(1);
    expect(actes[0].statut).toBe('archive');
    expect(actes[0].seance_id).toBeTruthy();
    // le type de conseil concordé (Ordinaire) est porté par la séance publiée
    expect((await env.db.get('SELECT type FROM seances WHERE id = $1', [actes[0].seance_id])).type).toBe('ordinaire');

    // aucun écrasement du paramétrage applicatif (référentiels, réglages)
    expect(Number((await env.db.get('SELECT count(*)::int AS n FROM ref_items')).n)).toBe(refItemsAvant);
    expect(Number((await env.db.get('SELECT count(*)::int AS n FROM settings')).n)).toBe(settingsAvant);
    expect(Number((await env.db.get("SELECT count(*)::int AS n FROM ref_items WHERE libelle ILIKE 'DIRECTION DES FINANCES'")).n)).toBe(0);
  });

  it('crée une direction HISTORIQUE sans code (ancienne organisation) et la concordée', async () => {
    const lot = (await api(env, admin).post(`${base(ville)}/lots`, { label: 'Historique', mode: 'passes' })).body;
    for (const t of ['seances', 'actes']) await api(env, admin).post(`${base(ville)}/tables/${t}/valider`, { valide: true });
    await api(env, admin).post(`${base(ville)}/lots/${lot.id}/charger-oracle`, {});
    const d = (await api(env, admin).post(`${base(ville)}/lots/${lot.id}/analyser`, {})).body;
    const dir = d.concordances.items.find((x) => x.axe === 'direction' && x.sourceCode === 'DIRECTION DES FINANCES');
    expect(dir).toBeTruthy();
    const r = (await api(env, admin).post(`${base(ville)}/lots/${lot.id}/concordances/${dir.id}/historique`, { libelle: 'CCAS et santé' })).body;
    expect(r.entite).toMatchObject({ type: 'direction', code: null, libelle: 'CCAS et santé' });
    expect(r.cibleCode).toMatch(/^hist:/);
    const apres = (await api(env, admin).get(`${base(ville)}/lots/${lot.id}/concordances`)).body.items.find((x) => String(x.id) === String(dir.id));
    expect(apres).toMatchObject({ etat: 'manuelle', cibleLibelle: 'CCAS et santé', cibleCode: r.cibleCode });
    const cibles = (await api(env, admin).get(`${base(ville)}/cibles?axe=direction`)).body.items;
    expect(cibles.find((x) => x.historique && x.libelle === 'CCAS et santé')).toBeTruthy();
  });

  it('complète un mapping existant avec la table source manquante « actes »', async () => {
    await env.db.run("DELETE FROM airs_source_tables WHERE organisme_id = $1 AND table_name = 'actes'", [ville.id]);
    const items = (await api(env, admin).get(`${base(ville)}/tables`)).body.items;
    const actes = items.find((x) => x.tableName === 'actes');
    expect(actes).toBeTruthy();
    expect(actes.valide).toBe(false);
  });

  it('supprime un lot d’essai et, sur demande, son paramétrage', async () => {
    const lot = (await api(env, admin).post(`${base(ville)}/lots`, { label: 'À supprimer', mode: 'passes' })).body;
    await api(env, admin).post(`${base(ville)}/tables/seances/valider`, { valide: true });
    await api(env, admin).post(`${base(ville)}/lots/${lot.id}/charger-oracle`, {});
    const del = (await api(env, admin).delete(`${base(ville)}/lots/${lot.id}?parametrage=true`)).body;
    expect(del).toMatchObject({ supprime: true, parametrageReinitialise: true });
    const liste = (await api(env, admin).get(base(ville))).body.items;
    expect(liste.find((l) => l.id === lot.id)).toBeUndefined();
    // le mapping par défaut est recréé (tables non validées)
    expect((await api(env, admin).get(`${base(ville)}/tables`)).body.items.every((t) => t.valide === false)).toBe(true);
  });
});
