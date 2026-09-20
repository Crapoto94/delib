const { createDirectoryService } = require('../../src/modules/directory/directory.service');

const HUB = [
  { displayName: 'MERIEM KHAROUM', email: 'MKharoum@Ivry94.fr' }, { displayName: 'MERIEM FRIKHA', email: 'MFrikha@ivry94.fr' },
  { displayName: 'HELENE BOURDELET', email: 'hbourdelet@ivry94.fr' }, { displayName: 'MARYLINE MARTIAL-LUIT', email: 'mmartialluit@ivry94.fr' }, { displayName: 'NELLY LE NECH', email: 'nlenech@ivry94.fr' }, { displayName: 'ANAIS PRAT CORONA', email: 'apratcorona@ivry94.fr' },
  { displayName: 'MARTIAL SOLAGNE', email: 'msolagne@ivry94.fr' },
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
    const n = await svc().names(['nlenech', 'apratcorona']); // noms en plusieurs mots
    expect(n.nlenech).toBe('Nelly LE NECH'); expect(n.apratcorona).toBe('Anais PRAT CORONA');
  });
});

describe('agent dont la fiche RH n’a pas d’adresse e-mail : l’Active Directory en repli', () => {
  // cas réel : « FRANCE DESNEULIN » est dans le studio RH sans e-mail ; l’AD la connaît sous « DESNEULIN France » (fdesneulin)
  const rh = { searchAgents: async (q) => (String(q).toLowerCase() === 'desneulin' || String(q).toLowerCase() === 'france' ? [{ displayName: 'FRANCE DESNEULIN', email: null }] : []) };
  const AD = [{ username: 'fdesneulin', displayName: 'DESNEULIN France', givenName: null, surname: null, email: null }, { username: 'efrances', displayName: 'FRANCES Elisabeth', email: 'efrances@ivry94.fr' }];
  const ad = { searchUsers: async (q) => AD.filter((u) => u.displayName.toLowerCase().includes(String(q).toLowerCase())), getUser: async (id) => AD.find((u) => u.username === String(id).toLowerCase()) || null };
  const withAd = () => createDirectoryService({ db: { all: async () => [] }, adapter: rh, ad, config: { directoryCacheMs: 1000 }, log: { warn() {} } });

  it('retrouve l’identifiant par le nom complet, dans l’AD, quand l’annuaire RH n’en donne pas', async () => {
    expect(await withAd().loginsByName('FRANCE DESNEULIN')).toEqual(['fdesneulin']);
    expect(await withAd().loginsByName('PERSONNE INCONNUE')).toEqual([]);
  });
  it('sans AD, l’identifiant reste introuvable (aucune déduction hasardeuse)', async () => {
    expect(await svc().loginsByName('FRANCE DESNEULIN')).toEqual([]);
  });
  it('l’identifiant issu de l’adresse RH garde la priorité sur l’AD', async () => {
    expect(await svc().loginsByName('MERIEM KHAROUM')).toEqual(['mkharoum']);
  });
  it('affiche « Prénom NOM » d’après l’AD (qui écrit « NOM Prénom »)', async () => {
    const n = await withAd().names(['fdesneulin', 'efrances']);
    expect(n.fdesneulin).toBe('France DESNEULIN'); expect(n.efrances).toBe('Elisabeth FRANCES');
  });
});
