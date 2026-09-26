/**
 * Bureau en ligne — faux moteur de documents pour les tests.
 *
 * Aucun conteneur, aucun réseau, aucun OnlyOffice : l'objet implémente le même port `BureauPort` et se contente de
 * journaliser ce que l'application lui demande, puis de renvoyer un contenu « édité » que le test arme à la main.
 * Les rappels sont signés comme ceux du vrai moteur, pour que le test emprunte le même chemin de validation.
 */
const jwt = require('jsonwebtoken');

function createFakeBureau({ formats = ['docx', 'xlsx'], secret = 'secret-partage-bureau-de-test', pdf = null } = {}) {
  const journal = [];
  const aRenvoyer = { buffer: Buffer.from('PK\x03\x04contenu-edite'), ext: 'docx' };

  return {
    journal,
    moteur: 'fake',
    secret,
    /** Contenu que le moteur renverra au prochain rappel (le « Ctrl+S » du test). */
    armer({ buffer, ext = 'docx' }) { aRenvoyer.buffer = buffer; aRenvoyer.ext = ext; },
    /** Comme ONLYOFFICE, le moteur signe son rappel. */
    signerRappel(payload) { return jwt.sign(payload, secret); },

    capabilities: () => ({ enabled: true, formats, mobile: true, moteur: 'fake' }),

    open({ cle, nom, url, user, mobile }) {
      const ext = String(nom || '').split('.').pop().toLowerCase();
      if (!formats.includes(ext)) return null;
      journal.push({ type: 'ouverture', cle, nom, url, auteur: user?.username, mobile });
      return { sdk: 'fake://editeur', config: { cle, nom, mobile, forcesave: true, source: url } };
    },

    verifyCallback(req) {
      const brut = String(req?.get?.('authorization') || req?.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
      if (!brut) return { ok: false, code: 'jeton_absent' };
      try {
        const p = jwt.verify(brut, secret);
        return p?.key ? { ok: true, payload: p, jeton: brut } : { ok: false, code: 'cle_absente' };
      } catch { return { ok: false, code: 'signature_invalide' }; }
    },

    async readBack({ url, filetype } = {}) {
      journal.push({ type: 'relecture', statut: filetype, url: Boolean(url) });
      return { buffer: aRenvoyer.buffer, ext: aRenvoyer.ext };
    },

    /** Commande de sauvegarde : le vrai moteur rappellerait ensuite notre route ; le test appelle le rappel lui-même. */
    async forcerSauvegarde(cle) { journal.push({ type: 'sauvegarde-forcee', cle }); return { ok: true }; },

    /** Renvoie un PDF si le test en a fourni un (pour vérifier que le même moteur sert à la conversion) ; sinon
     *  la conversion est impossible et l'application doit se rabattre sur LibreOffice / Office. */
    async versPdf() { return pdf ? { buffer: pdf, moteur: 'fake' } : null; },
  };
}

module.exports = { createFakeBureau };
