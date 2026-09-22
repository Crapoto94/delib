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

// Chaque type d'acte porte ses composants obligatoires (§7.1) : exposé, visas, nombre minimal de délibérations, nature par défaut.
// `expose` / `visas` valent 'none' pour les actes qui n'en comportent pas (une décision n'a ni exposé des motifs ni visas :
// juste la décision elle-même) ; `expose: 'optional'` laisse le texte disponible sans le rendre obligatoire.
// `signature: true` = acte signé par le maire (parapheur) à la fin du circuit, au lieu d'être inscrit au conseil.
// `autorisations: true` = l'acte doit lier les délibérations qui l'autorisent (décision prise par délégation du conseil).
// `aide` et `pastille` servent à la fenêtre de création (quel type choisir) et à la pastille de lecture des listes.
const AIDE_DELIBERATION = "Acte discuté et voté en conseil municipal. Il est inscrit à l'ordre du jour d'une séance : c'est le cas le plus courant (budget, subventions, conventions, urbanisme…).";
const AIDE_DECISION = "Acte pris par le maire dans le cadre d'une délégation consentie par le conseil municipal. Il ne passe PAS en conseil : à la fin du circuit, il part en signature du maire. Pensez à lier la ou les délibérations qui autorisent cette décision.";
const AIDE_ARRETE = "Acte réglementaire ou individuel que le maire prend au nom de la commune (arrêté de voirie, de police, arrêté individuel…). Il ne passe PAS en conseil : à la fin du circuit, il part en signature du maire.";
const TYPES_ACTE = [
  { code: 'deliberation', libelle: 'Délibération', meta: { expose: 'required', minDeliberations: 1, natureCode: 'delib', pastille: 'blue', aide: AIDE_DELIBERATION } },
  { code: 'voeu', libelle: 'Vœu', meta: { expose: 'required', minDeliberations: 1, natureCode: 'delib', pastille: 'blue', aide: "Simple expression d'une position ou d'un vœu de l'assemblée, sans portée décisionnelle. Comme une délibération, il est inscrit à l'ordre du jour d'une séance." } },
  { code: 'decision', libelle: 'Décision', meta: { expose: 'none', visas: 'none', minDeliberations: 1, natureCode: 'individuels', signature: true, autorisations: true, pastille: 'violet', aide: AIDE_DECISION } },
  { code: 'arrete', libelle: 'Arrêté', meta: { expose: 'required', minDeliberations: 1, natureCode: 'reglementaires', signature: true, pastille: 'indigo', aide: AIDE_ARRETE } },
];

const ANNEXE_TYPES = [
  ['annexe', 'Annexe'], ['convention', 'Convention'], ['plan', 'Plan'], ['budget', 'Document budgétaire'],
  ['courrier', 'Courrier'], ['avis', 'Avis'], ['autre', 'Autre pièce'],
];

module.exports = { NATURES, RUBRIQUES, TYPES_ACTE, ANNEXE_TYPES };
