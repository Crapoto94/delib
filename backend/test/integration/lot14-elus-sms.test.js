const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');
const { createSms } = require('../../src/adapters/sms');

let env; let admin; let ville; let t;
const PW = 'Mot-de-passe-solide-2026';
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const E = (p = '') => `${base()}/espace-elus${p}`;
const mails = (re) => env.mail.state.sent.filter((m) => re.test(m.subject));
const creer = async (b) => (await as(admin).post(`${base()}/elus`, { role: 'Conseiller municipal', ...b })).body;
const activer = async (elu) => {
  expect((await as(t.martin).post(E(`/comptes/${elu.id}/invitation`))).status).toBe(201);
  const tok = /#\/invitation\/([\w-]+)/.exec(mails(/accès à l’espace des élus/).at(-1).html)[1];
  expect((await env.http().post(`/api/v1/elus-auth/invitation/${tok}`).send({ motDePasse: PW })).status).toBe(200);
};
const dernierSms = async () => (await env.db.get("SELECT message, mobile FROM sms_journal ORDER BY id DESC LIMIT 1"));
const codeSms = async () => /\b(\d{6})\b/.exec((await dernierSms()).message)[1];
const oubli = (email, extra = {}) => env.http().post('/api/v1/elus-auth/oubli-sms').send({ email, ...extra });
const valider = (challenge, code) => env.http().post('/api/v1/elus-auth/oubli-sms/code').send({ challenge, code });
const evenements = async (email) => (await env.db.all('SELECT evenement FROM elu_oublis WHERE lower(email) = $1 ORDER BY id', [email])).map((r) => r.evenement);

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = { dupont: await loginAs(env, 'dupont', 'pw-dupont'), martin: await loginAs(env, 'martin', 'pw-martin') };
  await as(admin).post(`${base()}/roles`, { username: 'martin', role: 'scc' });
});
afterAll(async () => { await env.close(); });

describe('gestion des élus en administration (ELU-80 à ELU-82)', () => {
  it('création à la main (élu ou non élu), modification, droits', async () => {
    expect((await as(t.dupont).post(`${base()}/elus`, { nom: 'X' })).status).toBe(403);
    const a = await creer({ nom: 'Dupuis', prenom: 'Claire', email: 'claire.dupuis@example.fr', mobile: '06 11 22 33 44' });
    expect(a).toMatchObject({ source: 'manual', estElu: true, mobile: '06 11 22 33 44', actif: true });
    const b = await creer({ nom: 'Personne', prenom: 'Qualifiée', estElu: false, role: 'Personne qualifiée' });
    expect(b.estElu).toBe(false);
    const m = await as(t.martin).put(`${base()}/elus/${a.id}`, { prenom: 'Claire-Anne', role: 'Adjointe', mobile: '07 55 66 77 88' });
    expect(m.body).toMatchObject({ prenom: 'Claire-Anne', role: 'Adjointe', mobile: '07 55 66 77 88' });
    expect((await as(t.dupont).put(`${base()}/elus/${a.id}`, { role: 'x' })).status).toBe(403);
  });

  it('désactivation persistante : la synchronisation avec le Hub ne réactive jamais un élu désactivé à la main', async () => {
    (await env.directoryAdapter.listElus()).push({ externalId: 'H-1', nom: 'Hubert', prenom: 'Marc', email: 'marc.hubert@example.fr', telephone: null, role: 'Conseiller', delegation: '' });
    expect((await as(admin).post(`${base()}/elus/synchronisation`)).status).toBe(200);
    const hub = (await as(admin).get(`${base()}/elus?actif=all`)).body.items.filter((e) => e.source === 'hub');
    expect(hub.length).toBeGreaterThan(0);
    const h = hub[0];
    const d = await as(admin).put(`${base()}/elus/${h.id}`, { actif: false });
    expect(d.body).toMatchObject({ actif: false, desactiveManuellement: true });
    // le Hub modifie son identité : elle est mise à jour, l'élu reste désactivé
    const src = (await env.directoryAdapter.listElus()).find((e) => e.externalId === 'H-1');
    if (src) src.role = 'Nouveau rôle du Hub';
    const s = await as(admin).post(`${base()}/elus/synchronisation`);
    expect(s.status).toBe(200);
    const apres = (await as(admin).get(`${base()}/elus/${h.id}`)).body;
    expect(apres).toMatchObject({ actif: false, desactiveManuellement: true });
    expect((await as(admin).post(`${base()}/elus/synchronisation`)).status).toBe(200);
    expect((await as(admin).get(`${base()}/elus/${h.id}`)).body.actif).toBe(false);
    // seule une réactivation manuelle le rétablit
    expect((await as(admin).put(`${base()}/elus/${h.id}`, { actif: true })).body).toMatchObject({ actif: true, desactiveManuellement: false });
    // un mobile saisi localement pour un élu du Hub survit aussi à la synchronisation
    await as(admin).put(`${base()}/elus/${h.id}`, { mobile: '06 99 88 77 66' });
    await as(admin).post(`${base()}/elus/synchronisation`);
    expect((await as(admin).get(`${base()}/elus/${h.id}`)).body.mobile).toBe('06 99 88 77 66');
  });

  it('suppression prudente : refusée pour le Hub et pour un historique, permise sinon', async () => {
    const hub = (await as(admin).get(`${base()}/elus?actif=all`)).body.items.find((e) => e.source === 'hub');
    const r1 = await as(admin).del(`${base()}/elus/${hub.id}`);
    expect(r1.status).toBe(409); expect(r1.body.error).toMatch(/Désactivez-le/);
    const libre = await creer({ nom: 'Libre', prenom: 'Sans historique' });
    expect((await as(t.martin).del(`${base()}/elus/${libre.id}`)).status).toBe(403); // réservé à l'administrateur
    expect((await as(admin).del(`${base()}/elus/${libre.id}`)).status).toBe(200);
    expect((await as(admin).get(`${base()}/elus/${libre.id}`)).status).toBe(404);
    const actif = await creer({ nom: 'Historique', prenom: 'Avec' });
    await env.db.run("INSERT INTO seances (organisme_id, instance_id, date_seance, created_by) SELECT $1, (SELECT id FROM instances WHERE organisme_id = $1 LIMIT 1), now(), 'x'", [ville.id]);
    const sid = (await env.db.get('SELECT max(id) AS id FROM seances')).id;
    await env.db.run("INSERT INTO seance_presences (seance_id, elu_id, statut, en_salle) VALUES ($1,$2,'present',true)", [sid, actif.id]);
    const r2 = await as(admin).del(`${base()}/elus/${actif.id}`);
    expect(r2.status).toBe(409); expect(r2.body.error).toMatch(/historique.*1 présence/);
    expect((await as(admin).put(`${base()}/elus/${actif.id}`, { actif: false })).body.actif).toBe(false); // on le désactive plutôt
  });
});

describe('mot de passe oublié par SMS (ELU-83 à ELU-85)', () => {
  let elu; const EMAIL = 'sophie.martin@example.fr';
  // la limite tient compte de l'IP : les tests vieillissent les demandes précédentes pour rester indépendants
  beforeEach(async () => { await env.db.run("UPDATE elu_oublis SET at = at - interval '1 hour'"); });
  beforeAll(async () => { elu = await creer({ nom: 'Martin', prenom: 'Sophie', email: EMAIL, mobile: '06 12 34 56 78' }); await activer(elu); });

  it('code à 6 chiffres par SMS, valable 5 minutes ; le bon code connecte avec un jeton de 12 heures, sans appareil de confiance', async () => {
    const r = await oubli(EMAIL);
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ expireDans: 300 }); expect(r.body.challenge).toMatch(/^[0-9a-f-]{36}$/);
    const sms = await dernierSms();
    expect(sms.mobile).toBe('+33612345678'); expect(sms.message).toMatch(/code de connexion est \d{6}\. Valable 5 minutes/);
    const code = await codeSms();
    const avant = Date.now();
    const v = await valider(r.body.challenge, code);
    expect(v.status).toBe(200);
    const duree = new Date(v.body.expiresAt).getTime() - avant;
    expect(duree).toBeGreaterThan(12 * 3600 * 1000 - 60000); expect(duree).toBeLessThanOrEqual(12 * 3600 * 1000 + 5000); // exactement 12 h, quel que soit le réglage
    expect((await env.http().get('/api/v1/elus/accueil').set(bearer(v.body.token))).status).toBe(200);
    expect(await env.db.get("SELECT count(*)::int AS n FROM elu_sessions WHERE elu_id = $1 AND via = 'sms'", [elu.id])).toEqual({ n: 1 });
    expect(await env.db.get('SELECT count(*)::int AS n FROM elu_appareils WHERE elu_id = $1', [elu.id])).toEqual({ n: 0 });
    expect((await valider(r.body.challenge, code)).status).toBe(401);                       // code à usage unique
    expect(mails(/code SMS/).length).toBe(1);                                               // alerte envoyée à l'élu
    expect((await evenements(EMAIL))).toEqual(['demande', 'code_envoye', 'code_valide']);
  });

  it('3 essais puis le code est brûlé ; expiration à 5 minutes ; un code de connexion par mail ne sert pas ici', async () => {
    const r = await oubli(EMAIL); const code = await codeSms();
    const faux = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3; i++) expect((await valider(r.body.challenge, faux)).status).toBe(401);
    expect((await valider(r.body.challenge, code)).status).toBe(401);                        // même le bon code : brûlé
    const r2 = await oubli(EMAIL);
    await env.db.run("UPDATE elu_codes SET expire_le = now() - interval '1 second' WHERE id = $1", [r2.body.challenge]);
    expect((await valider(r2.body.challenge, await codeSms())).status).toBe(401);
    expect((await evenements(EMAIL)).slice(-1)).toEqual(['code_expire']);
    // un défi de connexion par mail n'ouvre pas le canal SMS
    const c = await env.http().post('/api/v1/elus-auth/connexion').send({ email: EMAIL, motDePasse: PW, appareil: 'appareil-de-test-1' });
    expect((await valider(c.body.challenge, '123456')).status).toBe(401);
  });

  it('même réponse pour un compte inconnu ou sans mobile (pas d’énumération), sans envoyer de SMS ; tout est journalisé', async () => {
    const avant = (await env.db.get('SELECT count(*)::int AS n FROM sms_journal')).n;
    const inconnu = await oubli('personne@example.fr');
    expect(inconnu.status).toBe(200); expect(Object.keys(inconnu.body).sort()).toEqual(['challenge', 'expireDans']);
    const sans = await creer({ nom: 'Sansmobile', prenom: 'Luc', email: 'luc.sansmobile@example.fr' }); await activer(sans);
    expect((await oubli('luc.sansmobile@example.fr')).status).toBe(200);
    const faux = await creer({ nom: 'Fauxmobile', prenom: 'Ana', email: 'ana.faux@example.fr', mobile: '12345' }); await activer(faux);
    expect((await oubli('ana.faux@example.fr')).status).toBe(200);
    expect((await env.db.get('SELECT count(*)::int AS n FROM sms_journal')).n).toBe(avant);
    expect(await evenements('personne@example.fr')).toEqual(['demande', 'compte_inconnu']);
    expect(await evenements('luc.sansmobile@example.fr')).toEqual(['demande', 'sans_mobile']);
    expect((await valider(inconnu.body.challenge, '123456')).status).toBe(401);
    // élu désactivé : traité comme inconnu
    await as(admin).put(`${base()}/elus/${sans.id}`, { actif: false });
    await oubli('luc.sansmobile@example.fr');
    expect((await evenements('luc.sansmobile@example.fr')).slice(-1)).toEqual(['compte_inconnu']);
  });

  it('au plus 5 demandes par quart d’heure et par adresse : au-delà, plus de SMS', async () => {
    const e2 = await creer({ nom: 'Limite', prenom: 'Paul', email: 'paul.limite@example.fr', mobile: '06 00 00 00 01' }); await activer(e2);
    const avant = (await env.db.get('SELECT count(*)::int AS n FROM sms_journal')).n;
    for (let i = 0; i < 7; i++) expect((await oubli('paul.limite@example.fr')).status).toBe(200);
    expect((await env.db.get('SELECT count(*)::int AS n FROM sms_journal')).n - avant).toBe(5);
    expect((await evenements('paul.limite@example.fr')).filter((x) => x === 'limite').length).toBe(2);
  });

  it('journal des oublis pour l’administration : compteurs 24 h, réservé aux administrateurs / SCC, sans aucun code', async () => {
    expect((await as(t.dupont).get(E('/oublis'))).status).toBe(403);
    const j = (await as(t.martin).get(E('/oublis'))).body;
    expect(j.items.length).toBeGreaterThan(10);
    expect(j.dernieres24h).toMatchObject({ code_valide: 1, compte_inconnu: expect.any(Number), limite: 2 });
    expect(j.items.find((x) => x.evenement === 'code_valide')).toMatchObject({ elu: 'Sophie MARTIN', email: EMAIL });
    expect(JSON.stringify(j)).not.toMatch(/\b\d{6}\b/);
    const filtre = (await as(t.martin).get(E('/oublis?evenement=limite'))).body.items;
    expect(filtre.length).toBe(2); expect(filtre.every((x) => x.evenement === 'limite')).toBe(true);
    expect((await as(t.martin).get(E('/oublis?evenement=n_importe_quoi'))).status).toBe(400);
  });
});

describe('passerelle SMS', () => {
  it('configuration réservée à l’administrateur, jeton chiffré et jamais renvoyé ; le mode HTTP masque le texte du message', async () => {
    expect((await as(t.martin).put(E('/sms'), { mode: 'http' })).status).toBe(403);
    expect((await as(admin).put(E('/sms'), { mode: 'http' })).status).toBe(400);            // URL obligatoire
    const r = await as(admin).put(E('/sms'), { mode: 'http', url: 'https://sms.example.test/send', expediteur: 'Ivry', jeton: 'jeton-secret-tres-long' });
    expect(r.status).toBe(200); expect(r.body.config).toMatchObject({ mode: 'http', url: 'https://sms.example.test/send', jetonDefini: true });
    expect(JSON.stringify(r.body)).not.toMatch(/jeton-secret/);
    expect(String((await env.db.get("SELECT value FROM settings WHERE key = 'sms.jeton'")).value)).not.toMatch(/jeton-secret/);
    const appels = [];
    const sms = createSms({ db: env.db, config: env.config, settings: env.c.settings, http: { post: async (url, corps, opts) => { appels.push({ url, corps, opts }); return { status: 200 }; } } });
    await sms.envoyer({ organismeId: ville.id, mobile: '06 12 34 56 78', message: 'Code 654321 "test"' });
    expect(appels[0]).toMatchObject({ url: 'https://sms.example.test/send', corps: { recipient: '+33612345678', message: 'Code 654321 "test"' } });
    expect(appels[0].opts.headers.Authorization).toBe('Bearer jeton-secret-tres-long');
    const j = (await as(admin).get(E('/sms'))).body;
    expect(j.journal[0]).toMatchObject({ mode: 'http', statut: 'envoye', message: '(masqué)', mobile: '+33 •• •• •• 78' });
    // couverture des mobiles (Hub : champ téléphone ; la saisie locale a priorité ; un fixe ne compte pas)
    expect(j.couverture.total).toBeGreaterThan(0);
    expect(j.couverture.avecMobile + j.couverture.sansMobile.length).toBe(j.couverture.total);
    // échec de la passerelle : erreur claire, journal « echec »
    const ko = createSms({ db: env.db, config: env.config, settings: env.c.settings, http: { post: async () => ({ status: 503 }) } });
    await expect(ko.envoyer({ organismeId: ville.id, mobile: '06 12 34 56 78', message: 'x' })).rejects.toMatchObject({ status: 502 });
    expect((await as(admin).get(E('/sms'))).body.journal[0]).toMatchObject({ statut: 'echec', erreur: 'HTTP 503' });
    await as(admin).put(E('/sms'), { mode: 'simulation' });
  });

  it('normalisation des numéros', () => {
    const { normaliserMobile: n } = require('../../src/adapters/sms');
    expect(n('06 12 34 56 78')).toBe('+33612345678'); expect(n('+33 7 12 34 56 78')).toBe('+33712345678'); expect(n('0033612345678')).toBe('+33612345678');
    expect(n('+41 79 123 45 67')).toBe('+41791234567');
    expect(n('01 23 45 67 89')).toBeNull(); expect(n('12345')).toBeNull(); expect(n('')).toBeNull();
  });
});
