/**
 * Adaptateur AiPort — IA interne via l'API centrale APM : POST /api/v1/ai/query (permission IA à demander à la DSI).
 * Le format exact de la réponse n'est pas figé dans le guide : on accepte les clés usuelles (response, answer, text, content).
 * Aucun contenu n'est envoyé hors de l'infrastructure de la Ville (CPY-05).
 */
const { createHttpClient, call } = require('./http-client');
const { E } = require('../shared/errors');

/**
 * Noms des modèles actifs. L'APM renvoie tous les modèles (actifs ou non) sous forme d'objets { id, name, model, is_active, … } ;
 * `POST /ai/query` attend le NOM (« Interne Gemma RGPD++ »), comme le fait appdsi. Chaînes brutes et {models:[…]} / {data:[…]} acceptés.
 */
function normalizeModels(body) {
  const d = body?.data ?? body;
  const raw = Array.isArray(d) ? d : (Array.isArray(d?.models) ? d.models : (Array.isArray(d?.items) ? d.items : []));
  // actifs, et capables de converser (l'APM liste aussi des modèles de transcription, inutilisables pour une consigne)
  const actifs = raw.filter((m) => typeof m !== 'object' || m === null || ((m.active !== undefined ? m.active : m.is_active) !== false && (!Array.isArray(m.capabilities) || m.capabilities.includes('chat'))));
  return [...new Set(actifs.map((m) => (typeof m === 'string' ? m : (m?.name || m?.label || m?.model || (m?.id !== undefined ? String(m.id) : null)))).filter(Boolean).map(String))];
}

function createApmAi(config) {
  const http = createHttpClient({ baseURL: config.apm.url, headers: { 'X-API-KEY': config.apm.key }, tls: config.tls, timeoutMs: 120000 });
  return {
    async query({ system, prompt, maxTokens = 2000, temperature = 0.2, model }) {
      const r = await call('APM ai/query', () => http.post('/api/v1/ai/query', { prompt: system ? `${system}\n\n${prompt}` : prompt, system, max_tokens: maxTokens, temperature, ...(model ? { model } : {}) }));
      if (r.status === 403) throw E.upstream("APM ai/query : la clé API n'a pas la permission IA");
      if (r.status !== 200) throw E.upstream(`APM ai/query : HTTP ${r.status}`);
      const d = r.data?.data ?? r.data;
      const text = [d?.response, d?.answer, d?.text, d?.content, d?.result, typeof d === 'string' ? d : null].find((x) => typeof x === 'string');
      if (!text) throw E.upstream('APM ai/query : réponse sans texte');
      return { text, model: d?.model || r.data?.model || null };
    },
    /** Modèles disponibles (GET /api/v1/ai/models) : liste de noms, quelle que soit la forme de la réponse. */
    async models() {
      const r = await call('APM ai/models', () => http.get('/api/v1/ai/models'));
      if (r.status !== 200) throw E.upstream(`APM ai/models : HTTP ${r.status}`);
      return normalizeModels(r.data);
    },
    async ping() { return 1; },
  };
}
module.exports = { createApmAi, normalizeModels };
