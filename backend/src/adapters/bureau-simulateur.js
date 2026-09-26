/**
 * Bureau en ligne — moteur SIMULATEUR (port `BureauPort`).
 *
 * Comportement par défaut de la plateforme : aucun serveur de documents n'est déployé, donc aucune annexe n'est
 * éditable dans le navigateur et la conversion PDF reste affidée à LibreOffice / Microsoft Office (voir shared/convert.js).
 * Ce que ce « moteur » apporte, c'est de ne jamais faire échouer l'existant : les tests et le développement local
 * utilisent le même adaptateur que la production, avec `enabled: false` au lieu d'un `if (!bureau)` dispersé.
 */
function createBureauSimulateur() {
  return {
    moteur: 'simulateur',
    capabilities: () => ({ enabled: false, formats: [], mobile: false, moteur: 'simulateur' }),
    open: () => null,
    verifyCallback: () => ({ ok: false, code: 'moteur_absent' }),
    readBack: () => null,
    forcerSauvegarde: () => ({ ok: false, erreur: 'moteur_absent' }),
    versPdf: async () => null,
  };
}

module.exports = { createBureauSimulateur };
