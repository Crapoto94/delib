const jwt = require('jsonwebtoken');

const axios = require('axios');

const { createBureauOnlyOffice } = require('../../src/adapters/bureau-onlyoffice');
const { createBureauSimulateur } = require('../../src/adapters/bureau-simulateur');

const SECRET = 'secret-partage-bureau-en-ligne-0123456789';
const base = (extra = {}) => ({
  url: 'http://moteur:8080',
  urlNavigateur: 'http://moteur:8080',
  urlRappel: 'https://delib.ville.fr',
  jwtSecret: SECRET,
  sources: async () => ({ jeton: 'a'.repeat(32) }),
  ...extra,
});
const reqAvec = (headers = {}) => ({ headers, get: (n) => headers[String(n).toLowerCase()] });

describe('bureau en ligne — adaptateur OnlyOffice', () => {
  // Le réseau est intercepté : aucun appel ne sort vraiment, on décrit ce que le moteur renvoie.
  beforeEach(() => { vi.spyOn(axios, 'get').mockReset().mockResolvedValue({ status: 200, data: Buffer.from('') }); vi.spyOn(axios, 'post').mockReset().mockResolvedValue({ status: 200, data: { error: 0 } }); });

  it('annonce les formats éditables et refuse ce qu’il ne sait pas ouvrir', () => {
    const p = createBureauOnlyOffice(base());
    expect(p.moteur).toBe('onlyoffice');
    expect(p.capabilities()).toMatchObject({ enabled: true, mobile: true });
    expect(p.capabilities().formats).toEqual(expect.arrayContaining(['docx', 'xlsx', 'odt']));
    expect(p.open({ cle: 'k', nom: 'notes.pdf', url: 'https://delib.ville.fr/x' })).toBeNull();
  });

  it('renvoie une configuration signée, avec forcesave (chaque Ctrl+S nous est signalé)', () => {
    const p = createBureauOnlyOffice(base());
    const { sdk, config } = p.open({ cle: 'cle-1', nom: 'annexe.docx', url: 'https://delib.ville.fr/f', user: { username: 'a.mairie' }, mobile: true });
    expect(sdk).toBe('http://moteur:8080/web-apps/apps/api/documents/api.js');
    // le moteur est servi sur sa propre origine : le SDK doit la connaître explicitement (voir MANIFEST §35)
    expect(config.documentServerUrl).toBe('http://moteur:8080');
    expect(config.documentType).toBe('word');
    expect(config.document.fileType).toBe('docx');
    expect(config.type).toBe('mobile');                       // écran de téléphone : l'éditeur se replie
    expect(config.editorConfig.callbackUrl).toBe('https://delib.ville.fr/api/v1/public/bureau/rappel');
    expect(config.editorConfig.forcesave).toBe(true);
    expect(config.editorConfig.user.id).toBe('a.mairie');
    // le moteur n'accepte la configuration que signée : on vérifie que le token correspond bien à la config
    const decode = jwt.verify(config.token, SECRET);
    expect(decode.document.url).toBe('https://delib.ville.fr/f');
  });

  it('un .xlsx s’ouvre en tableur, pas en traitement de texte', () => {
    const p = createBureauOnlyOffice(base());
    expect(p.open({ cle: 'c', nom: 'budget.XLSX', url: 'https://delib.ville.fr/f' }).config.documentType).toBe('cell');
  });

  it('rappel : jeton absent ou mal signé → refusé, sans exception', () => {
    const p = createBureauOnlyOffice(base());
    expect(p.verifyCallback(reqAvec({}))).toEqual({ ok: false, code: 'jeton_absent' });
    expect(p.verifyCallback(reqAvec({ authorization: 'Bearer pas-un-jeton' }))).toEqual({ ok: false, code: 'signature_invalide' });
    // jeton valide mais sans clé de session : inutile à l'application
    expect(p.verifyCallback(reqAvec({ authorization: `Bearer ${jwt.sign({ status: 2 }, SECRET)}` }))).toEqual({ ok: false, code: 'cle_absente' });
    // et un jeton signé par quelqu'un d'autre : rejeté
    const autre = jwt.sign({ key: 'cle-1', status: 2 }, 'un-autre-secret-de-plus-de-24-caracteres');
    expect(p.verifyCallback(reqAvec({ authorization: `Bearer ${autre}` }))).toEqual({ ok: false, code: 'signature_invalide' });
  });

  it('rappel : jeton signé par le moteur et clé connue → accepté', () => {
    const p = createBureauOnlyOffice(base());
    const jeton = jwt.sign({ key: 'cle-1', status: 2, url: 'http://moteur:8080/cache/files/out.docx' }, SECRET);
    const v = p.verifyCallback(reqAvec({ authorization: `Bearer ${jeton}` }));
    expect(v.ok).toBe(true);
    expect(v.payload.status).toBe(2);
    expect(v.jeton).toBe(jeton);
  });

  it('rappel : jeton accepté aussi dans le corps (ONLYOFFICE l’y ajoute quand JWT_IN_BODY est actif)', () => {
    const p = createBureauOnlyOffice(base());
    const jeton = jwt.sign({ key: 'cle-1', status: 6, url: 'http://moteur:8080/cache/files/out.docx' }, SECRET);
    const v = p.verifyCallback({ headers: {}, body: { token: jeton } });
    expect(v.ok).toBe(true);
    expect(v.jeton).toBe(jeton);
  });

  it('rappel : on ne relit jamais un lien qui ne vient pas du moteur (le moteur en désigne un autre = SSRF)', async () => {
    const p = createBureauOnlyOffice(base());
    const v = p.verifyCallback(reqAvec({ authorization: `Bearer ${jwt.sign({ key: 'k', status: 2, url: 'http://169.254.169.254/secret' }, SECRET)}` }));
    expect(await p.readBack({ url: v.payload.url, jeton: v.jeton })).toBeNull();
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('rappel : la relecture s’authentifie avec le jeton du rappel (ONLYOFFICE refuse une source anonyme)', async () => {
    const p = createBureauOnlyOffice(base());
    const jeton = jwt.sign({ key: 'k', status: 2, url: 'http://moteur:8080/cache/files/out.docx' }, SECRET);
    axios.get.mockResolvedValue({ status: 200, data: Buffer.from('PK') });
    const r = await p.readBack({ url: 'http://moteur:8080/cache/files/out.docx', filetype: 'docx', jeton });
    expect(r).toEqual({ buffer: expect.any(Buffer), ext: 'docx' });
    expect(axios.get.mock.calls[0][1].headers).toEqual({ Authorization: `Bearer ${jeton}` });
  });

  it('conversion : le document part du dépôt à usage unique, le PDF revient du moteur', async () => {
    const p = createBureauOnlyOffice(base());
    axios.post.mockResolvedValue({ status: 200, data: { error: 0, fileUrl: 'http://moteur:8080/cache/files/out.pdf' } });
    axios.get.mockResolvedValue({ status: 200, data: Buffer.from('%PDF-1.7') });
    const r = await p.versPdf({ buffer: Buffer.from('PK'), ext: 'docx' });
    expect(r).toEqual({ buffer: expect.any(Buffer), moteur: 'onlyoffice' });
    const [url, corps, options] = axios.post.mock.calls[0];
    expect(url).toBe('http://moteur:8080/converter');
    const decode = jwt.verify(corps.token, SECRET);
    expect(decode.url).toBe('https://delib.ville.fr/api/v1/public/bureau/source/' + 'a'.repeat(32));
    expect(decode.outputtype).toBe('pdf');
    // JWT_IN_BODY pouvant être désactivé sur le moteur : le jeton voyage aussi dans l’en-tête, à l’appel comme au retour.
    expect(options.headers.Authorization).toBe(`Bearer ${corps.token}`);
    expect(axios.get.mock.calls[0][1].headers).toEqual({ Authorization: `Bearer ${corps.token}` });
  });

  it('conversion refusée par le moteur → on rend la main au repli local (pas d’exception)', async () => {
    const p = createBureauOnlyOffice(base());
    axios.post.mockResolvedValue({ status: 200, data: { error: -1 } });
    expect(await p.versPdf({ buffer: Buffer.from('x'), ext: 'docx' })).toBeNull();
    // format que le moteur ne sait pas convertir : on ne le sollicite pas
    expect(await p.versPdf({ buffer: Buffer.from('x'), ext: 'pdf' })).toBeNull();
  });

  it('moteur injoignable → repli, jamais d’erreur remontée à l’agent', async () => {
    const p = createBureauOnlyOffice(base());
    axios.post.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await p.versPdf({ buffer: Buffer.from('x'), ext: 'docx' })).toBeNull();
  });
});

describe('bureau en ligne — simulateur (aucun moteur déployé)', () => {
  const p = createBureauSimulateur();

  it('se déclare désactivé : l’interface ne propose alors que le dépôt manuel', () => {
    expect(p.capabilities()).toMatchObject({ enabled: false, formats: [] });
    expect(p.open({ cle: 'k', nom: 'a.docx', url: 'x' })).toBeNull();
    expect(p.verifyCallback({ headers: {} })).toMatchObject({ ok: false });
  });

  it('ne propose pas de conversion : le PDF passe par LibreOffice / Office', async () => {
    expect(await p.versPdf({ buffer: Buffer.from('x'), ext: 'docx' })).toBeNull();
  });
});
