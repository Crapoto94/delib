const { AppError } = require('../../shared/errors');

/** Corps d'erreur normalisé : { error, code, details? } — aucun détail interne n'est jamais renvoyé pour une erreur 500. */
function notFound(req, res) {
  res.status(404).json({ error: 'Route introuvable', code: 'NOT_FOUND' });
}

function errorHandler(log) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (err instanceof AppError) {
      if (err.status >= 500) log.error({ err: err.message, code: err.code, reqId: req.id }, 'erreur applicative');
      const body = { error: err.message, code: err.code };
      if (err.details) body.details = err.details;
      return res.status(err.status).json(body);
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide', code: 'BAD_REQUEST' });
    if (err?.name === 'MulterError') {
      const big = err.code === 'LIMIT_FILE_SIZE';
      return res.status(big ? 413 : 400).json({ error: big ? 'Fichier trop volumineux' : `Envoi invalide (${err.code})`, code: big ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST' });
    }
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Corps de requête trop volumineux', code: 'PAYLOAD_TOO_LARGE' });
    log.error({ err: err?.message, stack: err?.stack, reqId: req.id }, 'erreur non gérée');
    res.status(500).json({ error: 'Erreur interne', code: 'INTERNAL' });
  };
}

module.exports = { notFound, errorHandler };
