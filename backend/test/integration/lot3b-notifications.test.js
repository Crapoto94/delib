const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');
const { addBusinessDays, nextSendWindow, parisParts } = require('../../src/shared/time');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubrique; let N;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;

async function readyActe({ tok = t.dupont, titre = 'Subvention Les Amis du Sport' } = {}) {
  const a = (await as(tok).post(`${base()}/actes`, { typeId: typeDelib.id, titre })).body;
  await as(tok).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubrique.id, incidenceFinanciere: false, rapporteurId: 1 });
  const texts = (await as(tok).get(`${A(a.id)}/textes`)).body.items;
  for (const x of texts) await as(tok).put(`${A(a.id)}/textes/${x.id}`, { markdown: `Texte ${x.kind}.`, baseVersion: x.version });
  return a;
}
const submit = async (opts) => { const a = await readyActe(opts); await as(t.dupont).post(`${A(a.id)}/envoi`); return a; };
const center = async (tok) => (await as(tok).get(`${base()}/notifications`)).body;
const logOf = (acteId, extra = '') => env.db.all(`SELECT * FROM notification_log WHERE acte_id = $1 ${extra} ORDER BY id`, [acteId]);
const flush = () => N.processQueue({ now: new Date(Date.now() + 5000) });

beforeAll(async () => {
  env = await createTestEnv();
  N = env.c.notifications;
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
});
afterAll(async () => { await env.close(); });

describe('règles fournies', () => {
  it('amorce le jeu de règles de la plateforme, avec familles et obligations', async () => {
    const r = (await as(admin).get(`${base()}/notifications/regles`)).body;
    const codes = r.items.map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(['etape.arrivee', 'acte.refuse', 'relance.etape', 'relance.retour_redacteur', 'relance.brouillon', 'commentaire.mention']));
    expect(r.items.find((x) => x.code === 'etape.arrivee')).toMatchObject({ mandatory: true, origin: 'plateforme' });
    expect(Object.keys(r.families)).toEqual(expect.arrayContaining(['validation', 'discussion']));
  });

  it('réserve la lecture des règles à l\'administration', async () => {
    expect((await as(t.dupont).get(`${base()}/notifications/regles`)).status).toBe(403);
  });
});

describe('notifications événementielles', () => {
  let a;
  it('prévient le valideur (centre + mail en file) quand l\'acte arrive à son étape', async () => {
    a = await submit({ titre: 'Événement arrivée' });
    const c = await center(t.durand);
    expect(c.unread).toBeGreaterThan(0);
    const n = c.items.find((i) => i.acteId === a.id);
    expect(n).toMatchObject({ family: 'validation', read: false });
    expect(n.title).toContain('À valider');
    expect(n.link).toContain(`/actes/${a.id}`);
    const rows = await logOf(a.id, "AND recipient = 'durand'");
    expect(rows[0]).toMatchObject({ status: 'pending', email: 'claire.durand@ivry.test' });
  });

  it('envoie le mail via le port (pied de page paramétré, jamais en dur)', async () => {
    await as(admin).put(`${base()}/settings/mail.footer1`, { value: 'Ville d\'Ivry' }).catch(() => {});
    const before = env.mail.state.sent.length;
    const st = await flush();
    expect(st.sent).toBeGreaterThan(0);
    const m = env.mail.state.sent.slice(before).find((x) => x.to === 'claire.durand@ivry.test');
    expect(m.subject).toContain('À valider');
    expect(m.html).toContain('Ouvrir dans IvryDélib');
    expect(m.footer.line1).toBe("Ville d'Ivry");
    expect((await logOf(a.id, "AND recipient = 'durand'"))[0].status).toBe('sent');
  });

  it('marque comme lu, un par un ou tout d\'un coup', async () => {
    const c = await center(t.durand);
    const one = c.items[0];
    expect((await as(t.durand).post(`${base()}/notifications/${one.id}/lue`)).body.read).toBe(true);
    expect((await as(t.dupont).post(`${base()}/notifications/${one.id}/lue`)).status).toBe(404); // pas la sienne
    await as(t.durand).post(`${base()}/notifications/lues`);
    expect((await center(t.durand)).unread).toBe(0);
  });

  it('prévient le rédacteur d\'une demande de modification, avec le motif', async () => {
    await as(t.durand).post(`${A(a.id)}/refus`, { target: 'first', motif: 'Précisez le montant de la subvention' });
    const n = (await center(t.dupont)).items.find((i) => i.title.includes('Modification demandée'));
    expect(n.body).toContain('Précisez le montant');
    expect(n.body).toContain('Durand Claire');
  });

  it('prévient la personne mentionnée (et pas l\'auteur)', async () => {
    await as(t.dupont).post(`${A(a.id)}/commentaires`, { body: 'Merci de regarder @leroy et @dupont' });
    const l = (await center(t.leroy)).items.find((i) => i.family === 'discussion');
    expect(l.title).toContain('vous a mentionné');
    expect((await center(t.dupont)).items.some((i) => i.family === 'discussion')).toBe(false);
  });

  it('prévient le délégué d\'une délégation', async () => {
    const d = await as(t.durand).post(`${base()}/delegations`, { delegue: 'moreau', scope: 'all' });
    expect((await center(t.moreau)).items.some((i) => i.family === 'delegation')).toBe(true);
    await as(t.durand).del(`${base()}/delegations/${d.body.id}`);
  });
});

describe('préférences, sourdine, relance manuelle', () => {
  it('une famille facultative peut passer en « désactivé » ; les obligatoires non', async () => {
    const list = (await as(t.leroy).get(`${base()}/notifications/preferences`)).body.items;
    expect(list.find((f) => f.family === 'validation')).toMatchObject({ mandatory: true, mode: 'immediate' });
    expect((await as(t.leroy).put(`${base()}/notifications/preferences`, { family: 'validation', mode: 'off' })).status).toBe(400);
    expect((await as(t.leroy).put(`${base()}/notifications/preferences`, { family: 'discussion', mode: 'off' })).status).toBe(200);
    const a = await submit({ titre: 'Préférences' });
    await as(t.dupont).post(`${A(a.id)}/commentaires`, { body: 'Avis @leroy ?' });
    expect((await center(t.leroy)).items.some((i) => i.acteId === a.id && i.family === 'discussion')).toBe(false);
    const row = (await logOf(a.id, "AND recipient = 'leroy'"))[0];
    expect(row).toMatchObject({ status: 'skipped', skip_reason: 'pref_off' });
    await as(t.leroy).put(`${base()}/notifications/preferences`, { family: 'discussion', mode: 'immediate' });
  });

  it('la sourdine personnelle est bornée ; la suspension générale est réservée aux responsables', async () => {
    const a = await submit({ titre: 'Sourdine' });
    expect((await as(t.durand).post(`${A(a.id)}/notifications/sourdine`, { days: 60 })).status).toBe(400);
    expect((await as(t.durand).post(`${A(a.id)}/notifications/sourdine`, { days: 3, scope: 'all' })).status).toBe(403);
    const m = await as(t.durand).post(`${A(a.id)}/notifications/sourdine`, { days: 3, reason: 'en congés' });
    expect(m.status).toBe(201);
    await as(t.dupont).post(`${A(a.id)}/commentaires`, { body: 'Ping @durand' });
    const list = (await as(t.martin).get(`${A(a.id)}/notifications/sourdines`)).body.items;
    expect(list[0]).toMatchObject({ username: 'durand', reason: 'en congés' }); // visible du SCC
    expect((await logOf(a.id, "AND recipient = 'durand' AND skip_reason = 'muted'")).length).toBeGreaterThan(0);
    expect((await as(t.leroy).del(`${A(a.id)}/notifications/sourdine/${m.body.id}`)).status).toBe(403);
    expect((await as(t.durand).del(`${A(a.id)}/notifications/sourdine/${m.body.id}`)).status).toBe(200);
    const s = await as(t.martin).post(`${A(a.id)}/notifications/sourdine`, { days: 1, scope: 'all', reason: 'gel' });
    expect(s.status).toBe(201);
  });

  it('« relancer maintenant » : directeur, SCC, DGS, administrateur seulement', async () => {
    const a = await submit({ titre: 'Relance manuelle' });
    expect((await as(t.dupont).post(`${A(a.id)}/relance`, { message: 'vite' })).status).toBe(403);
    const r = await as(t.martin).post(`${A(a.id)}/relance`, { message: 'Merci de traiter avant jeudi' });
    expect(r.body.recipients).toEqual(['durand']);
    const n = (await center(t.durand)).items.find((i) => i.acteId === a.id && i.title.startsWith('Relance'));
    expect(n.body).toContain('avant jeudi');
    // passe outre la sourdine
    await as(t.martin).post(`${A(a.id)}/notifications/sourdine`, { days: 1, scope: 'all' });
    expect((await as(t.martin).post(`${A(a.id)}/relance`, {})).status).toBe(200);
  });
});

describe('relances temporelles (paliers, jours ouvrés)', () => {
  let a; let arrival;
  beforeAll(async () => {
    a = await submit({ titre: 'Relances temporelles' });
    // heure d'arrivée figée à 9 h UTC : les tests de paliers ne dépendent plus de l'heure à laquelle ils tournent
    await env.db.query("UPDATE step_instances SET arrived_at = date_trunc('day', arrived_at) + interval '9 hours', due_at = date_trunc('day', due_at) + interval '9 hours' WHERE acte_id = $1 AND status = 'current'", [a.id]);
    arrival = new Date((await env.db.get("SELECT arrived_at FROM step_instances WHERE acte_id = $1 AND status = 'current'", [a.id])).arrived_at);
  });
  const only = (items) => items.filter((i) => i.acteId === a.id);

  it('rien avant le premier palier', async () => {
    const r = await as(t.martin).post(`${base()}/notifications/simulation`, { at: new Date(arrival.getTime() + 3600e3).toISOString() });
    expect(only(r.body.items)).toHaveLength(0);
  });

  it('R1 à mi-SLA : seul le valideur est relancé', async () => {
    const at = addBusinessDays(arrival, 2); at.setUTCHours(at.getUTCHours() + 1);
    const r = await as(t.martin).post(`${base()}/notifications/simulation`, { at: at.toISOString() });
    const it = only(r.body.items);
    expect(it.map((i) => i.recipient)).toEqual(['durand']);
    expect(it[0]).toMatchObject({ rule: 'relance.etape', pallier: 'R1' });
  });

  it('R4 : escalade au supérieur, au directeur, au SCC et au DGS — un seul palier émis, pas une rafale', async () => {
    const at = addBusinessDays(arrival, 15);
    const r = await as(t.martin).post(`${base()}/notifications/simulation`, { at: at.toISOString() });
    const it = only(r.body.items);
    expect(new Set(it.map((i) => i.pallier))).toEqual(new Set(['R4']));
    expect(it.map((i) => i.recipient).sort()).toEqual(['boot', 'durand', 'leroy', 'martin']);
  });

  it('la simulation n\'écrit rien', async () => {
    const before = (await logOf(a.id)).length;
    await N.simulate(ville.id, { at: addBusinessDays(arrival, 15).toISOString() });
    expect((await logOf(a.id)).length).toBe(before);
  });

  it('émet la relance une seule fois (idempotence), différée dans la plage 8 h – 18 h ouvrée', async () => {
    const at = addBusinessDays(arrival, 2); at.setUTCHours(20, 0, 0, 0); // soir : hors plage (R1 est dû, R2 pas encore)
    const first = await N.runTemporal(ville.id, { now: at });
    expect(first.filter((i) => i.acteId === a.id)).toHaveLength(1);
    const again = await N.runTemporal(ville.id, { now: new Date(at.getTime() + 3600e3) });
    expect(again.filter((i) => i.acteId === a.id)).toHaveLength(0);
    const row = (await logOf(a.id, "AND rule_code = 'relance.etape'"))[0];
    expect(row.status).toBe('pending');
    const p = parisParts(new Date(row.next_attempt_at));
    expect(p.h).toBe(8);
    expect(new Date(row.next_attempt_at).getTime()).toBe(nextSendWindow(at).getTime());
    // avant l'ouverture de la plage : rien ne part ; à l'ouverture : envoyé
    await N.processQueue({ now: at });
    expect((await env.db.get('SELECT status FROM notification_log WHERE id = $1', [row.id])).status).toBe('pending');
    await N.processQueue({ now: new Date(row.next_attempt_at) });
    expect((await env.db.get('SELECT status FROM notification_log WHERE id = $1', [row.id])).status).toBe('sent');
  });

  it('s\'arrête dès que l\'action est faite', async () => {
    await as(t.durand).post(`${A(a.id)}/validation`, {});
    const at = addBusinessDays(arrival, 1); // jamais dû pour la nouvelle étape
    const r = await N.simulate(ville.id, { at: at.toISOString() });
    expect(r.items.filter((i) => i.acteId === a.id && i.pallier && i.recipient === 'durand')).toHaveLength(0);
  });

  it('relance le rédacteur d\'un acte renvoyé, puis son chef de service (J+5)', async () => {
    const b = await submit({ titre: 'Renvoi' });
    await as(t.durand).post(`${A(b.id)}/refus`, { target: 'first', motif: 'À reprendre entièrement' });
    const ret = new Date((await env.db.get("SELECT arrived_at FROM step_instances WHERE acte_id = $1 AND status = 'current'", [b.id])).arrived_at);
    const j2 = (await N.simulate(ville.id, { at: addBusinessDays(ret, 2).toISOString() })).items.filter((i) => i.acteId === b.id);
    expect(j2.map((i) => i.recipient)).toEqual(['dupont']);
    const j5 = (await N.simulate(ville.id, { at: addBusinessDays(ret, 5).toISOString() })).items.filter((i) => i.acteId === b.id);
    expect(j5.map((i) => i.recipient).sort()).toEqual(['dupont', 'durand']);
  });

  it('relance un brouillon oublié 10 jours ouvrés après sa dernière modification', async () => {
    const d = await readyActe({ titre: 'Brouillon oublié' });
    const upd = new Date((await env.db.get('SELECT updated_at FROM actes WHERE id = $1', [d.id])).updated_at);
    expect((await N.simulate(ville.id, { at: addBusinessDays(upd, 9).toISOString() })).items.some((i) => i.acteId === d.id)).toBe(false);
    const r = (await N.simulate(ville.id, { at: addBusinessDays(upd, 10).toISOString() })).items.filter((i) => i.acteId === d.id);
    expect(r.map((i) => [i.recipient, i.rule])).toEqual([['dupont', 'relance.brouillon']]);
  });
});

describe('fiabilité de l\'envoi', () => {
  const rule = { code: 'test.fiab', family: 'suivi', mandatory: true, channels: ['inapp', 'mail'], subject: 'Sujet {n}', body: 'Corps {n}' };
  const push = (usernames, n, key) => N.deliver({ orgId: ville.id, rule, acte: null, usernames: new Set(usernames), vars: { n }, keyBase: key, immediate: true, at: new Date(Date.now() - 1000) });

  const clear = () => env.db.query("UPDATE notification_log SET status = 'sent' WHERE status = 'pending'");

  it('temporise après un échec puis renvoie ; abandonne après 6 tentatives', async () => {
    await clear();
    await push(['petit'], 'A', 'fiab:1');
    env.mail.failNext(1);
    const s1 = await N.processQueue({});
    expect(s1.retried).toBe(1);
    const row = await env.db.get("SELECT * FROM notification_log WHERE dedupe_key = 'fiab:1:petit'");
    expect(row).toMatchObject({ status: 'pending', attempts: 1 });
    expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 5 * 60000);
    expect((await N.processQueue({})).sent).toBe(0); // pas encore l'heure
    expect((await N.processQueue({ now: new Date(Date.now() + 3600e3) })).sent).toBe(1);

    await push(['petit'], 'B', 'fiab:2');
    env.mail.failNext(50);
    let now = Date.now();
    for (let i = 0; i < 6; i++) { now += 7 * 3600e3; await N.processQueue({ now: new Date(now) }); }
    env.mail.failNext(0);
    expect(await env.db.get("SELECT status, attempts FROM notification_log WHERE dedupe_key = 'fiab:2:petit'")).toMatchObject({ status: 'failed', attempts: 6 });
  });

  it('idempotence : la même clé ne produit jamais deux messages', async () => {
    await push(['nouveau'], 'C', 'fiab:3');
    await push(['nouveau'], 'C', 'fiab:3');
    expect((await env.db.all("SELECT 1 FROM notification_log WHERE dedupe_key = 'fiab:3:nouveau'")).length).toBe(1);
    expect((await center(t.nouveau)).items.filter((i) => i.title === 'Sujet C')).toHaveLength(1);
  });

  it('regroupe plusieurs messages d\'un destinataire en un seul mail (anti-spam)', async () => {
    await clear();
    await push(['leroy'], 'D1', 'fiab:4'); await push(['leroy'], 'D2', 'fiab:5'); await push(['leroy'], 'D3', 'fiab:6');
    const before = env.mail.state.sent.length;
    const st = await N.processQueue({});
    expect(env.mail.state.sent.length - before).toBe(1);
    expect(st.grouped).toBe(3);
    const m = env.mail.state.sent.at(-1);
    expect(m.subject).toBe('3 notifications IvryDélib');
    expect(m.html).toContain('Sujet D2');
  });

  it('plafond quotidien : au-delà, les messages passent en synthèse', async () => {
    await clear();
    await env.db.query("INSERT INTO settings (scope, scope_id, key, value, updated_by) VALUES ('organisme', $1, 'notifications.plafond_quotidien', '1'::jsonb, 'test') ON CONFLICT (scope, scope_id, key) DO UPDATE SET value = '1'::jsonb", [String(ville.id)]);
    await push(['durand'], 'E', 'fiab:7');
    await N.processQueue({});
    await push(['durand'], 'F', 'fiab:8');
    await N.processQueue({});
    const row = await env.db.get("SELECT status, skip_reason FROM notification_log WHERE dedupe_key = 'fiab:8:durand'");
    expect(row).toMatchObject({ status: 'digest', skip_reason: 'plafond' });
    await env.db.query("DELETE FROM settings WHERE key = 'notifications.plafond_quotidien'");
  });

  it('mode recette : tous les mails sont redirigés vers l\'adresse de test', async () => {
    const prev = env.c.config.mailRedirectTo;
    const cfg = env.c.config; const patched = Object.create(cfg); Object.defineProperty(patched, 'mailRedirectTo', { value: 'recette@ivry.test' });
    const N2 = require('../../src/modules/notifications/notifications.service').createNotifications({ ...env.c, config: patched, bus: { on() {}, emit() {} }, log: env.c.log });
    await N2.sendMail(ville.id, 'vrai.directeur@ivry.test', 'Sujet réel', 'Corps');
    const m = env.mail.state.sent.at(-1);
    expect(m.to).toBe('recette@ivry.test');
    expect(m.subject).toContain('vrai.directeur@ivry.test');
    expect(prev ?? null).toBeNull();
  });

  it('alerte l\'administrateur si le taux d\'échec dépasse le seuil', async () => {
    await as(admin).post(`${base()}/roles`, { username: 'moreau', role: 'org_admin' });
    await env.db.query("INSERT INTO notification_log (organisme_id, recipient, subject, body, status) SELECT $1, 'x', 's', 'b', 'failed' FROM generate_series(1, 300)", [ville.id]);
    expect(await N.checkFailureRate(ville.id)).toBe(true);
    expect((await center(t.moreau)).items.some((i) => i.title.includes('en échec'))).toBe(true);
    expect(await N.checkFailureRate(ville.id)).toBe(true); // rappelé, mais idempotent par jour
    expect((await center(t.moreau)).items.filter((i) => i.title.includes('en échec'))).toHaveLength(1);
  });
});

describe('synthèse quotidienne', () => {
  it('envoie une synthèse à 7 h 30 les jours ouvrés, une seule fois par jour', async () => {
    const a = await submit({ titre: 'Pour la synthèse' });
    const monday = new Date('2026-09-21T05:00:00Z'); // 7 h heure de Paris : trop tôt
    expect((await N.sendDigests(ville.id, { now: monday })).sent).toBe(0);
    const before = env.mail.state.sent.length;
    const r = await N.sendDigests(ville.id, { now: new Date('2026-09-21T06:00:00Z') }); // 8 h
    expect(r.sent).toBeGreaterThan(0);
    const mails = env.mail.state.sent.slice(before);
    const dur = mails.find((m) => m.to === 'claire.durand@ivry.test');
    expect(dur.subject).toContain('Votre synthèse');
    expect(dur.html).toContain('Pour la synthèse');
    expect((await N.sendDigests(ville.id, { now: new Date('2026-09-21T09:00:00Z') })).sent).toBe(0);
    expect((await N.sendDigests(ville.id, { now: new Date('2026-09-19T09:00:00Z') })).sent).toBe(0); // samedi
    void a;
  });
});

describe('administration', () => {
  it('surcharge une règle pour l\'organisme (audité), la prévisualise, puis la réinitialise', async () => {
    const put = await as(admin).put(`${base()}/notifications/regles/etape.arrivee`, { subject: 'Nouvel acte : {titre}', body: 'Bonjour, {titre} vous attend. {lien}' });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ origin: 'organisme', subject: 'Nouvel acte : {titre}' });
    const audit = await env.db.get("SELECT before, after FROM audit_log WHERE action = 'notification.rule.update' ORDER BY id DESC LIMIT 1");
    expect(audit.before.subject).toBe('À valider : {titre}');
    expect(audit.after.subject).toBe('Nouvel acte : {titre}');
    const prev = await as(admin).post(`${base()}/notifications/regles/etape.arrivee/apercu`, {});
    expect(prev.body.subject).toBe("Nouvel acte : Attribution d'une subvention");
    expect(prev.body.variables).toContain('titre');
    expect((await as(admin).put(`${base()}/notifications/regles/etape.arrivee`, { enabled: false })).status).toBe(400); // obligatoire
    expect((await as(admin).put(`${base()}/notifications/regles/nexiste.pas`, { subject: 'xx' })).status).toBe(404);
    const a = await submit({ titre: 'Règle surchargée' });
    expect((await center(t.durand)).items.find((i) => i.acteId === a.id).title).toBe('Nouvel acte : Règle surchargée');
    const reset = await as(admin).del(`${base()}/notifications/regles/etape.arrivee`);
    expect(reset.body.origin).toBe('plateforme');
  });

  it('envoie un mail de test à l\'administrateur', async () => {
    const before = env.mail.state.sent.length;
    const r = await as(t.martin).post(`${base()}/notifications/regles/acte.refuse/test`, {});
    expect(r.status).toBe(200);
    expect(env.mail.state.sent.length).toBe(before + 1);
    expect(env.mail.state.sent.at(-1).subject).toMatch(/^\[TEST\]/);
  });

  it('journal filtrable et tableau de bord', async () => {
    const j = (await as(t.martin).get(`${base()}/notifications/journal?recipient=durand&status=sent`)).body;
    expect(j.total).toBeGreaterThan(0);
    expect(j.items.every((i) => i.recipient === 'durand' && i.status === 'sent')).toBe(true);
    expect((await as(t.dupont).get(`${base()}/notifications/journal`)).status).toBe(403);
    const d = (await as(t.martin).get(`${base()}/notifications/tableau`)).body;
    expect(d.last7Days.sent).toBeGreaterThan(0);
    expect(d).toHaveProperty('blocked');
    expect(d).toHaveProperty('latestHolders');
  });

  it('gère les jours fériés : génération française, calcul des jours ouvrés', async () => {
    const g = await as(admin).post(`${base()}/calendrier/jours-feries/generer`, { year: 2027 });
    const days = g.body.items.map((h) => h.day);
    expect(days).toEqual(expect.arrayContaining(['2027-01-01', '2027-03-29', '2027-05-06', '2027-05-17', '2027-07-14', '2027-12-25'])); // Pâques 2027 = 28 mars
    const add = await as(admin).post(`${base()}/calendrier/jours-feries`, { day: '2027-06-11', label: 'Pont' });
    expect(add.status).toBe(201);
    const hol = new Set(days.concat('2027-06-11'));
    expect(addBusinessDays(new Date('2027-06-10T09:00:00Z'), 1, hol).toISOString().slice(0, 10)).toBe('2027-06-14');
    expect((await as(admin).del(`${base()}/calendrier/jours-feries/${add.body.id}`)).status).toBe(204);
    expect((await as(t.dupont).post(`${base()}/calendrier/jours-feries`, { day: '2027-06-12' })).status).toBe(403);
  });
});

describe('planificateur', () => {
  it('un tick enchaîne relances, synthèses et file d\'envoi sous verrou', async () => {
    const r = await env.c.scheduler.tick(new Date());
    expect(r).toHaveProperty('relances');
    expect(r.envois).toHaveProperty('sent');
  });

  it('un seul exécutant à la fois', async () => {
    const [x, y] = await Promise.all([env.c.scheduler.tick(new Date()), env.c.scheduler.tick(new Date())]);
    expect([x, y].some((z) => z.skipped)).toBe(true);
  });
});
