const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { PDFDocument } = require('pdf-lib');
const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');
const { choisirTransport } = require('../../src/modules/sauvegarde/transports');
const { restaurer } = require('../../src/modules/sauvegarde/restaurer');
const { EXCLUES } = require('../../src/modules/sauvegarde/sauvegarde.service');

let env; let admin; let dupont; let cible; let ville;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
});
const S = (p = '') => `/api/v1/plateforme/sauvegarde${p}`;
const dossiers = () => fs.readdirSync(cible).filter((x) => /^vibedelib_/.test(x)).sort();
const lire = (dossier, table) => zlib.gunzipSync(fs.readFileSync(path.join(cible, dossier, 'donnees', `${table}.ndjson.gz`))).toString().split('\n').filter(Boolean).map((l) => JSON.parse(l));

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  dupont = await loginAs(env, 'dupont', 'pw-dupont');
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  cible = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-sauvegarde-'));
  // une annexe : un vrai fichier dans le volume local
  const type = (await as(admin).get(`/api/v1/organismes/${ville.id}/referentiels/type_acte`)).body.items.find((x) => x.code === 'deliberation');
  const acte = (await as(dupont).post(`/api/v1/organismes/${ville.id}/actes`, { typeId: type.id, titre: 'Dossier à sauvegarder' })).body;
  const d = await PDFDocument.create(); d.addPage([200, 200]).drawText('Annexe', { x: 20, y: 100, size: 12 }); const buf = Buffer.from(await d.save());
  await env.c.annexes.add(await env.c.access.loadContext('dupont'), ville.id, acte.id, { titre: 'Annexe', communicable: true }, { buffer: buf, originalname: 'a.pdf', size: buf.length, mimetype: 'application/pdf' });
});
afterAll(async () => { fs.rmSync(cible, { recursive: true, force: true }); await env.close(); });

describe('configuration (SAV-03, SAV-07)', () => {
  it('réservée à l’administrateur de la plateforme ; mot de passe chiffré, jamais renvoyé ; activation exige une destination', async () => {
    expect((await as(dupont).get(S())).status).toBe(403);
    expect((await as(dupont).put(S('/config'), { actif: true })).status).toBe(403);
    expect((await as(admin).put(S('/config'), { actif: true })).status).toBe(400);
    const r = await as(admin).put(S('/config'), { actif: true, cible, utilisateur: 'IVRY\\svc-sauvegarde', motDePasse: 'Secret-partage-2026', heure: '03:15', retentionJours: 7, inclureFichiers: true });
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ actif: true, cible, utilisateur: 'IVRY\\svc-sauvegarde', motDePasseDefini: true, heure: '03:15', retentionJours: 7 });
    expect(JSON.stringify(r.body)).not.toMatch(/Secret-partage/);
    expect(String((await env.db.get('SELECT mot_de_passe_chiffre AS m FROM sauvegarde_config')).m)).not.toMatch(/Secret-partage/);
    expect((await as(admin).put(S('/config'), { heure: '25:00' })).status).toBe(400);
    expect((await as(admin).put(S('/config'), { utilisateur: 'IVRY\\autre' })).body.motDePasseDefini).toBe(true); // vide : conservé
    expect(JSON.stringify(await env.db.all("SELECT after FROM audit_log WHERE action = 'sauvegarde.config'"))).not.toMatch(/Secret-partage/);
    // le transport choisi dépend de la cible
    expect(choisirTransport({ cible: '\\\\SRVIVRY2\\shares3\\DSI', utilisateur: 'x', motDePasse: 'y' }).type).toBe('smb');
    expect(choisirTransport({ cible: os.tmpdir() }).type).toBe('local');
    expect(() => choisirTransport({ cible: '' })).toThrow(/destination/);
  });

  it('bouton de test : écrit puis efface un fichier ; message clair si la destination est inutilisable', async () => {
    await as(admin).put(S('/config'), { utilisateur: '', motDePasse: undefined });
    const ok = (await as(admin).post(S('/test'))).body;
    expect(ok.ok).toBe(true); expect(fs.readdirSync(cible).filter((x) => x.startsWith('.vibedelib-test'))).toEqual([]);
    const fichier = path.join(cible, 'un-fichier'); fs.writeFileSync(fichier, 'x');
    await as(admin).put(S('/config'), { cible: fichier });
    const ko = (await as(admin).post(S('/test'))).body;
    expect(ko.ok).toBe(false); expect(ko.message).toBeTruthy();
    await as(admin).put(S('/config'), { cible });
    expect((await as(dupont).post(S('/test'))).status).toBe(403);
  });
});

describe('sauvegarde (SAV-01, SAV-02, SAV-04, SAV-05)', () => {
  let premier;
  it('export cohérent : une table = un fichier, manifeste avec empreintes, fichiers copiés, journal', async () => {
    const r = await as(admin).post(S('/lancer'));
    expect(r.status).toBe(202); expect(r.body.dossier).toMatch(/^vibedelib_\d{4}-\d{2}-\d{2}_\d{4}$/);
    expect((await as(admin).post(S('/lancer'))).status).toBe(409);      // jamais deux à la fois
    await env.c.sauvegarde.idle();
    const j = (await as(admin).get(S())).body;
    expect(j.enCours).toBe(false); expect(j.journal[0]).toMatchObject({ statut: 'ok', declencheur: 'manuel', erreur: null, dossier: r.body.dossier });
    expect(j.journal[0].lignes).toBeGreaterThan(50); expect(j.journal[0].fichiers).toBeGreaterThanOrEqual(1);
    premier = dossiers()[0]; expect(premier).toBe(r.body.dossier);
    const m = JSON.parse(fs.readFileSync(path.join(cible, premier, 'manifest.json'), 'utf8'));
    expect(m).toMatchObject({ format: 'vibedelib.sauvegarde/1', application: { nom: 'VibeDélib' } });
    expect(m.migrations.length).toBeGreaterThan(30); expect(m.exclues).toEqual(EXCLUES);
    for (const t of m.tables) {
      if (!['audit_log', 'sauvegardes'].includes(t.nom)) expect(t.lignes).toBe((await env.db.get(`SELECT count(*)::int AS n FROM "${t.nom}"`)).n); // autant de lignes que la base (sauf ce que la sauvegarde elle-même journalise)
      expect(lire(premier, t.nom).length).toBe(t.lignes);
    }
    expect(m.tables.map((t) => t.nom)).not.toEqual(expect.arrayContaining(['sessions', 'search_index']));
    expect(lire(premier, 'actes').some((a) => a.titre === 'Dossier à sauvegarder')).toBe(true);           // types conservés (jsonb, dates…)
    expect(fs.existsSync(path.join(cible, premier, 'schema.json'))).toBe(true);
    const copies = []; const marcher = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? marcher(p) : copies.push(p); } };
    marcher(path.join(cible, 'fichiers')); expect(copies.some((p) => p.endsWith('.pdf'))).toBe(true);
    expect(fs.readdirSync(os.tmpdir()).filter((x) => x.startsWith('vibedelib-sauvegarde-'))).toEqual([]);   // temporaires nettoyés
  });

  it('rétention : les anciennes sauvegardes ne sont supprimées qu’après une nouvelle réussie', async () => {
    fs.mkdirSync(path.join(cible, 'vibedelib_2020-01-01_0200'), { recursive: true });
    fs.mkdirSync(path.join(cible, 'vibedelib_2020-02-01_0200'), { recursive: true });
    fs.mkdirSync(path.join(cible, 'autre-dossier'), { recursive: true });              // ce qui n'est pas une sauvegarde n'est jamais touché
    await new Promise((r) => setTimeout(r, 1100));
    await as(admin).post(S('/lancer')); await env.c.sauvegarde.idle();
    const j = (await as(admin).get(S())).body.journal[0];
    expect(j).toMatchObject({ statut: 'ok', purgees: 2 });
    expect(dossiers().filter((d) => d.startsWith('vibedelib_2020'))).toEqual([]);
    expect(fs.existsSync(path.join(cible, 'autre-dossier'))).toBe(true);
    expect(dossiers()).toContain(premier);                                              // 7 jours de rétention : la récente reste
  });

  it('échec : journalisé (message clair, audit), rien n’est purgé, la suivante repart', async () => {
    fs.mkdirSync(path.join(cible, 'vibedelib_2020-03-01_0200'), { recursive: true });
    const fichier = path.join(cible, 'bloque'); fs.writeFileSync(fichier, 'x');
    await as(admin).put(S('/config'), { cible: path.join(fichier, 'sous-dossier') });    // un fichier n'est pas un dossier
    await as(admin).post(S('/lancer')); await env.c.sauvegarde.idle();
    const j = (await as(admin).get(S())).body.journal[0];
    expect(j.statut).toBe('erreur'); expect(j.erreur).toBeTruthy();
    expect(await env.db.get("SELECT count(*)::int AS n FROM audit_log WHERE action = 'sauvegarde.echec'")).toEqual({ n: 1 });
    await as(admin).put(S('/config'), { cible });
    expect(dossiers()).toContain('vibedelib_2020-03-01_0200');                           // pas de purge après un échec
  });

  it('planification : une fois par jour après l’heure choisie, jamais avant, pas de tempête après un échec', async () => {
    await env.db.run('DELETE FROM sauvegardes');
    const svc = env.c.sauvegarde; const jour = new Date(); jour.setHours(3, 0, 0, 0);       // 03:00 < 03:15
    expect(await svc.siDue(jour)).toBe(0);
    const apres = new Date(); apres.setHours(23, 59, 0, 0);
    expect(await svc.siDue(apres)).toBe(1); await svc.idle();
    expect((await as(admin).get(S())).body.journal[0]).toMatchObject({ statut: 'ok', declencheur: 'planifie', lancePar: 'planificateur' });
    expect(await svc.siDue(apres)).toBe(0);                                              // déjà faite aujourd'hui
    await env.db.run('DELETE FROM sauvegardes');
    await env.db.run("INSERT INTO sauvegardes (declencheur, statut, fin, erreur, debut) VALUES ('planifie', 'erreur', now(), 'échec', now() - interval '10 minutes')");
    expect(await svc.siDue(apres)).toBe(0);                                              // un échec récent : pas de nouvelle tentative avant une heure
    await as(admin).put(S('/config'), { actif: false });
    await env.db.run('DELETE FROM sauvegardes');
    expect(await svc.siDue(apres)).toBe(0);                                              // désactivée
    await as(admin).put(S('/config'), { actif: true });
  });
});

describe('restauration (SAV-06)', () => {
  it('recrée le schéma et recharge les données : nombres de lignes conformes, compteurs réalignés, schéma non vide refusé', async () => {
    const dossier = path.join(cible, dossiers().at(-1));
    const schema = `${env.schema}_restore`;
    try {
      const r = await restaurer({ config: env.config, log: { info() {}, warn() {}, error() {} }, dossier, schema });
      expect(r.ecarts).toEqual([]); expect(r.lignes).toBeGreaterThan(50);
      const q = (sql) => env.db.get(sql);
      for (const t of ['actes', 'organismes', 'files', 'annexes', 'ref_items']) {
        expect((await q(`SELECT count(*)::int AS n FROM ${schema}.${t}`)).n).toBe((await q(`SELECT count(*)::int AS n FROM ${t}`)).n);
      }
      const a = await q(`SELECT titre, custom, created_at FROM ${schema}.actes WHERE titre = 'Dossier à sauvegarder'`);
      const b = await q("SELECT titre, custom, created_at FROM actes WHERE titre = 'Dossier à sauvegarder'");
      expect(a).toEqual(b);                                                              // jsonb et horodatages identiques
      const seq = await q(`SELECT max(id) AS m FROM ${schema}.actes`);
      await env.db.run(`INSERT INTO ${schema}.actes (organisme_id, numero_suivi, type_id, titre, redacteur, direction_code) SELECT organisme_id, 9999, type_id, 'Nouveau après restauration', 'x', 'D' FROM ${schema}.actes LIMIT 1`);
      expect((await q(`SELECT id FROM ${schema}.actes WHERE titre = 'Nouveau après restauration'`)).id).toBeGreaterThan(Number(seq.m)); // les identifiants repartent après le dernier
      await expect(restaurer({ config: env.config, log: { info() {}, warn() {}, error() {} }, dossier, schema })).rejects.toThrow(/n'est pas vide/);
    } finally { await env.db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
  });

  it('un fichier de sauvegarde altéré est refusé avant tout chargement', async () => {
    const copie = path.join(cible, 'copie-alteree'); fs.cpSync(path.join(cible, dossiers().at(-1)), copie, { recursive: true });
    fs.appendFileSync(path.join(copie, 'donnees', 'actes.ndjson.gz'), 'x');
    await expect(restaurer({ config: env.config, log: { info() {}, warn() {}, error() {} }, dossier: copie, schema: `${env.schema}_alt` })).rejects.toThrow(/altéré/);
    expect((await env.db.get("SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name = $1", [`${env.schema}_alt`])).n).toBe(0); // rien n'a été créé
  });
});
