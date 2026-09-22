/**
 * Adaptateur ParapheurPort — SIMULATEUR (mode « dev » sans Hub).
 *
 * Il tient lieu de parapheur tant que le Hub DSI n'est pas branché : l'envoi est accepté, l'état reste « en cours »,
 * et un retour peut être simulé (signature ou refus) depuis l'administration ou la fiche du dossier. Aucun réseau.
 * Le service journalise les échanges dans les mêmes conditions que l'adaptateur réel (voir `_echange`).
 */
function createParapheurSimulateur() {
  const dossiers = new Map(); // référence -> { statut, titre, signataires, documents, signeAt, motif }
  const refOf = () => `SIM-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  return {
    fournisseur: 'simulateur',

    async testConnexion() { return { ok: true, message: 'Parapheur en simulation : aucun envoi réel', details: { mode: 'simulation' } }; },

    async creer(_cfg, { titre, signataires, documents }) {
      const id = refOf();
      dossiers.set(id, { statut: 'en_cours', titre, signataires: (signataires || []).map((s) => s.email), documents: (documents || []).map((d) => d.nom), creeLe: new Date().toISOString() });
      return { id, reference: id, lien: null,
        _echange: { methode: 'POST', url: 'simulateur://parapheur', httpStatus: 201, corps: { titre, signataires: (signataires || []).map((s) => s.email), documents: (documents || []).map((d) => d.nom) }, reponse: { id, reference: id } } };
    },

    async statut(_cfg, ref) {
      const d = dossiers.get(ref) || { statut: 'en_cours' };
      return { statut: d.statut, signeAt: d.signeAt || null, motif: d.motif || null, brut: d,
        _echange: { methode: 'GET', url: `simulateur://parapheur/${ref}`, httpStatus: 200, reponse: d } };
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
