const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t; let typeDelib;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const base = (o = ville) => `/api/v1/organismes/${o.id}`;
const newActe = (extra = {}) => as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre: 'Subvention à l’association Les Amis du Sport', ...extra });
const champ = (body) => as(admin).post(`${base()}/champs`, { libelle: body.code, kind: 'texte', ...body });
const manque = async (id) => (await as(t.dupont).get(`${base()}/actes/${id}`)).body.completude.missing.map((m) => m.code);

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = {};
  for (const [u, p] of [['dupont', 'pw-dupont'], ['durand', 'pw-durand'], ['martin', 'pw-martin']]) t[u] = await loginAs(env, u, p);
  typeDelib = (await as(admin).get(`${base()}/referentiels/type_acte`)).body.items.find((x) => x.code === 'deliberation');
  await as(admin).post(`${base()}/titulaires`, { fonction: 'chef_service', username: 'durand', directionCode: 'A1', serviceCode: 'A1a' });
});
afterAll(async () => { await env.close(); });

describe('champs personnalisés (PAR-10)', () => {
  it('définition réservée à l’administrateur ; code et doublons contrôlés ; liste sans valeur refusée', async () => {
    expect((await as(t.dupont).post(`${base()}/champs`, { code: 'zone', libelle: 'Zone', kind: 'texte' })).status).toBe(403);
    expect((await champ({ code: 'Zone!', kind: 'texte' })).status).toBe(400);
    expect((await champ({ code: 'zone', libelle: 'Zone', kind: 'texte', ordre: 1 })).status).toBe(201);
    expect((await champ({ code: 'zone', libelle: 'Zone', kind: 'texte' })).status).toBe(409);
    expect((await champ({ code: 'priorite', libelle: 'Priorité', kind: 'liste', options: [] })).status).toBe(400);
    expect((await champ({ code: 'priorite', libelle: 'Priorité', kind: 'liste', options: [{ valeur: 'haute', libelle: 'Haute' }, { valeur: 'basse', libelle: 'Basse' }], ordre: 2 })).status).toBe(201);
    expect((await as(t.dupont).get(`${base()}/champs`)).body.items.map((c) => c.code)).toEqual(['zone', 'priorite']);
    expect((await as(t.dupont).get(`${base()}/champs/definitions`)).status).toBe(403);
  });

  it('valeurs validées côté serveur : type, liste, nombre, date, élu, oui/non', async () => {
    await champ({ code: 'montant_cible', libelle: 'Montant cible', kind: 'nombre' });
    await champ({ code: 'echeance', libelle: 'Échéance', kind: 'date' });
    await champ({ code: 'urgent', libelle: 'Urgent ?', kind: 'booleen' });
    await champ({ code: 'referent', libelle: 'Élu référent', kind: 'elu' });
    const a = (await newActe()).body;
    const put = (custom) => as(t.dupont).put(`${base()}/actes/${a.id}`, { custom });
    expect((await put({ priorite: 'moyenne' })).status).toBe(400);
    expect((await put({ montant_cible: 'beaucoup' })).status).toBe(400);
    expect((await put({ echeance: '31/12/2026' })).status).toBe(400);
    expect((await put({ urgent: 'oui' })).status).toBe(400);
    expect((await put({ referent: 999999 })).status).toBe(400);
    const ok = await put({ priorite: 'haute', montant_cible: '1500.5', echeance: '2026-12-31', urgent: true, zone: 'Centre-ville' });
    expect(ok.status).toBe(200); expect(ok.body.custom).toMatchObject({ priorite: 'haute', montant_cible: 1500.5, echeance: '2026-12-31', urgent: true, zone: 'Centre-ville' });
    // vider un champ le retire ; une clé sans définition est conservée telle quelle
    expect((await put({ priorite: 'haute', zone: '', note_libre: 'x' })).body.custom).toEqual({ priorite: 'haute', note_libre: 'x' });
  });

  it('la fiche renvoie les champs applicables avec leur valeur, leur visibilité et mon droit de saisie', async () => {
    const a = (await newActe({ custom: { zone: 'Nord' } })).body;
    const f = (await as(t.dupont).get(`${base()}/actes/${a.id}`)).body.champs;
    expect(f.map((c) => c.code)).toEqual(expect.arrayContaining(['zone', 'priorite']));
    expect(f.find((c) => c.code === 'zone')).toMatchObject({ valeur: 'Nord', visible: true, modifiable: true });
  });

  it('droits de saisie par rôle et par étape ; l’administrateur corrige toujours', async () => {
    await champ({ code: 'avis_dga', libelle: 'Avis de la DGA', kind: 'texte', etapesSaisie: ['dga'] });
    await champ({ code: 'reserve_scc', libelle: 'Réservé SCC', kind: 'texte', rolesSaisie: ['scc'] });
    await champ({ code: 'ouvert_redacteur', libelle: 'Rédacteur', kind: 'texte', rolesSaisie: ['redacteur'] });
    const a = (await newActe()).body;
    const put = (tok, custom) => as(tok).put(`${base()}/actes/${a.id}`, { custom });
    expect((await put(t.dupont, { avis_dga: 'ok' })).status).toBe(403);       // pas à cette étape
    expect((await put(t.dupont, { reserve_scc: 'ok' })).status).toBe(403);    // pas mon rôle
    expect((await put(t.dupont, { ouvert_redacteur: 'ok' })).status).toBe(200);
    expect((await put(admin, { ouvert_redacteur: 'ok', avis_dga: 'corrigé', reserve_scc: 'x' })).status).toBe(200);
    // une valeur inchangée n'est pas une modification : le rédacteur peut renvoyer l'objet complet
    expect((await put(t.dupont, { ouvert_redacteur: 'ok', avis_dga: 'corrigé', reserve_scc: 'x' })).status).toBe(200);
    const fiche = (await as(t.dupont).get(`${base()}/actes/${a.id}`)).body.champs;
    expect(fiche.find((c) => c.code === 'avis_dga').modifiable).toBe(false);
    expect(fiche.find((c) => c.code === 'ouvert_redacteur').modifiable).toBe(true);
  });

  it('obligatoire : figure dans la complétude et bloque l’envoi ; condition d’affichage ; désactivation', async () => {
    await champ({ code: 'convention', libelle: 'Convention associée ?', kind: 'liste', options: [{ valeur: 'oui', libelle: 'Oui' }, { valeur: 'non', libelle: 'Non' }], obligatoire: true });
    await champ({ code: 'ref_convention', libelle: 'Référence de la convention', kind: 'texte', obligatoire: true, visibleSi: { champ: 'convention', egal: 'oui' } });
    const a = (await newActe()).body;
    const put = (custom) => as(t.dupont).put(`${base()}/actes/${a.id}`, { custom });
    expect(await manque(a.id)).toContain('champ_convention');
    expect(await manque(a.id)).not.toContain('champ_ref_convention');       // masqué : ne compte pas
    await put({ convention: 'oui' });
    expect(await manque(a.id)).toEqual(expect.arrayContaining(['champ_ref_convention']));
    expect(await manque(a.id)).not.toContain('champ_convention');
    const envoi = await as(t.dupont).post(`${base()}/actes/${a.id}/envoi`);
    expect(envoi.status).toBe(422);
    await put({ convention: 'non' });
    expect(await manque(a.id)).not.toContain('champ_ref_convention');
    // désactivé : plus demandé, valeur conservée
    const def = (await as(admin).get(`${base()}/champs/definitions`)).body.items.find((c) => c.code === 'convention');
    expect((await as(admin).del(`${base()}/champs/${def.id}`)).status).toBe(200);
    expect(await manque(a.id)).not.toContain('champ_convention');
    expect((await as(t.dupont).get(`${base()}/actes/${a.id}`)).body.custom.convention).toBe('non');
    expect((await as(t.dupont).get(`${base()}/champs`)).body.items.map((c) => c.code)).not.toContain('convention');
    expect((await as(admin).put(`${base()}/champs/${def.id}`, { actif: true })).body.actif).toBe(true);
  });
});

describe('export et import de la configuration (PAR-11, PAR-12)', () => {
  let doc;
  it('l’export ne contient ni secret, ni personne, ni acte ; réservé à l’administrateur', async () => {
    await as(admin).put(`${base()}/settings/tlt.siren`, { value: '123456789', scope: 'organisme' });
    await as(admin).put(`${base()}/settings/tdt.s2low.mot_de_passe`, { value: 'chiffre.abc.def', scope: 'organisme' });
    expect((await as(t.dupont).get(`${base()}/configuration/export`)).status).toBe(403);
    const r = await as(admin).get(`${base()}/configuration/export`);
    expect(r.status).toBe(200); expect(r.headers['content-disposition']).toMatch(/configuration-ville\.json/);
    doc = r.body;
    expect(doc.format).toBe('vibedelib.configuration/1');
    expect(doc.parametres['tlt.siren']).toBe('123456789');
    expect(JSON.stringify(doc)).not.toMatch(/mot_de_passe|chiffre\.abc/);
    expect(doc.champs.map((c) => c.code)).toEqual(expect.arrayContaining(['zone', 'priorite', 'convention']));
    expect(doc.circuits.length).toBeGreaterThan(0); expect(doc.instances.length).toBeGreaterThan(0);
    expect(JSON.stringify(doc)).not.toMatch(/"dupont"|"durand"|Subvention à l/);
  });

  it('import dans une autre collectivité : aperçu sans effet, application, idempotence, circuits en brouillon, isolation', async () => {
    const ccas = (await as(admin).post('/api/v1/organismes', { code: 'ccas', nom: 'CCAS', type: 'ccas' })).body;
    const avant = (await as(admin).get(`${base(ccas)}/champs`)).body.items.length;
    const apercu = await as(admin).post(`${base(ccas)}/configuration/import`, { document: doc, appliquer: false });
    expect(apercu.status).toBe(200); expect(apercu.body).toMatchObject({ appliquee: false, aDesEffets: true });
    expect(apercu.body.sections.champs.creer).toBeGreaterThan(0);
    expect(apercu.body.avertissements.join(' ')).toMatch(/déjà présent|ignor/); // le circuit par défaut du CCAS existe déjà
    expect((await as(admin).get(`${base(ccas)}/champs`)).body.items.length).toBe(avant); // l'aperçu ne change rien

    const r = await as(admin).post(`${base(ccas)}/configuration/import`, { document: doc, appliquer: true });
    expect(r.body.appliquee).toBe(true);
    expect((await as(admin).get(`${base(ccas)}/champs`)).body.items.map((c) => c.code)).toEqual(expect.arrayContaining(['zone', 'priorite', 'convention']));
    const st = (await as(admin).get(`${base(ccas)}/settings`)).body.settings;
    expect(st['tlt.siren']).toMatchObject({ value: '123456789', origin: 'organisme' });
    expect(st['tdt.s2low.mot_de_passe']).toBeUndefined();

    // idempotent : rejouer ne crée ni ne modifie rien
    const encore = (await as(admin).post(`${base(ccas)}/configuration/import`, { document: doc, appliquer: true })).body;
    expect(encore.aDesEffets).toBe(false);
    expect(Object.values(encore.sections).every((s) => !s.creer && !s.modifier)).toBe(true);

    // les champs du CCAS sont indépendants de ceux de la Ville
    const def = (await as(admin).get(`${base(ccas)}/champs/definitions`)).body.items.find((c) => c.code === 'zone');
    await as(admin).put(`${base(ccas)}/champs/${def.id}`, { libelle: 'Secteur' });
    expect((await as(admin).get(`${base()}/champs`)).body.items.find((c) => c.code === 'zone').libelle).toBe('Zone');
  });

  it('fichier invalide refusé ; secrets, champs douteux et circuits existants ignorés avec avertissement ; rien n’est supprimé', async () => {
    expect((await as(admin).post(`${base()}/configuration/import`, { document: { format: 'autre/1' }, appliquer: true })).status).toBe(400);
    expect((await as(t.dupont).post(`${base()}/configuration/import`, { document: doc, appliquer: false })).status).toBe(403);
    const r = await as(admin).post(`${base()}/configuration/import`, {
      appliquer: true,
      document: { format: 'vibedelib.configuration/1', parametres: { 'ged.mot_de_passe': 'x', 'Nom Invalide': 1, 'notif.test': true }, champs: [{ code: 'zone', libelle: 'Zone', kind: 'nombre' }, { code: 'X', libelle: 'x', kind: 'texte' }], circuits: [{ code: doc.circuits[0].code, nom: 'Autre', graph: doc.circuits[0].graph }] },
    });
    expect(r.status).toBe(200);
    const av = r.body.avertissements.join(' | ');
    expect(av).toMatch(/secrets ne se transfèrent pas/); expect(av).toMatch(/nom invalide/); expect(av).toMatch(/autre type/); expect(av).toMatch(/définition invalide/); expect(av).toMatch(/conservé tel quel/);
    expect((await as(admin).get(`${base()}/champs`)).body.items.length).toBeGreaterThan(5); // rien supprimé
  });

  it('le modèle « commune neutre » met en service un nouvel organisme : instance et circuit court (brouillon)', async () => {
    const autre = (await as(admin).post('/api/v1/organismes', { code: 'commune-x', nom: 'Commune X', type: 'commune' })).body;
    const liste = (await as(admin).get(`${base(autre)}/configuration/modeles`)).body.items;
    expect(liste.map((m) => m.code)).toContain('commune-neutre');
    expect((await as(admin).get(`${base(autre)}/configuration/modeles/inconnu`)).status).toBe(404);
    const modele = (await as(admin).get(`${base(autre)}/configuration/modeles/commune-neutre`)).body;
    const r = (await as(admin).post(`${base(autre)}/configuration/import`, { document: modele, appliquer: true })).body;
    expect(r.sections.circuits).toMatchObject({ creer: 1 }); expect(r.sections.organisme.modifier).toBe(1);
    const circuits = (await as(admin).get(`${base(autre)}/circuits`)).body.items;
    expect(circuits.map((c) => c.code)).toContain('circuit-court');
    expect(await env.db.get("SELECT status FROM circuit_versions v JOIN circuit_definitions d ON d.id = v.definition_id WHERE d.code = 'circuit-court' AND d.organisme_id = $1", [autre.id])).toEqual({ status: 'draft' });
    expect((await as(admin).get(`${base(autre)}`)).body.vocabulaire).toMatchObject({ instance: 'Conseil' });
  });
});
