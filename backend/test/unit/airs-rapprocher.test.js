const { rapprocher } = require('../../src/modules/import-airs/airs.service');

describe('rapprochement des directions et services AIRS → VibeDélib', () => {
  const directions = [{ code: 'BF', label: 'Direction des Finances' }, { code: 'RH', label: 'Direction des Ressources Humaines' }];
  const services = [{ code: 'BF1', label: 'Direction des Finances' }, { code: 'BF2', label: 'Service Comptabilité' }];

  it('une direction matche sans son chiffre (BF1 → direction BF)', () => {
    expect(rapprocher('BF1', directions, 'direction')).toMatchObject({ cibleCode: 'BF', confiance: 0.95 });
    expect(rapprocher('Direction des Finances - BF1', directions, 'direction')).toMatchObject({ cibleCode: 'BF' });
  });

  it('un service matche avec son code complet (BF1 → service BF1)', () => {
    expect(rapprocher('BF1', services, 'service')).toMatchObject({ cibleCode: 'BF1', confiance: 0.95 });
    expect(rapprocher('Service Comptabilité - BF2', services, 'service')).toMatchObject({ cibleCode: 'BF2' });
  });

  it('même libellé pour la direction et le service : le code tranche', () => {
    expect(rapprocher('BF1', directions, 'direction').cibleCode).toBe('BF');
    expect(rapprocher('BF1', services, 'service').cibleCode).toBe('BF1');
  });

  it('libellé exact quand aucun code n’est présent', () => {
    expect(rapprocher('Direction des Ressources Humaines', directions, 'direction')).toMatchObject({ cibleCode: 'RH', confiance: 0.9 });
  });

  it('aucun rapprochement possible', () => {
    expect(rapprocher('Direction inconnue', directions, 'direction')).toBeNull();
  });
});
