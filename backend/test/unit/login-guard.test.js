const { createLoginGuard } = require('../../src/modules/auth/login-guard');

describe('verrouillage des connexions', () => {
  it('verrouille après le nombre d\'échecs autorisé puis libère après le délai', () => {
    let t = 0;
    const g = createLoginGuard({ maxFailures: 3, windowMs: 1000, lockMs: 5000, now: () => t });
    for (let i = 0; i < 3; i++) { g.assertNotLocked('a'); g.recordFailure('a'); }
    expect(() => g.assertNotLocked('a')).toThrow(/Trop de tentatives/);
    t = 5001;
    expect(() => g.assertNotLocked('a')).not.toThrow();
  });

  it('un succès remet le compteur à zéro et les comptes sont indépendants', () => {
    const g = createLoginGuard({ maxFailures: 2 });
    g.recordFailure('a'); g.reset('a'); g.recordFailure('a');
    expect(() => g.assertNotLocked('a')).not.toThrow();
    g.recordFailure('b'); g.recordFailure('b');
    expect(() => g.assertNotLocked('b')).toThrow();
    expect(() => g.assertNotLocked('a')).not.toThrow();
  });

  it('les échecs anciens sortent de la fenêtre', () => {
    let t = 0;
    const g = createLoginGuard({ maxFailures: 2, windowMs: 1000, now: () => t });
    g.recordFailure('a'); t = 2000; g.recordFailure('a');
    expect(() => g.assertNotLocked('a')).not.toThrow();
  });
});
