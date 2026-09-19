const fs = require('fs');
const https = require('https');
const axios = require('axios');
const { E } = require('../shared/errors');

/**
 * Client HTTP pour un service interne de la Ville (APM, Hub DSI).
 * TLS (SEC-16) : les certificats auto-signés sont acceptés CLIENT PAR CLIENT — avec l'autorité fournie
 * (VILLE_CA_FILE) ou, à défaut, un contournement limité à ce client. Jamais NODE_TLS_REJECT_UNAUTHORIZED=0.
 */
function createHttpClient({ baseURL, headers, tls, timeoutMs = 15000 }) {
  const opts = {};
  if (tls?.caFile) opts.ca = fs.readFileSync(tls.caFile);
  else if (tls?.allowSelfSigned) opts.rejectUnauthorized = false;
  return axios.create({
    baseURL,
    headers,
    timeout: timeoutMs,
    httpsAgent: new https.Agent(opts),
    validateStatus: (s) => s >= 200 && s < 500, // les 5xx sont traités comme une indisponibilité
  });
}

/** Exécute un appel et convertit toute panne réseau ou réponse 5xx en erreur 502 explicite. */
async function call(service, fn) {
  let r;
  try { r = await fn(); } catch (e) { throw E.upstream(`${service} : ${e.code || e.message}`); }
  if (r.status >= 500) throw E.upstream(`${service} : HTTP ${r.status}`);
  return r;
}

/** Réponses tantôt en tableau brut, tantôt { data: [...] } ou { <clé>: [...] }. */
function asList(d, ...keys) {
  if (Array.isArray(d)) return d;
  for (const k of ['data', ...keys]) if (Array.isArray(d?.[k])) return d[k];
  return [];
}

module.exports = { createHttpClient, call, asList };
