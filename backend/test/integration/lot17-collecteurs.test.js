const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTestEnv, bearer, adminToken } = require('../helpers');

const { PDFDocument, StandardFonts } = require('pdf-lib');

let env; let admin; let ville; let dir; let dir2;
const as = (tok) => ({
  get: (u, o) => env.http().get(u).set(bearer(tok)).query(o || {}),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const base = () => `/api/v1/organismes/${ville.id}`;

async function pdf(texte) {
  const d = await PDFDocument.create();
  const p = d.addPage([595, 842]);
  const f = await d.embedFont(StandardFonts.Helvetica);
  p.drawText(texte, { x: 50, y: 760, size: 12, font: f });
  return Buffer.from(await d.save());
}

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  // un SCC et un admin d'organisme à alerter en cas d'incertitude
  await as(admin).post(`${base()}/utilisateurs/martin/roles`, { role: 'scc' });
  await as(admin).post(`${base()}/utilisateurs/durand/roles`, { role: 'org_admin' });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibedelib-col-'));
  dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'vibedelib-col2-'));
});
afterAll(async () => {
  await env.close();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
});

describe('collecteurs d’arrêtés', () => {
  let elu; let type; let collecteur; let acteId;

  it('crée le catalogue de types d’arrêté', async () => {
    const r = await as(admin).post(`${base()}/collecteurs/types`, { nom: 'Arrêté de voirie' });
    expect(r.status).toBe(201);
    type = r.body;
    expect(type.nom).toBe('Arrêté de voirie');
    const items = (await as(admin).get(`${base()}/collecteurs/types`)).body.items;
    expect(items.some((x) => x.id === type.id)).toBe(true);
  });

  it('moissonne un dossier : fichier certain → arrêté « à signer » et envoi au parapheur', async () => {
    elu = (await as(admin).get(`${base()}/elus`, { actif: true })).body.items[0];
    fs.writeFileSync(path.join(dir, 'arrete-voirie.pdf'), await pdf('REPUBLIQUE FRANCAISE - Arrete n 2024-12 portant reglement de voirie'));

    collecteur = (await as(admin).post(`${base()}/collecteurs`, {
      nom: 'Voirie', type: 'dossier', intervalle: '24h', typeArreteId: type.id, eluId: elu.id,
      emailRetour: 'secretariat@ivry.test', config: { cible: dir, sousDossiers: 'gauche', mouvement: 'deplacer' },
    })).body;
    expect(collecteur.id).toBeTruthy();
    expect(collecteur.typeArreteNom).toBe('Arrêté de voirie');

    const r = (await as(admin).post(`${base()}/collecteurs/${collecteur.id}/collecter`, {})).body;
    expect(r.traites).toBe(1);
    expect(r.attentes).toBe(0);

    const journal = (await as(admin).get(`${base()}/collecteurs/${collecteur.id}/collectes`)).body.items;
    expect(journal.length).toBe(1);
    expect(journal[0].statut).toBe('traite');
    expect(journal[0].elu_nom).toBe(elu.nom);
    acteId = journal[0].acte_id;
    expect(acteId).toBeTruthy();

    // l'arrêté est créé « à signer », signataire = l'élu, position de signature par défaut posée
    const a = (await as(admin).get(`${base()}/actes/${acteId}`)).body;
    expect(a.statut).toBe('a_signer');
    expect(a.signaturePosition).toBeTruthy();
    expect(a.custom?.collecteur?.collecteurId).toBe(collecteur.id);

    const etat = (await as(admin).get(`${base()}/parapheur/actes/${acteId}`)).body;
    expect(etat.envoi?.statut).toBe('a_signer');
    expect(etat.envoi?.signataireEmail).toBe(elu.email);

    // la pièce a été déplacée dans _traites/<date>/racine, la source est nettoyée
    const jour = new Date().toISOString().slice(0, 10);
    expect(fs.existsSync(path.join(dir, '_traites', jour, 'racine', 'arrete-voirie.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'arrete-voirie.pdf'))).toBe(false);
  });

  it('moissonne un dossier : pièce incertaine → arrêté en brouillon, attente + alerte, pièce laissée', async () => {
    fs.writeFileSync(path.join(dir2, 'a-classer.pdf'), await pdf('Document sans en-tete ni destinataire precis'));
    const c = (await as(admin).post(`${base()}/collecteurs`, {
      nom: 'En vrac', type: 'dossier', intervalle: '24h', config: { cible: dir2, sousDossiers: 'gauche', mouvement: 'deplacer' },
    })).body;

    const r = (await as(admin).post(`${base()}/collecteurs/${c.id}/collecter`, {})).body;
    expect(r.attentes).toBe(1);

    const journal = (await as(admin).get(`${base()}/collecteurs/${c.id}/collectes`)).body.items;
    expect(journal[0].statut).toBe('attente');
    expect(journal[0].detail.incertains.length).toBeGreaterThan(0);

    const a = (await as(admin).get(`${base()}/actes/${journal[0].acte_id}`)).body;
    expect(a.statut).toBe('brouillon');

    // la pièce reste sur place pour revue
    expect(fs.existsSync(path.join(dir2, 'a-classer.pdf'))).toBe(true);

    // l'administration a été alertée
    const notif = await env.db.get("SELECT count(*)::int AS c FROM notifications WHERE rule_code = 'collecteur.attente'");
    expect(notif.c).toBeGreaterThan(0);
  });

  it('au retour de signature, l’arrêté signé est déposé dans « signe » et un courriel de retour part', async () => {
    const avant = env.mail.state.sent.length;
    const r = await as(admin).post(`${base()}/parapheur/actes/${acteId}/retour`, { statut: 'signe' });
    expect(r.status).toBe(200);

    const a = (await as(admin).get(`${base()}/actes/${acteId}`)).body;
    expect(a.statut).toBe('signe');

    // dépôt dans le dossier « signe » du collecteur
    const signe = path.join(dir, 'signe');
    expect(fs.existsSync(signe)).toBe(true);
    expect(fs.readdirSync(signe)).toContain('arrete-voirie.pdf');

    // courriel de retour avec le document signé en pièce jointe
    const envois = env.mail.state.sent.slice(avant);
    const retour = envois.find((m) => m.to === 'secretariat@ivry.test' && /sign/i.test(m.subject));
    expect(retour).toBeTruthy();
    expect(retour.attachments?.[0]?.filename).toBe('arrete-voirie.pdf');
  });

  it('journalise les pièces en erreur avec leur message', async () => {
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'vibedelib-col3-'));
    try {
      fs.writeFileSync(path.join(dir3, 'tableau.xlsx'), Buffer.from('PK not a pdf'));
      const c = (await as(admin).post(`${base()}/collecteurs`, {
        nom: 'Erreurs', type: 'dossier', intervalle: '24h', config: { cible: dir3, sousDossiers: 'gauche', mouvement: 'deplacer' },
      })).body;
      const r = (await as(admin).post(`${base()}/collecteurs/${c.id}/collecter`, {})).body;
      expect(r.erreurs).toBe(1);
      const journal = (await as(admin).get(`${base()}/collecteurs/${c.id}/collectes`)).body.items;
      expect(journal[0].statut).toBe('erreur');
      expect(journal[0].erreur).toMatch(/Extension/i);
    } finally { fs.rmSync(dir3, { recursive: true, force: true }); }
  });

  it('refuse la suppression d’un collecteur ayant déjà collecté', async () => {
    const r = await as(admin).del(`${base()}/collecteurs/${collecteur.id}`);
    expect(r.status).toBe(409);
  });
});