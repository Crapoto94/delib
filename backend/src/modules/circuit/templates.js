/** Modèles de circuit prêts à l'emploi (CIR-67) : le circuit Ivry (workflow.png) et un circuit court. */
const titulaire = (fonction) => ({ kind: 'titulaire', fonction });
const groupe = (code) => ({ kind: 'groupe', code });

const IVRY_STANDARD = {
  start: 'redaction',
  steps: [
    { key: 'redaction', label: 'Rédaction', resolver: { kind: 'redacteur' }, canEdit: true },
    { key: 'resp_intermediaire', label: 'Responsable intermédiaire', resolver: titulaire('responsable_intermediaire'), optional: true, canEdit: true, slaDays: 3 },
    { key: 'chef_service', label: 'Chef de service', resolver: titulaire('chef_service'), canEdit: true, slaDays: 3 },
    { key: 'directeur', label: 'Directeur', resolver: titulaire('directeur'), canEdit: true, slaDays: 3 },
    { key: 'financier', label: 'Service financier', resolver: groupe('financier'), canEdit: true, slaDays: 5 },
    { key: 'juridique', label: 'Service juridique', resolver: groupe('juridique'), canEdit: true, slaDays: 5 },
    { key: 'dga', label: 'DGA', resolver: titulaire('dga'), canEdit: true, slaDays: 3 },
    { key: 'dgs', label: 'DGS', resolver: titulaire('dgs'), canEdit: true, slaDays: 5, nonDelegable: true, onDone: { statut: 'valide_dgs', event: 'acte.valide_dgs' } },
    { key: 'scc', label: 'SCC — Service Conseil et Contentieux', resolver: groupe('scc'), canEdit: true, slaDays: 5, onEnter: { statut: 'en_attente_scc' } },
  ],
  transitions: [
    { from: 'redaction', to: 'resp_intermediaire' },
    { from: 'resp_intermediaire', to: 'chef_service' },
    { from: 'chef_service', to: 'directeur' },
    { from: 'directeur', to: 'financier', when: { field: 'incidenceFinanciere', op: 'eq', value: true } },
    { from: 'directeur', to: 'juridique', otherwise: true },
    { from: 'financier', to: 'juridique' },
    { from: 'juridique', to: 'dga' },
    { from: 'dga', to: 'dgs' },
    { from: 'dgs', to: 'scc' },
  ],
};

const SIMPLE = {
  start: 'redaction',
  steps: [
    { key: 'redaction', label: 'Rédaction', resolver: { kind: 'redacteur' }, canEdit: true },
    { key: 'chef_service', label: 'Responsable de service', resolver: titulaire('chef_service'), canEdit: true, slaDays: 3 },
    { key: 'directeur', label: 'Direction', resolver: titulaire('directeur'), canEdit: true, slaDays: 3, onDone: { statut: 'valide_dgs', event: 'acte.valide_dgs' } },
    { key: 'scc', label: 'Secrétariat des instances', resolver: groupe('scc'), canEdit: true, slaDays: 5, onEnter: { statut: 'en_attente_scc' } },
  ],
  transitions: [
    { from: 'redaction', to: 'chef_service' },
    { from: 'chef_service', to: 'directeur' },
    { from: 'directeur', to: 'scc' },
  ],
};

const TEMPLATES = {
  'ivry-standard': { nom: 'Circuit Ivry (8 étapes, branche financière)', graph: IVRY_STANDARD, groupes: [['financier', 'Service financier'], ['juridique', 'Service juridique'], ['scc', 'SCC']] },
  'simple': { nom: 'Circuit court (3 étapes)', graph: SIMPLE, groupes: [['scc', 'Secrétariat des instances']] },
};

module.exports = { TEMPLATES, IVRY_STANDARD, SIMPLE };
