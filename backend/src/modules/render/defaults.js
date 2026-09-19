/** Gabarits de mise en page par défaut (PRE-04) : utilisés tant qu'un organisme n'a pas défini les siens. */
const BASE = {
  marges: { haut: 25, bas: 25, gauche: 22, droite: 22 },
  police: { famille: 'interstate', taille: 11, interligne: 1.35, justifie: true },
  pied: { texte: '', pagination: true },
  entete: [],
  filigrane: 'PROJET — non définitif',
  a4Strict: true,
};

const DEFAULTS = {
  expose: { ...BASE, entete: [
    { texte: '{organisme}', align: 'center', taille: 11, gras: true, apres: 4 },
    { texte: 'EXPOSÉ DES MOTIFS', align: 'center', taille: 15, gras: true, encadre: true, apres: 10 },
    { texte: 'OBJET : {rubrique} — {titre}', align: 'left', taille: 11.5, gras: true, apres: 14 },
  ] },
  deliberation: { ...BASE, entete: [
    { texte: '{organisme}', align: 'center', taille: 11, gras: true, apres: 4 },
    { texte: 'EXTRAIT DU REGISTRE DES DÉLIBÉRATIONS', align: 'center', taille: 14, gras: true, encadre: true, apres: 6 },
    { texte: 'SÉANCE DU {date_seance}', align: 'center', taille: 11, gras: true, apres: 10 },
    { texte: 'OBJET : {rubrique} — {titre}', align: 'left', taille: 11.5, gras: true, apres: 14 },
  ] },
  dossier: { ...BASE },
  garde: { ...BASE, filigrane: '' },
  intercalaire: { ...BASE, filigrane: '' },
  sommaire: { ...BASE, filigrane: '' },
  odj: { ...BASE },
  convocation: { ...BASE, filigrane: '' },
  registre: { ...BASE, filigrane: '' },
};

/** Fusion profonde limitée aux clés connues : la configuration d'un organisme surcharge le défaut. */
function resolveConfig(docType, stored = {}) {
  const d = DEFAULTS[docType] || BASE;
  return {
    ...d, ...stored,
    marges: { ...d.marges, ...(stored.marges || {}) },
    police: { ...d.police, ...(stored.police || {}) },
    pied: { ...d.pied, ...(stored.pied || {}) },
    entete: stored.entete || d.entete,
  };
}

module.exports = { DEFAULTS, resolveConfig };
