const pino = require('pino');

/** Logs structurés (niveau, horodatage, contexte). Les secrets sont masqués : jamais de clé ni de mot de passe dans un log. */
function createLogger(level = 'info') {
  return pino({
    level,
    base: { app: 'vibedelib' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.authorization', 'req.headers["x-api-key"]', 'password', '*.password',
        '*.apiKey', '*.token', 'authorization', 'headers.authorization',
      ],
      censor: '[masqué]',
    },
  });
}

module.exports = { createLogger };
