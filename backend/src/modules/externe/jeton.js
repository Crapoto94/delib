/**
 * Jetons des liens publics : un lien de la page publique ne se devine pas et ne se fabrique pas. Il enveloppe
 * (type de document, acte, annexe) dans un chiffrement authentifié (AES-256-GCM) dont la clé est dérivée du secret du
 * serveur : sans lui, impossible de lire les numéros d'acte ni d'en forger un. Le vecteur d'initialisation est dérivé
 * du contenu (HMAC) pour qu'un même document garde la même adresse (mise en cache), sans révéler autre chose que
 * l'égalité de deux jetons.
 */
const crypto = require('crypto');

function createJetons(secret) {
  if (!secret) throw new Error('Secret serveur requis pour signer les liens publics');
  const cle = crypto.createHash('sha256').update(`vibedelib:publication:cle:${secret}`).digest();
  const siv = crypto.createHash('sha256').update(`vibedelib:publication:iv:${secret}`).digest();
  const b64 = (b) => b.toString('base64url');
  return {
    /** type : 'p' (délibération) ou 'a' (annexe). */
    creer({ type, acteId, annexeId = 0 }) {
      const clair = Buffer.from(JSON.stringify([type, acteId, annexeId]));
      const iv = crypto.createHmac('sha256', siv).update(clair).digest().subarray(0, 12);
      const c = crypto.createCipheriv('aes-256-gcm', cle, iv);
      const chiffre = Buffer.concat([c.update(clair), c.final()]);
      return b64(Buffer.concat([iv, c.getAuthTag(), chiffre]));
    },
    /** Renvoie { type, acteId, annexeId } ou null si le jeton est invalide, altéré ou forgé. */
    lire(jeton) {
      try {
        const b = Buffer.from(String(jeton), 'base64url');
        if (b.length < 29 || b.length > 200) return null;
        const d = crypto.createDecipheriv('aes-256-gcm', cle, b.subarray(0, 12));
        d.setAuthTag(b.subarray(12, 28));
        const [type, acteId, annexeId] = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString());
        if (!['p', 'a', 'r'].includes(type) || !Number.isInteger(acteId) || !Number.isInteger(annexeId)) return null;
        return { type, acteId, annexeId };
      } catch { return null; }
    },
  };
}

module.exports = { createJetons };
