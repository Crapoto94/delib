/** Jeux de données communs (manifeste §7.4) : natures, rubriques, types d'acte, types d'annexe. */
const NATURES = [
  ['delib', 'Délibérations'],
  ['reglementaires', 'Actes réglementaires'],
  ['individuels', 'Actes individuels'],
  ['contrats', 'Contrats, conventions et avenants'],
  ['budgetaire', 'Documents budgétaires et financiers'],
  ['autres', 'Autres'],
];

// Les 40 rubriques d'AirsDelib (tri alphabétique sans tenir compte des accents)
const RUBRIQUES = [
  'ACTION SOCIALE', 'ASSURANCES', 'CITOYENNETÉ', 'COMMERCE', 'COMMUNICATION', 'CONTENTIEUX', 'COOPÉRATION INTERNATIONALE',
  'CULTURE', 'DÉLÉGATION DE SERVICE PUBLIC', 'DISPOSITIONS ORGANIQUES', 'ENFANCE', 'ENSEIGNEMENT', 'ENVIRONNEMENT',
  'ÉQUIPEMENTS PUBLICS', 'ESPACES PUBLICS', 'ÉTAT CIVIL', 'FINANCES', 'GESTION FONCIÈRE', 'GRAND PARIS', 'INTENDANCE GÉNÉRALE',
  'INTERCOMMUNALITÉ', 'JEUNESSE', 'LOGEMENT', 'NOUVELLES TECHNOLOGIES', 'OBSERVATOIRE LOCATIF', 'PERSONNEL', 'PETITE ENFANCE',
  'POLITIQUE DE LA VILLE', 'PRÉVENTION', "RÉGIE PUBLIQUE DE L'EAU", 'RELATIONS PUBLIQUES', 'RESSOURCES HUMAINES', 'SANTÉ',
  'SÉCURITÉ PUBLIQUE', 'SPORTS', 'SYNDICATS INTERCOMMUNAUX', 'URBANISME', 'VACANCES', 'VIE ASSOCIATIVE', 'VŒU',
];

// Chaque type d'acte porte ses composants obligatoires (§7.1) : exposé, nombre minimal de délibérations, nature par défaut.
const TYPES_ACTE = [
  { code: 'deliberation', libelle: 'Délibération', meta: { expose: 'required', minDeliberations: 1, natureCode: 'delib' } },
  { code: 'voeu', libelle: 'Vœu', meta: { expose: 'required', minDeliberations: 1, natureCode: 'delib' } },
];

const ANNEXE_TYPES = [
  ['annexe', 'Annexe'], ['convention', 'Convention'], ['plan', 'Plan'], ['budget', 'Document budgétaire'],
  ['courrier', 'Courrier'], ['avis', 'Avis'], ['autre', 'Autre pièce'],
];

module.exports = { NATURES, RUBRIQUES, TYPES_ACTE, ANNEXE_TYPES };
