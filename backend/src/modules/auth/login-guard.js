const { E } = require('../../shared/errors');

/**
 * Verrouillage progressif des connexions : au-delà de maxFailures échecs dans la fenêtre, le compte est verrouillé
 * lockMs. Le compteur est en mémoire (une seule instance du backend) ; la limitation par IP est faite par
 * express-rate-limit. Le verrou ne révèle jamais si le compte existe.
 */
function createLoginGuard({ maxFailures = 5, windowMs = 15 * 60 * 1000, lockMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
  const state = new Map(); // clé -> { failures, first, lockedUntil }

  return {
    assertNotLocked(key) {
      const s = state.get(key);
      if (s?.lockedUntil && s.lockedUntil > now()) throw E.locked('Trop de tentatives : réessayez plus tard');
    },
    recordFailure(key) {
      const t = now();
      let s = state.get(key);
      if (!s || t - s.first > windowMs) s = { failures: 0, first: t, lockedUntil: 0 };
      s.failures++;
      if (s.failures >= maxFailures) s.lockedUntil = t + lockMs;
      state.set(key, s);
    },
    reset(key) { state.delete(key); },
  };
}

module.exports = { createLoginGuard };
