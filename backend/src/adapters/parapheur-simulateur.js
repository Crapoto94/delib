/**
 * Adaptateur ParapheurPort — SIMULATEUR (mode « dev » sans Hub).
 *
 * Il tient lieu de parapheur tant que le Hub DSI n'est pas branché : l'envoi est accepté, l'état reste « en cours »,
 * et un retour peut être simulé (signature ou refus) depuis l'administration ou la fiche du dossier. Aucun réseau.
 * Le service journalise les échanges dans les mêmes conditions que l'adaptateur réel (voir `_echange`).
 */
const { E } = require('../shared/errors');

function createParapheurSimulateur() {
  const dossiers = new Map(); // référence -> { statut, titre, signataires, documents, signeAt, motif }
  const refOf = () => `SIM-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  return {
    fournisseur: 'simulateur',

    async testConnexion() { return { ok: true, message: 'Parapheur en simulation : aucun envoi réel', details: { mode: 'simulation' } }; },

    async creer(_cfg, { titre, signataires, documents }) {
      const id = refOf();
      // Les pièces sont conservées : en simulation, le « document signé » renvoyé est l'original (aucune signature réelle).
      const docs = (documents || []).map((d, i) => ({ id: i + 1, nom: d.nom, buffer: d.buffer, mime: d.mime || 'application/pdf' }));
      dossiers.set(id, { statut: 'en_cours', titre, signataires: (signataires || []).map((s) => s.email), documents: docs, creeLe: new Date().toISOString() });
      return { id, reference: id, lien: null,
        _echange: { methode: 'POST', url: 'simulateur://parapheur', httpStatus: 201, corps: { titre, signataires: (signataires || []).map((s) => s.email), documents: docs.map((d) => d.nom) }, reponse: { id, reference: id } } };
    },

    async statut(_cfg, ref) {
      const d = dossiers.get(ref) || { statut: 'en_cours' };
      const documents = (d.documents || []).map((x) => ({ id: x.id, nom: x.nom, signe: d.statut === 'signe' }));
      return { statut: d.statut, signeAt: d.signeAt || null, motif: d.motif || null, documents, brut: { ...d, documents: (d.documents || []).map((x) => x.nom) },
        _echange: { methode: 'GET', url: `simulateur://parapheur/${ref}`, httpStatus: 200, reponse: { ...d, documents: (d.documents || []).map((x) => x.nom) } } };
    },

    /** En simulation, le document « signé » est la pièce envoyée telle quelle (aucun parapheur réel). */
    async telechargerDocument(_cfg, ref, docId) {
      const d = dossiers.get(ref) || {};
      const doc = (d.documents || []).find((x) => String(x.id) === String(docId)) || (d.documents || [])[0];
      if (!doc) throw E.notFound('Aucun document dans ce dossier simulé');
      return { buffer: doc.buffer, name: doc.nom || `document-signe-${docId}.pdf`, mime: doc.mime || 'application/pdf' };
    },

    async annuler(_cfg, ref) {
      const d = dossiers.get(ref) || {}; dossiers.set(ref, { ...d, statut: 'annule' });
      return { _echange: { methode: 'POST', url: `simulateur://parapheur/${ref}/annuler`, httpStatus: 200, reponse: { statut: 'annule' } } };
    },

    /** Simulation du retour du parapheur (signature ou refus), utilisée par le service en mode dev. */
    retour(ref, { statut = 'signe', motif = null } = {}) {
      const d = dossiers.get(ref) || {}; dossiers.set(ref, { ...d, statut, motif, ...(statut === 'signe' ? { signeAt: new Date().toISOString() } : {}) });
    },
  };
}

module.exports = { createParapheurSimulateur };
