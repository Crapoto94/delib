const { createDirectoryService } = require('../../src/modules/directory/directory.service');

const HUB = [
  { displayName: 'MERIEM KHAROUM', email: 'MKharoum@Ivry94.fr' }, { displayName: 'MERIEM FRIKHA', email: 'MFrikha@ivry94.fr' },
  { displayName: 'HELENE BOURDELET', email: 'hbourdelet@ivry94.fr' }, { displayName: 'MARYLINE MARTIAL-LUIT', email: 'mmartialluit@ivry94.fr' }, { displayName: 'MARTIAL SOLAGNE', email: 'msolagne@ivry94.fr' },
  { displayName: 'ELISABETH FRANCES', email: 'efrances@ivry94.fr' }, { displayName: 'JEROME FRANCES', email: 'jfrances@ivry94.fr' },
];
// l'annuaire RH ne comprend qu'un seul terme : « kharoum » trouve, « meriem kharoum » ne trouve rien
const adapter = { searchAgents: async (q) => (/\s/.test(q) ? [] : HUB.filter((h) => h.displayName.toLowerCase().includes(String(q).toLowerCase()) || h.email.toLowerCase().includes(String(q).toLowerCase()))) };
const svc = () => createDirectoryService({ db: { all: async () => [] }, adapter, config: { directoryCacheMs: 1000 }, log: { warn() {} } });

describe('recherche dans l\'annuaire RH (un seul terme à la fois)', () => {
  it('retrouve un agent par son nom complet en croisant les termes', async () => {
    const hits = await svc().searchByName('MERIEM KHAROUM');
    expect(hits.map((h) => h.email.toLowerCase())).toEqual(['mkharoum@ivry94.fr']);
  });
  it('accepte « NOM PRÉNOM » comme « PRÉNOM NOM » et ne renvoie rien pour un inconnu', async () => {
    expect((await svc().searchByName('KHAROUM Meriem')).length).toBe(1);
    expect(await svc().searchByName('PERSONNE INCONNUE')).toEqual([]);
  });
});

describe('noms des agents jamais connectés', () => {
  it('retrouve « Prénom NOM » à partir de l\'identifiant, même quand la recherche exacte échoue', async () => {
    const n = await svc().names(['hbourdelet', 'jfrances', 'mkharoum', 'inconnu.total']);
    expect(n.hbourdelet).toBe('Helene BOURDELET');
    expect(n.jfrances).toBe('Jerome FRANCES'); // parmi plusieurs « frances », celui dont l'adresse correspond
    expect(n.mkharoum).toBe('Meriem KHAROUM');
    expect(n['inconnu.total']).toBeUndefined();
  });
  it('retrouve un nom composé à trait d’union (« mmartialluit » -> « Maryline MARTIAL-LUIT »)', async () => {
    expect((await svc().names(['mmartialluit'])).mmartialluit).toBe('Maryline MARTIAL-LUIT');
  });
});
