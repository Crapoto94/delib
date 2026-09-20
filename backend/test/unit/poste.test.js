const { createDirectoryService } = require('../../src/modules/directory/directory.service');

const CHART = [
  { code: 'BF', label: "DIRECTION DES SYSTEMES D'INFORMATION", responsable: 'MARC CHEVALIER', poste: "DIRECTEUR·TRICE DES SYSTEMES D'INFORMATION", vacant: false,
    services: [{ code: 'BF1', label: 'PÔLE APPLICATIONS', responsable: 'CLAIRE MARTIN', poste: 'CHEF·FE DE PÔLE APPLICATIONS' }] },
  { code: 'CC', label: 'DIRECTION DES FINANCES', responsable: 'SOPHIE MOREAU', poste: 'DIRECTRICE DES FINANCES', vacant: false, services: [] },
];
const svc = (chart = CHART) => createDirectoryService({ db: null, adapter: { getOrganisationChart: async () => chart, searchAgents: async () => [], listDirections: async () => [] }, config: { directoryCacheMs: 1000 }, log: { warn() {} } });
const MARC = { displayName: 'MARC CHEVALIER', direction: "DIRECTION DES SYSTEMES D'INFORMATION", service: "DIRECTION DES SYSTEMES D'INFORMATION", poste: 'Directeur et expertise informatique' };

describe('poste affiché d\'après l\'organigramme', () => {
  it('le responsable d\'une direction porte l\'intitulé officiel de l\'organigramme (et non la fonction de la fiche RH)', async () => {
    expect(await svc().posteAffiche(MARC)).toBe("Directeur des systèmes d'information");
  });

  it('choisit le masculin ou le féminin d\'après la fiche RH, sinon garde la forme épicène — jamais d\'après le prénom', async () => {
    expect(await svc().posteAffiche({ ...MARC, poste: 'Directrice adjointe' })).toBe("Directrice des systèmes d'information");
    expect(await svc().posteAffiche({ ...MARC, poste: 'Expert informatique' })).toBe("Directeur·trice des systèmes d'information");
  });

  it('accepte les noms écrits « nom prénom » et « prénom nom », sans tenir compte de la casse ni des accents', async () => {
    expect(await svc().posteAffiche({ ...MARC, displayName: 'chevalier marc' })).toBe("Directeur des systèmes d'information");
    expect(await svc().posteAffiche({ ...MARC, displayName: null, nom: 'Chevalier', prenom: 'Marc' })).toBe("Directeur des systèmes d'information");
  });

  it('un responsable de service porte le poste de son service', async () => {
    const r = await svc().posteAffiche({ displayName: 'Claire Martin', direction: "DIRECTION DES SYSTEMES D'INFORMATION", service: 'PÔLE APPLICATIONS', poste: 'Cheffe de projet' });
    expect(r).toBe('Cheffe de pôle applications');
  });

  it('un agent qui n\'est pas responsable garde sa fonction RH', async () => {
    expect(await svc().posteAffiche({ ...MARC, displayName: 'PAUL DUPONT', poste: 'Technicien réseau' })).toBe('Technicien réseau');
    expect(await svc().posteAffiche({ displayName: 'MARC CHEVALIER', direction: 'DIRECTION DES FINANCES', service: null, poste: 'Analyste' })).toBe('Analyste');
  });

  it('organigramme indisponible : la fonction RH est conservée', async () => {
    const s = createDirectoryService({ db: null, adapter: { getOrganisationChart: async () => { throw new Error('Hub indisponible'); }, searchAgents: async () => [] }, config: { directoryCacheMs: 1000 }, log: { warn() {} } });
    expect(await s.posteAffiche(MARC)).toBe('Directeur et expertise informatique');
    expect(await s.posteAffiche({ displayName: 'X', poste: 'Y' })).toBe('Y');
  });

  it('la recherche d\'agents (sélecteur @) applique le même intitulé', async () => {
    const s = createDirectoryService({ db: null, adapter: { getOrganisationChart: async () => CHART, searchAgents: async () => [{ username: '336', ...MARC, email: 'MaChevalier@ivry94.fr' }] }, config: { directoryCacheMs: 1000 }, log: { warn() {} } });
    const [hit] = await s.searchAgents('chevalier');
    expect(hit.poste).toBe("Directeur des systèmes d'information");
  });
});
