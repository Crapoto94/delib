// Initialisation de Swagger UI (fichier séparé : la CSP de la DMZ interdit les scripts en ligne).
// La spécification est relayée par nginx depuis le backend ; « Authorize » reçoit la clé d'API (vd_…).
window.ui = SwaggerUIBundle({
  url: '/api/v1/externe/openapi.json',
  dom_id: '#swagger-ui',
  deepLinking: true,
  persistAuthorization: false,
  docExpansion: 'list',
  tryItOutEnabled: true,
});
