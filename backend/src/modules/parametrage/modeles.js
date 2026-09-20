/**
 * Modèles de configuration prêts à importer (PAR-02, PAR-12) : point de départ d'un nouvel organisme (CCAS, autre commune).
 * Ils ne contiennent aucune personne ni aucun secret : les membres se saisissent ensuite à la main (élus ou non élus).
 */
const { TEMPLATES } = require('../circuit/templates');
const { FORMAT } = require('./configuration.service');

const MODELES = {
  'commune-neutre': {
    nom: 'Commune neutre (circuit court)',
    description: 'Instance délibérante, vocabulaire générique et circuit court à 3 étapes (rédacteur, validation, secrétariat des instances). À compléter : titulaires, membres, référentiels propres.',
    document: () => ({
      format: FORMAT, exporteLe: null, source: { code: 'commune-neutre', nom: 'Modèle « commune neutre »', type: 'autre' },
      organisme: { vocabulaire: { instance: 'Conseil', chef: 'Président·e', membre: 'membre', acte: 'délibération' }, couleurs: {} },
      parametres: {}, referentiels: { propres: [], surcharges: [] }, champs: [],
      circuits: [{ code: 'circuit-court', nom: TEMPLATES.simple.nom, typeActeCode: null, directionCode: null, graph: TEMPLATES.simple.graph }],
      instances: [{ code: 'conseil', nom: 'Conseil', kind: 'conseil', numbering: { pattern: '{ANNEE}-{N_SEANCE}-{ORDRE:03}' }, actif: true }],
    }),
  },
};

module.exports = { MODELES };
