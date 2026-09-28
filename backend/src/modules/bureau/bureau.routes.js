/**
 * Bureau en ligne (D39). Trois plans :
 *   - `GET  /organismes/:orgId/bureau` : ce que l'interface doit savoir (y a-t-il un moteur, quels formats, pourquoi pas) ;
 *   - `POST /organismes/:orgId/actes/:id/annexes/:annexeId/ouvrir` : configuration d'éditeur, droit `canAttach`
 *     (le même droit que le dépôt d'une annexe à cette étape du circuit) ;
 *   - `/api/v1/public/bureau/*` : les appels du moteur de documents — sans session, donc limités et protégés par une
 *     clé opaque (source de la session) ou le jeton HS256 partagé (rappel de sauvegarde).
 */
const { z } = require('zod');
const creerWopi = require('./wopi');

const Id = z.coerce.number().int().positive();
const Org = z.object({ orgId: Id });
const P = Org.extend({ id: Id });
const PA = P.extend({ annexeId: Id });
const PTx = P.extend({ textId: Id });
const Cle = z.object({ cle: z.string().regex(/^[0-9a-f]{32}$/, 'clé invalide') });
const CleSession = z.object({ cle: z.string().regex(/^[0-9a-f]{32}$/, 'clé de session invalide') });
const T = ['bureau'];

module.exports = ({ makeRouter, bureau, bureauPorts }) => {
  const org = makeRouter('/api/v1/organismes/:orgId');
  org.get('/bureau', { summary: 'Bureau en ligne : disponibilité et formats éditables', tags: T, org: true, params: Org },
    async (req, res) => res.json(await bureau.capabilities(req.ctx, req.org.id)));

  const r = makeRouter('/api/v1/organismes/:orgId/actes/:id/annexes');
  r.post('/:annexeId/ouvrir', {
    summary: 'Ouvre une annexe Word, Excel ou présentation dans le navigateur', tags: T, org: true, params: PA,
    description: "Renvoie la configuration d'éditeur (`sdk` + `config`). Le moteur de documents enregistre ensuite par "
      + "son propre rappel : chaque sauvegarde crée une version, l'ancienne reste consultable, le PDF est régénéré et la "
      + "recherche est réindexée. Une annexe figée (acte transmis, signé) ou un PDF ne sont pas ouvrables.",
  }, async (req, res) => {
    const mobile = /Android|iPhone|iPad|Mobile/i.test(String(req.get('user-agent') || ''));
    res.json(await bureau.ouvrirAnxene(req.ctx, req.org.id, req.valid.params.id, req.valid.params.annexeId, { mobile, userAgent: req.get('user-agent') }));
  });

  r.post('/:annexeId/enregistrer', {
    summary: 'Enregistre la session d’édition en cours (Sauvegarder et fermer)', tags: T, org: true, params: PA,
    description: "Demande au serveur de documents d'enregistrer maintenant le document ouvert, et **attend** que la "
      + "version soit réellement créée. La commande part du serveur : fermer l'onglet ensuite n'annule rien. L'objet "
      + "porte la clé de session renvoyée par l'ouverture.",
  }, async (req, res) => {
    const { cle } = CleSession.parse(req.body || {});
    res.json(await bureau.enregistrer(req.ctx, req.org.id, req.valid.params.id, req.valid.params.annexeId, cle));
  });

  const rtx = makeRouter('/api/v1/organismes/:orgId/actes/:id/textes');
  rtx.post('/:textId/ouvrir', {
    summary: "Ouvre un texte suivi (exposé, vus et considérants, délibéré) dans le bureau en ligne", tags: T, org: true, params: PTx,
    description: "Le texte (markdown) est converti en document Word et ouvert dans le serveur de documents. Chaque "
      + "enregistrement revient sous forme de .docx, est reconverti en markdown puis enregistré par le chemin ordinaire "
      + "du texte : nouvelle version, suivi des modifications et audit conservés. Le droit est celui de la rédaction.",
  }, async (req, res) => {
    const mobile = /Android|iPhone|iPad|Mobile/i.test(String(req.get('user-agent') || ''));
    res.json(await bureau.ouvrirTexte(req.ctx, req.org.id, req.valid.params.id, req.valid.params.textId, { mobile, userAgent: req.get('user-agent') }));
  });

  rtx.post('/:textId/enregistrer', {
    summary: 'Enregistre la session d’édition du texte en cours (Sauvegarder et fermer)', tags: T, org: true, params: PTx,
  }, async (req, res) => {
    const { cle } = CleSession.parse(req.body || {});
    res.json(await bureau.enregistrerTexte(req.ctx, req.org.id, req.valid.params.id, req.valid.params.textId, cle));
  });

  // ---- côté moteur de documents : sans session applicative.
  // PAS de limiteur de débit ici, contrairement aux autres routes : c'est une machine qui appelle, avec ses réessais,
  // et sa propre cadence d'enregistrement. Le quota par défaut (60 requêtes / 15 min) la coupait en plein travail
  // (429) et l'agent voyait « échec du téléchargement » puis « impossible d'enregistrer ». La protection tient à
  // l'adresse elle-même : clé de session opaque de 128 bits pour la source, jeton HS256 signé pour le rappel.
  const pub = makeRouter('/api/v1/public/bureau');
  pub.get('/fichier/:cle', { summary: 'Source d’une session d’édition (moteur de documents)', tags: T, auth: false, params: Cle, responses: { 200: 'Fichier' } },
    async (req, res) => {
      const f = await bureau.fichierDeSession(req.valid.params.cle);
      res.set({ 'Content-Type': f.mime, 'Content-Disposition': `attachment; filename="${encodeURIComponent(f.name)}"`, 'Cache-Control': 'private, no-store' }).send(f.buffer);
    });

  pub.post('/rappel', { summary: 'Rappel du moteur de documents (sauvegarde d’une annexe)', tags: T, auth: false },
    async (req, res) => res.json(await bureau.rappel(req)));

  pub.get('/source/:cle', { summary: 'Contenu transitoire pour la conversion PDF (moteur de documents)', tags: T, auth: false, params: Cle, responses: { 200: 'Fichier' } },
    async (req, res) => {
      const c = await bureau.source(req.valid.params.cle);
      res.set({ 'Content-Type': c.mime, 'Content-Disposition': `attachment; filename="${encodeURIComponent(c.nom)}"`, 'Cache-Control': 'private, no-store' }).send(c.buffer);
    });

  // ---- hôte WOPI (Collabora). Mêmes précautions que ci-dessus : pas de limiteur (le moteur appelle en boucle pendant
  // une session) et pas de session applicative (c'est Collabora qui appelle). La clé de session EST son jeton d'accès.
  const wopiPort = bureauPorts?.collabora;
  const wopi = wopiPort ? creerWopi({ bureau, port: wopiPort }) : null;
  let w = null;
  if (wopi) {
    w = makeRouter('/api/v1/public/bureau/wopi');
    w.get('/:cle', { summary: 'WOPI : état du document (CheckFileInfo)', tags: T, auth: false, params: Cle },
      async (req, res) => wopi.checkFileInfo(req, res));
    w.get('/:cle/contents', { summary: 'WOPI : document à éditer (GetFile)', tags: T, auth: false, params: Cle, responses: { 200: 'Fichier' } },
      async (req, res) => wopi.getFile(req, res));
    w.post('/:cle/contents', { summary: 'WOPI : document enregistré (PutFile)', tags: T, auth: false, params: Cle },
      async (req, res) => wopi.putFile(req, res));
    w.post('/:cle', { summary: 'WOPI : verrou d’écriture (LOCK / UNLOCK / REFRESH_LOCK / GET_LOCK)', tags: T, auth: false, params: Cle },
      async (req, res) => wopi.verrou(req, res));
    w.get('/:cle/verrou-utilisateur', { summary: 'WOPI : identifiant d’utilisateur (GET_RANDOM_USER_ID)', tags: T, auth: false, params: Cle },
      async (req, res) => wopi.randomUserId(req, res));
    for (const action of ['renommer', 'lien-partage', 'cobalt']) {
      w.post(`/:cle/${action}`, { summary: `WOPI : ${action} (non pris en charge)`, tags: T, auth: false, params: Cle },
        async (req, res) => wopi.nonSoute(req, res));
    }
  }

  return [org, r, rtx, pub, ...(w ? [w] : [])];
};
