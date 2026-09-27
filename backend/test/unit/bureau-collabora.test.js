const { createBureauCollabora } = require('../../src/adapters/bureau-collabora');
const creerWopi = require('../../src/modules/bureau/wopi');

/** Collabora est un hôte WOPI : la clé de session EST son jeton d'accès, et c'est lui qui vient chercher le document. */
const CLE = 'a1b2c3d4'.repeat(4);
const base = (extra = {}) => ({
  url: 'http://collabora:9980',
  urlNavigateur: '/collabora-delib',
  publicBaseUrl: 'https://delib.ville.fr',
  langue: 'fr-FR',
  ...extra,
});

/**
 * Fausse réponse HTTP : on vérifie le statut et les en-têtes, pas le contenu binaire.
 *
 * Volontairement fidèle à Express sur les points qui comptent : `type()` puis `send()`. Une méthode d'aisance
 * inventée ici (`text()`) avait masqué un 500 sur LOCK — le code appelait une méthode que le runtime n'a pas.
 */
const reponse = () => {
  const r = { statut: 200, entetes: {}, corps: null };
  r.set = (e) => { Object.assign(r.entetes, e); return r; };
  r.status = (s) => { r.statut = s; return r; };
  r.type = (t) => { r.entetes['Content-Type'] = t; return r; };
  r.json = (v) => { r.corps = v; return r; };
  r.send = (v) => { r.corps = v; return r; };
  return r;
};
const requete = (cle, { jeton = cle, entetes = {}, corps } = {}) => ({
  valid: { params: { cle } },
  query: { access_token: jeton },
  body: corps,
  get: (n) => entetes[String(n).toLowerCase()],
});

describe('bureau en ligne — adaptateur Collabora (WOPI)', () => {
  it('annonce les formats éditables, et rien ne s’ouvre sans adresse navigateur', () => {
    const p = createBureauCollabora(base());
    expect(p.moteur).toBe('collabora');
    expect(p.capabilities()).toMatchObject({ enabled: true, mobile: true, moteur: 'collabora' });
    expect(p.capabilities().formats).toEqual(expect.arrayContaining(['docx', 'xlsx', 'pptx', 'odp']));
    // Pas d'adresse navigateur = moteur non déployé : rien ne s'ouvre, et rien ne se signale comme disponible.
    expect(createBureauCollabora({ ...base(), urlNavigateur: null }).capabilities().enabled).toBe(false);
  });

  it('donne au navigateur une iframe Collabora pointant sur notre hôte WOPI', () => {
    const p = createBureauCollabora(base());
    const o = p.open({ cle: CLE, nom: 'note.docx', urlRappel: 'http://10.0.0.4:3021', user: { username: 'jd' } });
    expect(o.src.startsWith('/collabora-delib/browser/')).toBe(true);
    // Le WOPISrc est appelé par le NAVIGATEUR : c'est l'adresse publique du backend, jamais son adresse interne
    // (BUREAU_URL_RAPPEL) que le navigateur ne peut pas joindre et que le mélange http/https bloquerait.
    expect(o.src).toContain(encodeURIComponent(`https://delib.ville.fr/api/v1/public/bureau/wopi/${CLE}`));
    expect(decodeURIComponent(o.src)).not.toContain('10.0.0.4');
    expect(decodeURIComponent(o.src)).toContain(`access_token=${CLE}`);
    expect(decodeURIComponent(o.src)).toContain('lang=fr-FR');
    // Sans adresse publique, pas d'iframe : on ne veut jamais d'éditeur qui ne pourra pas nous rapporter le document.
    expect(createBureauCollabora({ ...base(), publicBaseUrl: null }).open({ cle: CLE, nom: 'note.docx' })).toBeNull();
  });

  it('n’a ni rappel, ni relecture, ni conversion : ces trois là n’existent pas chez Collabora', async () => {
    const p = createBureauCollabora(base());
    expect(p.verifyCallback({})).toEqual({ ok: false, code: 'sans_rappel' });
    expect(await p.readBack({ url: 'https://x' })).toBeNull();
    // `null` = « conversion impossible ici » : convert.js passe alors au repli LibreOffice du backend.
    expect(await p.versPdf({ buffer: Buffer.from('x'), ext: 'docx' })).toBeNull();
  });

  it('« enregistre maintenant » signifie « termine la session »', async () => {
    const p = createBureauCollabora(base());
    expect(await p.forcerSauvegarde(CLE)).toEqual({ ok: true, fermeture: true });
    expect(await p.forcerSauvegarde(null)).toEqual({ ok: false, erreur: 'session_absente' });
  });

  it('n’accepte l’accès que si le jeton est la clé de session', () => {
    const p = createBureauCollabora(base());
    expect(p.verifierAcces(CLE, CLE)).toEqual({ ok: true });
    expect(p.verifierAcces(CLE, 'autre').ok).toBe(false);
    expect(p.verifierAcces('pas-une-cle', 'pas-une-cle').ok).toBe(false);
  });

  it('accepte le jeton que Collabora décore de ses paramètres de diagnostic', () => {
    const p = createBureauCollabora(base());
    // C’est ce que le moteur envoie vraiment : il colle un « ? » à la valeur du jeton.
    expect(p.verifierAcces(CLE, `${CLE}?debug=0`)).toEqual({ ok: true });
    expect(p.verifierAcces(CLE, `${CLE}&debug=0`)).toEqual({ ok: true });
    expect(p.verifierAcces(CLE, undefined)).toEqual({ ok: true });
    // …sans pour autant accepter une clé abrégée ou un autre jeton.
    expect(p.verifierAcces(CLE, `${CLE.slice(0, 31)}?debug=0`).ok).toBe(false);
    expect(p.verifierAcces(CLE, 'autre').ok).toBe(false);
  });
});

describe('bureau en ligne — hôte WOPI', () => {
  const port = createBureauCollabora(base());
  /** Faux service : on ne teste ici que le protocole (statuts, en-têtes, ce qui est appelé), pas la mise à jour SQL. */
  const service = (etat = {}) => ({
    sessionWopi: vi.fn(async (cle) => (cle === CLE ? { cle, annexe_id: 7, username: 'jd', version: 2, ...etat } : null)),
    infoWopi: vi.fn(async () => ({ BaseFileName: 'note.docx', Size: 12, UserId: 'jd', PostMessageOrigin: 'https://delib.ville.fr' })),
    fichierWopi: vi.fn(async () => ({ buffer: Buffer.from('contenu'), name: 'note.docx' })),
    enregistrerDepuisMoteurWopi: vi.fn(async () => ({ version: 3 })),
  });

  it('CheckFileInfo : l’état du document, si la session existe et si le jeton est bon', async () => {
    const bureau = service();
    const wopi = creerWopi({ bureau, port });
    const res = reponse();
    await wopi.checkFileInfo(requete(CLE), res);
    expect(res.corps).toMatchObject({ BaseFileName: 'note.docx', UserId: 'jd' });
    expect(res.entetes['X-WOPI-ServerVersion']).toBeTruthy();

    // Mauvais jeton : rien n’est dit du document.
    const res2 = reponse();
    await expect(creerWopi({ bureau, port }).checkFileInfo(requete(CLE, { jeton: 'autre' }), res2)).rejects.toThrow();
    expect(bureau.infoWopi).toHaveBeenCalledTimes(1);
  });

  it('GetFile : le document avec sa taille', async () => {
    const bureau = service();
    const res = reponse();
    await creerWopi({ bureau, port }).getFile(requete(CLE), res);
    expect(res.entetes['Content-Length']).toBe('7');
    expect(res.corps.toString()).toBe('contenu');
  });

  it('PutFile : enregistre et renvoie la version ; un mauvais verrou est refusé (409)', async () => {
    const bureau = service();
    const wopi = creerWopi({ bureau, port });

    // Sans LOCK préalable, le moteur n'a pas de verrou : rien n'est écrit.
    const refuse = reponse();
    await wopi.putFile(requete(CLE, { entetes: { 'x-wopi-lock': 'devin' }, corps: Buffer.from('x') }), refuse);
    expect(refuse.statut).toBe(409);
    expect(bureau.enregistrerDepuisMoteurWopi).not.toHaveBeenCalled();

    // LOCK puis PutFile : l'écriture passe, avec la version dans X-WOPI-ItemVersion.
    const lock = reponse();
    await wopi.verrou(requete(CLE, { entetes: { 'x-wopi-override': 'LOCK' } }), lock);
    const verrou = lock.entetes['X-WOPI-Lock'];
    expect(verrou).toBeTruthy();
    const ok = reponse();
    await wopi.putFile(requete(CLE, { entetes: { 'x-wopi-lock': verrou }, corps: Buffer.from('docx') }), ok);
    expect(ok.statut).toBe(200);
    expect(ok.corps).toEqual({ Status: 0 });
    expect(ok.entetes['X-WOPI-ItemVersion']).toBe('3');
    expect(bureau.enregistrerDepuisMoteurWopi).toHaveBeenCalledWith(expect.objectContaining({ username: 'jd' }), Buffer.from('docx'));
  });

  it('PutFile refusé par le service (droit, version) : le moteur est prévenu par un Status', async () => {
    const bureau = { ...service(), enregistrerDepuisMoteurWopi: vi.fn(async () => ({ refuse: 'droit' })) };
    const wopi = creerWopi({ bureau, port });
    const lock = reponse();
    await wopi.verrou(requete(CLE, { entetes: { 'x-wopi-override': 'LOCK' } }), lock);
    const res = reponse();
    await wopi.putFile(requete(CLE, { entetes: { 'x-wopi-lock': lock.entetes['X-WOPI-Lock'] }, corps: Buffer.from('x') }), res);
    // 200 + Status 1 : c'est la façon polie de dire « non écrit » sans faire échouer la session d'édition.
    expect(res.statut).toBe(200);
    expect(res.corps).toMatchObject({ Status: 1 });
  });

  it('verrous : LOCK / REFRESH_LOCK / GET_LOCK / UNLOCK, et 409 si un autre moteur tient le verrou', async () => {
    const bureau = service();
    const wopi = creerWopi({ bureau, port });
    const un = (s) => ({ 'x-wopi-override': s });

    const l1 = reponse();
    await wopi.verrou(requete(CLE, { entetes: un('LOCK') }), l1);
    const v1 = l1.entetes['X-WOPI-Lock'];
    expect(v1).toBeTruthy();

    // Un second LOCK avec un autre verrou est refusé, et le moteur apprend quel verrou lui résiste.
    const l2 = reponse();
    await wopi.verrou(requete(CLE, { entetes: un('LOCK') }), l2);
    expect(l2.statut).toBe(409);
    expect(l2.entetes['X-WOPI-Lock']).toBe(v1);

    const r1 = reponse();
    await wopi.verrou(requete(CLE, { entetes: { ...un('REFRESH_LOCK'), 'x-wopi-lock': v1 } }), r1);
    expect(r1.statut).toBe(200);

    const g1 = reponse();
    await wopi.verrou(requete(CLE, { entetes: un('GET_LOCK') }), g1);
    expect(g1.statut).toBe(200);
    expect(g1.entetes['X-WOPI-Lock']).toBe(v1);

    const u1 = reponse();
    await wopi.verrou(requete(CLE, { entetes: { ...un('UNLOCK'), 'x-wopi-lock': v1 } }), u1);
    expect(u1.statut).toBe(200);

    // Verrou libéré : GET_LOCK répond 409 avec un verrou vide (absence de verrou), c'est le contrat du protocole.
    const g2 = reponse();
    await wopi.verrou(requete(CLE, { entetes: un('GET_LOCK') }), g2);
    expect(g2.statut).toBe(409);
    expect(g2.entetes['X-WOPI-Lock']).toBe('');
  });

  it('une session ouverte par un autre moteur n’est pas servie', async () => {
    const bureau = { ...service(), sessionWopi: vi.fn(async () => null) };
    await expect(creerWopi({ bureau, port }).checkFileInfo(requete(CLE), reponse())).rejects.toThrow();
  });
});
