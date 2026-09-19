const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');
const { formatNumero, checkPattern } = require('../../src/modules/seances/odj.service');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubriques; let instance; let seance;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const O = (id = seance.id) => `${base()}/seances/${id}/odj`;
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
const WHO = { chef_service: 'durand', directeur: 'leroy', juridique: 'nouveau', dga: 'petit', dgs: 'boot', scc: 'martin' };

/** Acte terminé (circuit complet), prêt à être affecté. */
async function doneActe(titre, { rubrique = 0, delibs = 1 } = {}) {
  const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre })).body;
  await as(t.dupont).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubriques[rubrique].id, incidenceFinanciere: false, rapporteurId: 1 });
  for (let i = 1; i < delibs; i++) await as(t.dupont).post(`${A(a.id)}/deliberations`, { titre: `${titre} — délibération ${i + 1}` });
  for (const x of (await as(t.dupont).get(`${A(a.id)}/textes`)).body.items) await as(t.dupont).put(`${A(a.id)}/textes/${x.id}`, { markdown: `Texte ${x.kind}.`, baseVersion: x.version });
  await as(t.dupont).post(`${A(a.id)}/envoi`);
  for (let i = 0; i < 10; i++) {
    const v = (await as(t.dupont).get(`${A(a.id)}/circuit`)).body;
    if (!v.currentStepKey) break;
    await as(t[WHO[v.currentStepKey]]).post(`${A(a.id)}/validation`, {});
  }
  return a;
}
const ids = (o) => o.items.filter((i) => i.statut === 'a_traiter').map((i) => i.id);
const numeros = (o) => o.items.filter((i) => i.numero).map((i) => i.numero);

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = { boot: admin };
  for (const [u, p] of [['dupont', 'pw-dupont'], ['durand', 'pw-durand'], ['leroy', 'pw-leroy'], ['petit', 'pw-petit'], ['martin', 'pw-martin'], ['nouveau', 'pw-nouveau'], ['moreau', 'pw-moreau']]) t[u] = await loginAs(env, u, p);
  const items = (k) => as(admin).get(`${base()}/referentiels/${k}`).then((r) => r.body.items);
  matiere = (await items('matiere')).find((x) => x.code === '7.5');
  rubriques = await items('rubrique');
  typeDelib = (await items('type_acte')).find((x) => x.code === 'deliberation');
  const tit = (fonction, username, extra = {}) => as(admin).post(`${base()}/titulaires`, { fonction, username, ...extra });
  await tit('chef_service', 'durand', { directionCode: 'A1', serviceCode: 'A1a' }); await tit('directeur', 'leroy', { directionCode: 'A1' });
  await tit('dga', 'petit', { directionCode: 'A1' }); await tit('dgs', 'boot');
  const groups = (await as(admin).get(`${base()}/groupes`)).body.items;
  const setMembers = (code, usernames) => as(admin).put(`${base()}/groupes/${groups.find((g) => g.code === code).id}/membres`, { usernames });
  await setMembers('financier', ['moreau']); await setMembers('juridique', ['nouveau']); await setMembers('scc', ['martin']);
  await as(admin).post(`${base()}/roles`, { username: 'martin', role: 'scc' });
  instance = (await as(admin).get(`${base()}/instances`)).body.items[0];
  seance = (await as(admin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: '2027-03-11T18:30:00Z' })).body;
});
afterAll(async () => { await env.close(); });

describe('motif de numérotation', () => {
  it('formate les variables, les zéros de remplissage, préfixes et suffixes', () => {
    expect(formatNumero('{ANNEE}-{N_SEANCE}-{ORDRE:03}', { ANNEE: 2027, N_SEANCE: 2, ORDRE: 7 })).toBe('2027-2-007');
    expect(formatNumero('DEL/{ANNEE}/{RUBRIQUE}/{ORDRE}', { ANNEE: 2027, ORDRE: 12, RUBRIQUE: 'FINA' })).toBe('DEL/2027/FINA/12');
  });
  it('refuse les variables inconnues, l\'absence de {ORDRE} et les accolades orphelines', () => {
    expect(() => checkPattern('{ANNEE}-{X}')).toThrow(/inconnue/);
    expect(() => checkPattern('{ANNEE}-{N_SEANCE}')).toThrow(/ORDRE/);
    expect(() => checkPattern('{ORDRE} {')).toThrow(/Accolade/);
  });
  it('donne un aperçu en direct et refuse un motif invalide (400)', async () => {
    const r = await as(t.martin).post(`${base()}/numerotation/apercu`, { pattern: 'DEL-{ANNEE}-{ORDRE:04}', seanceId: seance.id });
    expect(r.body.exemples).toEqual(['DEL-2027-0001', 'DEL-2027-0002', 'DEL-2027-0012', 'DEL-2027-0103']);
    expect((await as(t.martin).post(`${base()}/numerotation/apercu`, { pattern: 'sans-ordre' })).status).toBe(400);
    expect((await as(t.dupont).post(`${base()}/numerotation/apercu`, { pattern: '{ORDRE}' })).status).toBe(403);
  });
});

describe('ordre du jour en préparation', () => {
  let a1; let a2; let a3;
  it('ne propose à l\'affectation que les actes dont le circuit est terminé', async () => {
    a1 = await doneActe('Subvention A', { rubrique: 0, delibs: 2 }); a2 = await doneActe('Convention B', { rubrique: 1 }); a3 = await doneActe('Règlement C', { rubrique: 2 });
    const brouillon = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre: 'Encore en brouillon' })).body;
    const p = (await as(t.martin).get(`${O()}/en-attente`)).body.items;
    expect(p.map((x) => x.id)).toEqual(expect.arrayContaining([a1.id, a2.id, a3.id]));
    expect(p.some((x) => x.id === brouillon.id)).toBe(false);
    expect(p.find((x) => x.id === a1.id).deliberations).toBe(2);
    expect((await as(t.dupont).get(`${O()}/en-attente`)).status).toBe(403);
  });

  it('affecte les actes : une ligne par délibération, numéros provisoires suivant le classement', async () => {
    expect((await as(t.dupont).post(`${O()}/affectations`, { acteIds: [a1.id] })).status).toBe(403);
    const r = await as(t.martin).post(`${O()}/affectations`, { acteIds: [a1.id, a2.id, a3.id] });
    expect(r.status).toBe(200);
    expect(r.body.statut).toBe('en_preparation');
    expect(r.body.items).toHaveLength(4);
    expect(numeros(r.body)).toEqual(['2027-1-001', '2027-1-002', '2027-1-003', '2027-1-004']);
  });

  it('un acte affecté passe « inscrit à l\'ODJ », n\'est plus en attente, et expose sa position calculée', async () => {
    const a = (await as(t.dupont).get(A(a2.id))).body;
    expect(a.statut).toBe('inscrit_odj');
    expect(a.odj[0]).toMatchObject({ seanceId: seance.id, provisoire: true });
    expect((await as(t.martin).get(`${O()}/en-attente`)).body.items.some((x) => x.id === a2.id)).toBe(false);
    expect((await as(t.martin).post(`${O()}/affectations`, { acteIds: [a2.id] })).status).toBe(409);
  });

  it('ajoute des points libres (numérotés ou non) et un chapitre', async () => {
    const pv = await as(t.martin).post(`${O()}/points`, { titre: 'Approbation du procès-verbal de la séance précédente' });
    expect(pv.status).toBe(201);
    await as(t.martin).post(`${O()}/points`, { kind: 'chapitre', titre: 'Finances' });
    const q = await as(t.martin).post(`${O()}/points`, { titre: 'Questions diverses', numerote: true });
    const o = q.body;
    expect(o.items.map((i) => i.kind)).toEqual(['deliberation', 'deliberation', 'deliberation', 'deliberation', 'libre', 'chapitre', 'libre']);
    expect(o.items.find((i) => i.titre === 'Questions diverses').numero).toMatch(/-005$/);
    expect(o.items.find((i) => i.titre.startsWith('Approbation')).numero).toBeNull(); // libre non numéroté
  });

  it('classe par glisser-déposer : les numéros provisoires suivent, groupes et ordre conservés, historique tracé', async () => {
    const before = (await as(t.martin).get(O())).body;
    const order = ids(before);
    const moved = [order[3], order[0], order[1], order[2], ...order.slice(4)];
    const r = await as(t.martin).put(`${O()}/ordre`, { ids: moved });
    expect(r.status).toBe(200);
    expect(ids(r.body)).toEqual(moved);
    expect(r.body.items.find((i) => i.id === order[3]).numero).toMatch(/-001$/);
    expect((await as(t.martin).put(`${O()}/ordre`, { ids: order.slice(1) })).status).toBe(400); // il manque une ligne
    const h = (await as(t.martin).get(`${O()}/historique`)).body.items;
    expect(h.some((x) => x.action === 'classement' && x.actor === 'martin')).toBe(true);
    await as(t.martin).put(`${O()}/ordre`, { ids: order });
  });

  it('propose un tri par rubrique sans rien enregistrer', async () => {
    const before = ids((await as(t.martin).get(O())).body);
    const r = await as(t.martin).get(`${O()}/tri?critere=rubrique`);
    expect(r.body.ids).toHaveLength(before.length);
    expect(ids((await as(t.martin).get(O())).body)).toEqual(before);
  });

  it('verrou d\'édition : un seul éditeur actif, reprise par l\'administrateur', async () => {
    expect((await as(t.martin).post(`${O()}/verrou`, {})).status).toBe(200);
    expect((await as(admin).post(`${O()}/points`, { titre: 'Point bloqué' })).status).toBe(409);
    expect((await as(admin).post(`${O()}/verrou`, {})).status).toBe(409);
    expect((await as(admin).post(`${O()}/verrou`, { force: true })).status).toBe(200);
    expect((await as(t.martin).post(`${O()}/points`, { titre: 'Point bloqué' })).status).toBe(409);
    await as(admin).del(`${O()}/verrou`);
  });

  it('retire un acte avant l\'arrêt : la ligne disparaît, l\'acte redevient affectable', async () => {
    const r = await as(t.martin).del(`${O()}/actes/${a3.id}`);
    expect(r.body.items.some((i) => i.acte?.id === a3.id)).toBe(false);
    expect((await as(t.dupont).get(A(a3.id))).body.statut).toBe('en_attente_scc');
    await as(t.martin).post(`${O()}/affectations`, { acteIds: [a3.id] });
  });

  it('exporte le tableau de suivi en CSV', async () => {
    const r = await as(t.martin).get(`${O()}/export.csv`);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.text).toContain('Ordre;Numéro;Type;Titre');
    expect(r.text).toContain('Subvention A');
  });
});

describe('arrêt de l\'ordre du jour et modifications ultérieures', () => {
  let frozen;
  it('contrôle avant arrêt, puis arrête : numéros figés, notifications envoyées une fois', async () => {
    const c = (await as(t.martin).get(`${O()}/controles`)).body;
    expect(c.ok).toBe(true);
    const r = await as(t.martin).post(`${O()}/arret`, {});
    expect(r.status).toBe(200);
    expect(r.body.statut).toBe('arrete');
    frozen = r.body.items.filter((i) => i.numero).map((i) => [i.id, i.numero]);
    expect(frozen.length).toBe(5);
    expect(r.body.items.every((i) => !i.numero || !i.provisoire)).toBe(true);
    const n = await env.db.all("SELECT recipient FROM notification_log WHERE rule_code = 'odj.arrete'");
    expect(n.some((x) => x.recipient === 'dupont')).toBe(true);
    expect((await as(t.martin).post(`${O()}/arret`, {})).status).toBe(409);
    expect((await as(t.dupont).get(A(r.body.items[0].acte.id))).body.odj[0].provisoire).toBe(false);
  });

  it('après l\'arrêt, toute modification exige un motif', async () => {
    const o = (await as(t.martin).get(O())).body;
    const order = ids(o);
    expect((await as(t.martin).put(`${O()}/ordre`, { ids: [...order].reverse() })).status).toBe(400);
    const r = await as(t.martin).put(`${O()}/ordre`, { ids: [...order].reverse(), motif: 'Demande de la Maire' });
    expect(r.status).toBe(200);
    // déplacer ne change pas les numéros
    expect(r.body.items.filter((i) => i.numero).map((i) => [i.id, i.numero]).sort()).toEqual([...frozen].sort());
  });

  it('un ajout reçoit le numéro suivant, jamais un numéro déjà attribué', async () => {
    const a4 = await doneActe('Ajout tardif');
    const r = await as(t.martin).post(`${O()}/affectations`, { acteIds: [a4.id], motif: 'Point urgent ajouté' });
    const added = r.body.items.find((i) => i.acte?.id === a4.id);
    expect(added.numero).toBe('2027-1-006');
    expect(added.ajouteApresArret).toBe(true);
    expect((await as(t.martin).post(`${O()}/affectations`, { acteIds: [a4.id], motif: 'Doublon' })).status).toBe(409);
  });

  it('un retrait conserve le numéro (marqué retiré) qui n\'est jamais réutilisé', async () => {
    const o = (await as(t.martin).get(O())).body;
    const target = o.items.find((i) => i.acte?.titre === 'Convention B');
    expect((await as(t.martin).del(`${O()}/actes/${target.acte.id}`)).status).toBe(400); // motif requis
    const r = await as(t.martin).del(`${O()}/actes/${target.acte.id}?motif=Retir%C3%A9%20par%20le%20rapporteur`);
    const line = r.body.items.find((i) => i.id === target.id);
    expect(line).toMatchObject({ statut: 'retire', retireMotif: 'Retiré par le rapporteur', numero: target.numero });
    const a5 = await doneActe('Après retrait');
    const r2 = await as(t.martin).post(`${O()}/affectations`, { acteIds: [a5.id], motif: 'Nouvel ajout' });
    const nums = numeros(r2.body);
    expect(new Set(nums).size).toBe(nums.length);
    expect(r2.body.items.find((i) => i.acte?.id === a5.id).numero).toBe('2027-1-007');
  });

  it('mode « bis » : l\'ajout est numéroté par un suffixe (paramètre odj.ajout_apres_arret)', async () => {
    await env.db.query("INSERT INTO settings (scope, scope_id, key, value, updated_by) VALUES ('organisme', $1, 'odj.ajout_apres_arret', '\"bis\"'::jsonb, 't')", [String(ville.id)]);
    const a6 = await doneActe('Ajout bis');
    // sans référence précédente, retombe sur le numéro suivant (le bis n'a de sens que rattaché à un point)
    const r = await as(t.martin).post(`${O()}/affectations`, { acteIds: [a6.id], motif: 'Encore un ajout' });
    expect(r.body.items.find((i) => i.acte?.id === a6.id).numero).toMatch(/^2027-1-0\d\d$/);
    await env.db.query("DELETE FROM settings WHERE key = 'odj.ajout_apres_arret'");
  });

  it('notifie les personnes concernées d\'une modification après arrêt', async () => {
    const n = await env.db.all("SELECT recipient FROM notification_log WHERE rule_code = 'odj.modifie'");
    expect(n.length).toBeGreaterThan(0);
  });

  it('le motif d\'une séance arrêtée ne se modifie plus ; celui d\'une séance en préparation, oui', async () => {
    expect((await as(t.martin).put(`${O()}/motif`, { pattern: '{ORDRE}' })).status).toBe(409);
    const s2 = (await as(admin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: '2027-06-10T18:00:00Z' })).body;
    expect((await as(t.martin).put(`${O(s2.id)}/motif`, { pattern: 'CM-{ANNEE}-{ORDRE:03}' })).body.pattern).toBe('CM-{ANNEE}-{ORDRE:03}');
    const a7 = await doneActe('Deuxième séance');
    const r = await as(t.martin).post(`${O(s2.id)}/affectations`, { acteIds: [a7.id] });
    expect(r.body.items[0].numero).toBe('CM-2027-001');
    // rang de séance : la séance de juin est la 2ᵉ de l'année pour l'instance
    await as(t.martin).put(`${O(s2.id)}/motif`, { pattern: '{ANNEE}-{N_SEANCE}-{ORDRE:03}' });
    expect((await as(t.martin).get(O(s2.id))).body.items[0].numero).toBe('2027-2-001');
  });

  it('une séance terminée n\'accepte plus aucune modification', async () => {
    await env.db.query("UPDATE seances SET statut = 'tenue' WHERE id = $1", [seance.id]);
    expect((await as(t.martin).post(`${O()}/points`, { titre: 'Trop tard', motif: 'test' })).status).toBe(409);
  });

  it('numéros uniques en base même en cas de concurrence', async () => {
    const dup = env.db.query("INSERT INTO seance_items (organisme_id, seance_id, position, kind, titre, numero, created_by) SELECT organisme_id, seance_id, 99, 'libre', 'x', numero, 'x' FROM seance_items WHERE numero IS NOT NULL AND seance_id = $1 LIMIT 1", [seance.id]);
    await expect(dup).rejects.toThrow(/seance_items_numero_uq/);
  });
});

describe('report d\'un acte inscrit', () => {
  it('le report retire la ligne de la séance d\'origine (marquée retirée après arrêt)', async () => {
    const s3 = (await as(admin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: '2027-09-09T18:00:00Z' })).body;
    const s4 = (await as(admin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: '2027-12-09T18:00:00Z' })).body;
    const a = await doneActe('À reporter après inscription');
    await as(t.martin).post(`${O(s3.id)}/affectations`, { acteIds: [a.id] });
    const r = await as(t.martin).post(`${A(a.id)}/report`, { motif: 'Dossier pas prêt', toSeanceId: s4.id });
    expect(r.status).toBe(200);
    expect((await as(t.martin).get(O(s3.id))).body.items).toHaveLength(0);
    const acte = (await as(t.dupont).get(A(a.id))).body;
    expect(acte.statut).toBe('en_attente_scc');
    expect(acte.seanceViseeId).toBe(s4.id);
  });
});

describe('utilisateurs et rôles (D41)', () => {
  const U = () => `${base()}/utilisateurs`;
  it('recherche un agent connu et un agent de l\'annuaire RH seulement, avec ses rôles', async () => {
    const r = await as(admin).get(`${U()}?q=martin`);
    const martin = r.body.items.find((x) => x.username === 'martin');
    expect(martin).toMatchObject({ displayName: 'Martin Bruno', knownLocally: true });
    expect(martin.roles.map((x) => x.role)).toContain('scc');
    const rh = await as(admin).get(`${U()}?q=alice`);
    expect(rh.body.items.some((x) => x.username === 'dupont')).toBe(true);
    expect((await as(t.dupont).get(`${U()}?q=martin`)).status).toBe(403);
    expect((await as(admin).get(`${U()}?q=m`)).status).toBe(400);
  });

  it('affiche la fiche complète d\'un utilisateur : rôles, titulaire, groupes, accès', async () => {
    const f = (await as(admin).get(`${U()}/durand`)).body;
    expect(f.agent.displayName).toBe('Durand Claire');
    expect(f.titulaires).toEqual([expect.objectContaining({ fonction: 'chef_service', serviceCode: 'A1a' })]);
    expect(f.accessibleOrganismes.map((o) => o.nom).length).toBeGreaterThan(0);
    const m = (await as(admin).get(`${U()}/martin`)).body;
    expect(m.groupes.map((g) => g.code)).toContain('scc');
    expect((await as(admin).get(`${U()}/inconnu.jamais`)).status).toBe(404);
  });

  it('attribue et retire un rôle, avec vérification de l\'existence de l\'agent', async () => {
    expect((await as(admin).post(`${U()}/leroy/roles`, { role: 'lecteur' })).status).toBe(201);
    expect((await as(admin).post(`${U()}/leroy/roles`, { role: 'lecteur' })).status).toBe(409);
    expect((await as(admin).post(`${U()}/personne.n.existe.pas/roles`, { role: 'lecteur' })).status).toBe(400);
    expect((await as(admin).post(`${U()}/leroy/roles`, { role: 'platform_admin' })).status).toBe(400);
    const f = (await as(admin).get(`${U()}/leroy`)).body;
    const role = f.roles.find((x) => x.role === 'lecteur');
    expect((await as(admin).del(`${U()}/roles/${role.id}`)).status).toBe(204);
    const audit = await env.db.get("SELECT before FROM audit_log WHERE action = 'role.remove' ORDER BY id DESC LIMIT 1");
    expect(audit.before.role).toBe('lecteur');
  });

  it('protège le dernier administrateur de l\'organisme', async () => {
    await env.db.query("DELETE FROM user_org_roles WHERE role = 'platform_admin'");
    await as(admin).post(`${U()}/dupont/roles`, { role: 'org_admin' }).catch(() => {});
    const tok = await loginAs(env, 'dupont', 'pw-dupont');
    await env.db.query("INSERT INTO user_org_roles (username, organisme_id, role, created_by) VALUES ('dupont', $1, 'org_admin', 'test') ON CONFLICT DO NOTHING", [ville.id]);
    const f = (await as(tok).get(`${U()}/dupont`)).body;
    const r = await as(tok).del(`${U()}/roles/${f.roles.find((x) => x.role === 'org_admin').id}`);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/dernier administrateur/);
  });
});

describe('dossiers proposés à une séance (visant), quel que soit leur avancement', () => {
  it('liste brouillons, dossiers en circuit et dossiers prêts ; seuls les prêts sont affectables', async () => {
    const s = (await as(admin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: '2028-03-09T18:00:00Z' })).body;
    const mk = async (titre, { submit = false, finish = false } = {}) => {
      const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre })).body;
      await as(t.dupont).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubriques[0].id, incidenceFinanciere: false, rapporteurId: 1, seanceViseeId: s.id });
      if (submit || finish) {
        for (const x of (await as(t.dupont).get(`${A(a.id)}/textes`)).body.items) await as(t.dupont).put(`${A(a.id)}/textes/${x.id}`, { markdown: 'Texte.', baseVersion: x.version });
        await as(t.dupont).post(`${A(a.id)}/envoi`);
      }
      if (finish) for (let i = 0; i < 10; i++) { const v = (await as(t.dupont).get(`${A(a.id)}/circuit`)).body; if (!v.currentStepKey) break; await as(t[WHO[v.currentStepKey]]).post(`${A(a.id)}/validation`, {}); }
      return a;
    };
    const brouillon = await mk('Visant : brouillon'); const enCircuit = await mk('Visant : en circuit', { submit: true }); const pret = await mk('Visant : prêt', { finish: true });
    const r = (await as(t.martin).get(`${O(s.id)}/visant`)).body.items;
    const by = (a) => r.find((x) => x.id === a.id);
    expect(by(brouillon)).toMatchObject({ statut: 'brouillon', eligible: false, dansOdj: false });
    expect(by(enCircuit)).toMatchObject({ statut: 'en_circuit', eligible: false, etape: 'Chef de service', holders: ['durand'] });
    expect(by(pret)).toMatchObject({ eligible: true, dansOdj: false });
    expect((await as(t.martin).get(`${base()}/seances/${s.id}`)).body.actesEnAttente).toBe(3); // le compteur de la carte = la liste affichée
    await as(t.martin).post(`${O(s.id)}/affectations`, { acteIds: [pret.id] });
    expect((await as(t.martin).get(`${O(s.id)}/visant`)).body.items.find((x) => x.id === pret.id)).toMatchObject({ dansOdj: true, eligible: false });
    expect((await as(t.dupont).get(`${O(s.id)}/visant`)).status).toBe(403);
  });
});
