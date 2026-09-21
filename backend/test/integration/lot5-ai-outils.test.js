const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');
const A = require('../../src/modules/ai/analyses');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubrique; let acte;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const P = (id) => `${base()}/actes/${id}`;
const texts = async (id, tok = t.dupont) => (await as(tok).get(`${P(id)}/textes`)).body.items;
const read = async (id, kind) => { const it = (await texts(id)).find((x) => x.kind === kind); return (await as(t.dupont).get(`${P(id)}/textes/${it.id}?mode=propre`)).body; };
const settle = async () => { await env.c.aiQueue.drain(); };
const list = async (id, q = '') => (await as(t.dupont).get(`${P(id)}/ia/propositions${q}`)).body.items;

const EXPOSE = "Le quartier du Petit-Ivry accueille chaque année un festival. L'association sollicite une subvention de 18 000 euros; les recettes sont de 12 000 euros.";
const VISAS = "Vu le budget primitif ;\nConsidérant l'intérêt communal de l'événement ;";
const DISPO = "Article 1 : Une subvention est attribuée à l'association Ivry en Fête.\n\nArticle 2 : Monsieur le Maire est chargé de l'exécution.";

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = {};
  for (const [u, p] of [['dupont', 'pw-dupont'], ['durand', 'pw-durand']]) t[u] = await loginAs(env, u, p);
  const items = (k) => as(admin).get(`${base()}/referentiels/${k}`).then((r) => r.body.items);
  matiere = (await items('matiere')).find((x) => x.code === '7.5'); rubrique = (await items('rubrique')).find((x) => x.libelle === 'FINANCES');
  typeDelib = (await items('type_acte')).find((x) => x.code === 'deliberation');
  acte = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre: "Subvention à l'association Ivry en Fête" })).body;
  await as(t.dupont).put(P(acte.id), { matiereId: matiere.id, rubriqueId: rubrique.id, incidenceFinanciere: true, montant: 18000, rapporteurId: 1 });
  const md = { expose: EXPOSE, visas: VISAS, dispositif: DISPO };
  for (const x of await texts(acte.id)) await as(t.dupont).put(`${P(acte.id)}/textes/${x.id}`, { markdown: md[x.kind], baseVersion: x.version });
});
afterAll(async () => { await env.close(); });

/** IA factice : selon la consigne système (orthographe / style / visas) et le texte demandé. */
const answer = ({ system, prompt }) => {
  if (system.includes('correcteur de français')) {
    if (prompt.includes('Type de texte à contrôler : exposé')) {
      return JSON.stringify({ propositions: [
        { find: '18 000 euros;', replace: '18 000 euros ;', raison: 'Espace insécable avant le point-virgule', categorie: 'typographie', gravite: 'info' },
        { find: 'accueille chaque année un festival', replace: 'accueille chaque année un festival de quartier', raison: 'Précision', categorie: 'orthographe' },
        { find: 'passage inventé', replace: 'x', raison: 'inventé' },
      ], alertes: [] });
    }
    return '{"propositions":[],"alertes":[]}';
  }
  if (system.includes('rédacteur expert')) {
    return JSON.stringify({ propositions: [{ find: "L'association sollicite", replace: "L'association demande", raison: 'Plus direct', categorie: 'style' }], alertes: [] });
  }
  if (system.includes('juriste en droit')) {
    if (prompt.includes('Type de texte à contrôler : visas')) {
      return JSON.stringify({ propositions: [], alertes: [{ message: 'Référence à vérifier auprès du service juridique : article L. 2311-7 du CGCT', gravite: 'a_revoir' }, "Ajouter l'autorisation de signature au dispositif"] });
    }
    return '{"propositions":[],"alertes":[]}';
  }
  return 'illisible';
};
const useAnswer = () => { env.ai.state.handler = answer; };

describe('analyses de l\'éditeur', () => {
  it('orthographe : propose des cartes catégorisées, écarte le passage inventé, n\'applique rien', async () => {
    useAnswer();
    const before = (await read(acte.id, 'expose')).markdown;
    const r = await as(t.dupont).post(`${P(acte.id)}/ia/analyse`, { type: 'orthographe' });
    expect(r.status).toBe(202);
    await settle();
    const items = await list(acte.id);
    const rem = items.filter((i) => i.kind === 'remplacement');
    expect(rem.map((i) => i.categorie).sort()).toEqual(['orthographe', 'typographie']);
    expect(rem.every((i) => i.status === 'pending' && i.analyse === 'orthographe')).toBe(true);
    expect((await read(acte.id, 'expose')).markdown).toBe(before); // rien d'écrit sans décision
  });

  it('filtre par texte', async () => {
    const ex = (await texts(acte.id)).find((x) => x.kind === 'expose');
    expect((await list(acte.id, `?textId=${ex.id}`)).length).toBeGreaterThan(0);
    const di = (await texts(acte.id)).find((x) => x.kind === 'dispositif');
    expect(await list(acte.id, `?textId=${di.id}`)).toHaveLength(0);
  });

  it('« tout accepter (orthographe seule) » applique orthographe et typographie, pas le style', async () => {
    const ex = (await texts(acte.id)).find((x) => x.kind === 'expose');
    await as(t.dupont).post(`${P(acte.id)}/ia/analyse`, { type: 'style', textId: ex.id });
    await settle();
    expect((await list(acte.id)).some((i) => i.categorie === 'style' && i.status === 'pending')).toBe(true);
    const r = await as(t.dupont).post(`${P(acte.id)}/ia/propositions/accepter-orthographe`, { textId: ex.id });
    expect(r.status).toBe(200);
    expect(r.body.accepted).toBe(2);
    const md = (await read(acte.id, 'expose')).markdown;
    expect(md).toContain('18 000 euros ;');
    expect(md).toContain('un festival de quartier');
    expect(md).toContain("L'association sollicite"); // le style n'a pas été appliqué
    expect((await list(acte.id)).find((i) => i.categorie === 'style').status).toBe('pending');
  });

  it('style : la carte acceptée devient une modification de l\'utilisateur, et un « pourquoi » est conservé', async () => {
    const s = (await list(acte.id)).find((i) => i.categorie === 'style' && i.status === 'pending');
    expect(s.reason).toBe('Plus direct');
    const r = await as(t.dupont).post(`${P(acte.id)}/ia/propositions/${s.id}/decision`, { decision: 'accept' });
    expect(r.status).toBe(200);
    expect((await read(acte.id, 'expose')).markdown).toContain("L'association demande");
  });

  it('visas : les références juridiques sont des alertes « à vérifier », jamais des modifications', async () => {
    const vi = (await texts(acte.id)).find((x) => x.kind === 'visas');
    await as(t.dupont).post(`${P(acte.id)}/ia/analyse`, { type: 'visas', textId: vi.id });
    await settle();
    const al = (await list(acte.id, `?textId=${vi.id}`)).filter((i) => i.kind === 'alerte');
    expect(al).toHaveLength(2);
    expect(al.find((i) => /L\. 2311-7/.test(i.reason))).toMatchObject({ categorie: 'visa', gravite: 'a_revoir' });
    const w = await as(t.dupont).post(`${P(acte.id)}/ia/propositions/${al[0].id}/decision`, { decision: 'accept' });
    expect(w.status).toBe(200); // une alerte ne peut qu'être écartée
    expect((await list(acte.id, '?statut=rejected')).some((i) => i.id === al[0].id)).toBe(true);
  });

  it('contrôle complet : trois passes IA + contrôles faits par le code (montant, annexe, incidence financière)', async () => {
    const calls = env.ai.state.calls.length;
    await as(t.dupont).post(`${P(acte.id)}/ia/analyse`, { type: 'complet' });
    await settle();
    expect(env.ai.state.calls.length - calls).toBeGreaterThanOrEqual(6);
    const complet = (await list(acte.id)).filter((i) => i.analyse === 'complet' && i.kind === 'alerte');
    const msgs = complet.map((i) => i.reason).join('\n');
    expect(msgs).toMatch(/incidence financière mais le dispositif ne mentionne aucun montant/); // le dispositif ne cite aucun montant
    expect(msgs).toMatch(/Aucun visa du code général des collectivités territoriales/);
    expect(complet.find((i) => /Aucun visa du code/.test(i.reason))).toMatchObject({ categorie: 'visa', gravite: 'info' });
  });

  it('refus : analyse inconnue, texte d\'un autre dossier, lecteur sans droit d\'édition', async () => {
    expect((await as(t.dupont).post(`${P(acte.id)}/ia/analyse`, { type: 'magie' })).status).toBe(400);
    expect((await as(t.dupont).post(`${P(acte.id)}/ia/analyse`, { type: 'style', textId: 999999 })).status).toBe(404);
    expect([403, 404]).toContain((await as(t.durand).post(`${P(acte.id)}/ia/analyse`, { type: 'style' })).status);
  });

  it('IA en panne : la tâche échoue proprement, sans proposition', async () => {
    env.ai.state.failing = true;
    const r = await as(t.dupont).post(`${P(acte.id)}/ia/analyse`, { type: 'style' });
    expect(r.status).toBe(202);
    await settle();
    env.ai.state.failing = false;
    const job = (await as(t.dupont).get(`${base()}/ia/taches/${r.body.id}`)).body;
    expect(['failed', 'error', 'queued']).toContain(job.status);
  });
});

describe('contrôles déterministes', () => {
  const acteFiche = (o = {}) => ({ montant: 18000, incidence_financiere: true, ...o });
  const T = (kind, markdown, id = 1) => ({ id, kind, markdown });
  it('détecte texte vide, montant absent, incidence sans montant, annexe citée mais absente', () => {
    const r = A.controlesDeterministes(acteFiche(), [T('expose', 'Un exposé sans chiffre, voir annexe 1.', 1), T('visas', '', 2), T('dispositif', 'Article 1 : Approuvé.', 3)], { annexes: 0 });
    const msgs = r.map((x) => x.message).join('|');
    expect(msgs).toMatch(/est vide/); expect(msgs).toMatch(/Le montant de la fiche/); expect(msgs).toMatch(/aucune annexe n'est jointe/);
    expect(r.find((x) => /est vide/.test(x.message))).toMatchObject({ gravite: 'bloquant', textId: 2 });
  });
  it('accepte le montant écrit avec ou sans séparateur de milliers', () => {
    for (const s of ['18 000 euros', '18000 €', '18 000 €']) {
      const r = A.controlesDeterministes(acteFiche(), [T('expose', `Montant : ${s}`), T('visas', 'Vu le code général des collectivités territoriales ;', 2), T('dispositif', 'Article 1 : 18 000 euros.', 3)], { annexes: 0 });
      expect(r.some((x) => /n'apparaît dans aucun/.test(x.message))).toBe(false);
    }
  });
  it('ne confond pas 118 000 avec 18 000', () => {
    const r = A.controlesDeterministes(acteFiche(), [T('expose', 'Montant : 118 000 euros'), T('visas', 'Vu le code général des collectivités territoriales ;', 2), T('dispositif', 'Article 1 : 118 000 euros.', 3)], { annexes: 0 });
    expect(r.some((x) => /n'apparaît dans aucun/.test(x.message))).toBe(true);
  });
  it('signale des euros sans incidence financière déclarée, et des annexes non citées', () => {
    const r = A.controlesDeterministes({ montant: null, incidence_financiere: false }, [T('expose', 'Cela coûte 500 euros.'), T('visas', 'Vu le CGCT ;', 2), T('dispositif', 'Article 1 : ok.', 3)], { annexes: 2 });
    const msgs = r.map((x) => x.message).join('|');
    expect(msgs).toMatch(/aucune incidence financière/); expect(msgs).toMatch(/2 annexe\(s\) jointe\(s\)/);
  });
});

describe('consignes et modèles de l’IA (administration)', () => {
  const PR = () => `${base()}/ia/prompts`;
  it('liste les consignes par défaut, le format imposé et les modèles proposés ; réservé à l’administrateur', async () => {
    const r = await as(admin).get(PR());
    expect(r.status).toBe(200);
    expect(r.body.items.map((i) => i.code)).toEqual(['orthographe', 'style', 'visas', 'complet', 'copie', 'aide']);
    expect(r.body.items[0]).toMatchObject({ personnalise: false, modele: null });
    expect(r.body.items[0].texte).toBe(r.body.items[0].defaut);
    expect(r.body.items[0].format).toContain('UNIQUEMENT par un objet JSON'); // imposé : non modifiable
    expect(r.body.modeles).toEqual(['fake-ia', 'fake-ia-rapide']);
    expect((await as(t.dupont).get(PR())).status).toBe(403);
  });

  it('une consigne modifiée et un modèle choisi sont utilisés pour cette fonction seulement, le format de réponse restant imposé', async () => {
    useAnswer();
    const texte = 'Tu es un correcteur très strict du français administratif. Corrige uniquement les fautes d’orthographe et de grammaire, rien d’autre.';
    const r = await as(admin).put(`${PR()}/orthographe`, { texte, modele: 'fake-ia-rapide' });
    expect(r.status).toBe(200);
    expect(r.body.items[0]).toMatchObject({ personnalise: true, texte, modele: 'fake-ia-rapide' });
    expect(r.body.items[1]).toMatchObject({ personnalise: false, modele: null }); // les autres fonctions ne bougent pas

    env.ai.state.calls.length = 0;
    await as(t.dupont).post(`${P(acte.id)}/ia/analyse`, { type: 'orthographe' });
    await settle();
    const call = env.ai.state.calls[0];
    expect(call.system.startsWith('Tu es un correcteur très strict')).toBe(true);
    expect(call.system).toContain('UNIQUEMENT par un objet JSON'); // le format est toujours ajouté
    expect(call.model).toBe('fake-ia-rapide');

    env.ai.state.calls.length = 0;
    await as(t.dupont).post(`${P(acte.id)}/ia/analyse`, { type: 'style', textId: (await texts(acte.id)).find((x) => x.kind === 'expose').id });
    await settle();
    expect(env.ai.state.calls[0].model).toBeUndefined(); // style : modèle par défaut
  });

  it('refuse une consigne trop courte ; « null » rétablit la consigne et le modèle par défaut (audité)', async () => {
    expect((await as(admin).put(`${PR()}/style`, { texte: 'Trop court' })).status).toBe(400);
    expect((await as(admin).put(`${PR()}/inconnue`, { texte: 'x'.repeat(40) })).status).toBe(400);
    expect((await as(admin).put(`${PR()}/style`, {})).status).toBe(400);
    const r = await as(admin).put(`${PR()}/orthographe`, { texte: null, modele: null });
    expect(r.body.items[0]).toMatchObject({ personnalise: false, modele: null });
    const audit = await env.db.all("SELECT action FROM audit_log WHERE action IN ('setting.set','setting.unset') AND entity_id LIKE '%ai.prompt.orthographe%'");
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['setting.set', 'setting.unset']));
  });
});

describe('activer / désactiver chaque usage de l’IA (D83)', () => {
  const PR = () => `${base()}/ia/prompts`;
  const statut = async () => (await as(t.dupont).get(`${base()}/ia/statut`)).body;
  const set = (code, actif) => as(admin).put(`${PR()}/${code}`, { actif });

  it('tout est activé par défaut ; le contrôle complet figure dans la liste sans consigne propre', async () => {
    expect(await statut()).toEqual({ orthographe: true, style: true, visas: true, complet: true, copie: true, aide: true });
    const l = (await as(admin).get(PR())).body.items;
    expect(l.map((i) => i.code)).toEqual(['orthographe', 'style', 'visas', 'complet', 'copie', 'aide']);
    expect(l.find((i) => i.code === 'complet')).toMatchObject({ sansConsigne: true, actif: true });
    expect((await as(admin).put(`${PR()}/complet`, { texte: 'x'.repeat(40) })).status).toBe(400); // pas de consigne propre
  });

  it('un usage désactivé est masqué (statut) et JAMAIS appelé : le serveur refuse', async () => {
    useAnswer();
    expect((await set('style', false)).status).toBe(200);
    expect((await statut()).style).toBe(false);
    env.ai.state.calls.length = 0;
    const r = await as(t.dupont).post(`${P(acte.id)}/ia/analyse`, { type: 'style' });
    expect(r.status).toBe(403); expect(r.body.error).toMatch(/désactivé/);
    await settle();
    expect(env.ai.state.calls.length).toBe(0);
    // les autres usages continuent de fonctionner
    expect((await as(t.dupont).post(`${P(acte.id)}/ia/analyse`, { type: 'orthographe' })).status).toBe(202);
    await settle();
    expect(env.ai.state.calls.length).toBeGreaterThan(0);
  });

  it('le contrôle complet n’enchaîne que les passes actives ; sans aucune passe, seuls les contrôles du code tournent', async () => {
    env.ai.state.calls.length = 0;
    await as(t.dupont).post(`${P(acte.id)}/ia/analyse`, { type: 'complet' });
    await settle();
    const systems = env.ai.state.calls.map((c) => c.system);
    expect(systems.some((s) => s.includes('rédacteur expert'))).toBe(false); // la passe « style » est désactivée
    expect(systems.some((s) => s.includes('correcteur de français'))).toBe(true);
    await set('orthographe', false); await set('visas', false);
    env.ai.state.calls.length = 0;
    expect((await as(t.dupont).post(`${P(acte.id)}/ia/analyse`, { type: 'complet' })).status).toBe(202);
    await settle();
    expect(env.ai.state.calls.length).toBe(0); // aucun appel à l’IA
    await set('complet', false);
    expect((await as(t.dupont).post(`${P(acte.id)}/ia/analyse`, { type: 'complet' })).status).toBe(403);
  });

  it('copie assistée désactivée : la copie simple est faite, sans tâche IA ; la redemande d’adaptation est refusée', async () => {
    await set('copie', false);
    env.ai.state.calls.length = 0;
    const r = await as(t.dupont).post(`${P(acte.id)}/copie`, { adapter: true, contexte: 'Nouvelle subvention 2027 à une autre association.' });
    expect(r.status).toBe(201);
    expect(r.body.job).toBeNull(); expect(r.body.iaError).toMatch(/désactivée/);
    await settle();
    expect(env.ai.state.calls.length).toBe(0);
    expect((await as(t.dupont).post(`${P(r.body.acte.id)}/ia/adaptation`, { contexte: 'Nouvelle subvention 2027 à une autre association.' })).status).toBe(403);
  });

  it('la réactivation rétablit l’usage ; l’interrupteur est réservé à l’administrateur', async () => {
    expect((await as(t.dupont).put(`${PR()}/style`, { actif: true })).status).toBe(403);
    for (const c of ['style', 'orthographe', 'visas', 'complet', 'copie', 'aide']) expect((await set(c, true)).status).toBe(200);
    expect(await statut()).toEqual({ orthographe: true, style: true, visas: true, complet: true, copie: true, aide: true });
    expect((await as(t.dupont).post(`${P(acte.id)}/ia/analyse`, { type: 'style' })).status).toBe(202);
    await settle();
  });
});
