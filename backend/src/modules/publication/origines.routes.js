module.exports = ({ makeRouter, origines }) => {
  const r = makeRouter('/api/v1/public/publication');
  r.get('/origines', {
    summary: 'Sites autorisés à intégrer les pages publiques (usage interne du relais DMZ)', tags: ['publication'], auth: false, responses: { 204: 'Liste dans l’en-tête X-Frame-Ancestors' },
    description: 'Interrogé par le nginx de la DMZ (auth_request) avant de servir une page à intégrer : l’en-tête `X-Frame-Ancestors` alimente la directive CSP `frame-ancestors`. Non relayé vers l’extérieur.',
  }, async (req, res) => { res.setHeader('X-Frame-Ancestors', await origines.frameAncestors()); res.setHeader('Cache-Control', 'no-store'); res.status(204).end(); });
  return [r];
};
