/**
 * Adaptateur « moisson de courrier » via l'API de la Ville (APM), proxy Microsoft Graph exposé aux applications
 * externes sous `/api/v1/o365/*` (clé API, permissions `o365_read` / `o365_manage`).
 * Aucun paramétrage Graph n'est stocké dans VibeDélib : l'API ville détient le tenant, le client et le secret, et
 * vise la boîte configurée ; un collecteur peut demander une autre boîte avec `?mailbox=`.
 * Contrat : lister(mailbox), telecharger(mailbox, messageId, attachmentId), confirmer(mailbox, messageId),
 * supprimer(mailbox, messageId), tester(mailbox).
 */
const { createHttpClient, call } = require('./http-client');
const { E } = require('../shared/errors');

function createApmO365(config) {
  const http = createHttpClient({ baseURL: config.apm.url, headers: { 'X-API-KEY': config.apm.key }, tls: config.tls, timeoutMs: 60000 });

  const req = async (label, fn) => {
    const r = await call(label, fn);
    if (r.status >= 400) throw E.upstream(`${label} : HTTP ${r.status}${r.data?.error ? ` — ${r.data.error}` : ''}`);
    return r.data;
  };
  const params = (mailbox) => (mailbox ? { mailbox } : {});

  return {
    /** Vérifie que la boîte est joignable (liste un message). */
    async tester(mailbox) {
      await req('APM o365/messages', () => http.get('/api/v1/o365/messages', { params: { ...params(mailbox), top: 1 } }));
      return true;
    },
    /**
     * Liste les messages non lus ayant des pièces jointes, avec leurs pièces.
     * Retour : [{ id, sujet, de, date, pieces: [{ id, nom, taille, mime }] }]
     */
    async lister(mailbox) {
      const msgs = await req('APM o365/messages', () => http.get('/api/v1/o365/messages', { params: { ...params(mailbox), unread: 1, attachments: 1, top: 50 } }));
      const out = [];
      for (const m of msgs || []) {
        const pieces = m.hasAttachments
          ? (await req('APM o365/attachments', () => http.get(`/api/v1/o365/messages/${encodeURIComponent(m.id)}/attachments`, { params: params(mailbox) }))) || []
          : [];
        out.push({
          id: m.id,
          sujet: m.subject || '(sans objet)',
          de: m.from?.emailAddress?.address || null,
          date: m.receivedDateTime || null,
          pieces: pieces.filter((p) => (p.size || 0) > 0 && p.isInline !== true).map((p) => ({ id: p.id, nom: p.name || 'piece', taille: p.size || 0, mime: p.contentType || null })),
        });
      }
      return out;
    },
    /** Contenu binaire d'une pièce jointe (l'API renvoie le contenu en base64). */
    async telecharger(mailbox, messageId, attachmentId) {
      const d = await req('APM o365/attachment', () => http.get(`/api/v1/o365/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, { params: params(mailbox) }));
      if (!d?.contentBytes) throw E.upstream('APM o365 : pièce jointe sans contenu');
      return Buffer.from(d.contentBytes, 'base64');
    },
    /** Marque le message lu. */
    async confirmer(mailbox, messageId) {
      await req('APM o365/messages', () => http.patch(`/api/v1/o365/messages/${encodeURIComponent(messageId)}`, { isRead: true }, { params: params(mailbox) }));
    },
    /** Supprime le message (Éléments supprimés). */
    async supprimer(mailbox, messageId) {
      await req('APM o365/messages', () => http.delete(`/api/v1/o365/messages/${encodeURIComponent(messageId)}`, { params: params(mailbox) }));
    },
  };
}
module.exports = { createApmO365 };