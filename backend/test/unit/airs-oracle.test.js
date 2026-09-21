const { createAirsOracle } = require('../../src/adapters/airs-oracle');

describe('adaptateur source Oracle AIRS (sans réseau)', () => {
  it('est désactivé sans configuration', async () => {
    const src = createAirsOracle({ config: { airs: {} } });
    expect(src.configuree()).toBe(false);
    expect(src.cible()).toBeNull();
    await expect(src.extraire({})).rejects.toThrow(/non configurée/);
  });

  it('expose la cible et refuse une configuration partielle', () => {
    const complet = createAirsOracle({ config: { airs: { enabled: true, host: 'oracle02', port: 1524, service: 'PAIRS', user: 'u', password: 'p', connectString: 'oracle02:1524/PAIRS' } } });
    expect(complet.configuree()).toBe(true);
    expect(complet.cible()).toMatchObject({ service: 'PAIRS', hote: 'oracle02', port: 1524 });
    const partiel = createAirsOracle({ config: { airs: { enabled: false, connectString: 'oracle02:1524/PAIRS', user: 'u', password: 'p' } } });
    expect(partiel.configuree()).toBe(false);
  });
});
