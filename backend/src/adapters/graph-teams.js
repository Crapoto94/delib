/**
 * Adaptateur MeetingPort — réunions Microsoft Teams via Microsoft Graph (client credentials, permission d'application
 * Calendars.ReadWrite). On crée un ÉVÈNEMENT du calendrier de l'organisateur (TEAMS_ORGANIZER_UPN) avec `isOnlineMeeting`,
 * ce qui produit le lien Teams ; les invitations ne partent que si des participants sont fournis (attendees).
 * Sans TENANT / CLIENT / SECRET / ORGANIZER, `available()` est faux : on reste sur le lien saisi à la main.
 */
const axios = require('axios');
const { E } = require('../shared/errors');

function createGraphTeams(config) {
  const g = config.teams || {};
  const ok = () => !!(g.tenant && g.clientId && g.secret && g.organizer);
  let token = null;
  const getToken = async () => {
    if (token && token.exp > Date.now() + 60000) return token.value;
    const r = await axios.post(`https://login.microsoftonline.com/${g.tenant}/oauth2/v2.0/token`,
      new URLSearchParams({ client_id: g.clientId, client_secret: g.secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000, validateStatus: () => true });
    if (r.status !== 200) throw E.upstream(`Microsoft Graph (jeton) : HTTP ${r.status}`);
    token = { value: r.data.access_token, exp: Date.now() + r.data.expires_in * 1000 };
    return token.value;
  };
  const call = async (method, path, data) => {
    if (!ok()) throw E.conflict("La création automatique de réunions Teams n'est pas configurée (GRAPH_* et TEAMS_ORGANIZER_UPN) : collez un lien Teams");
    const r = await axios({ method, url: `https://graph.microsoft.com/v1.0${path}`, data, headers: { Authorization: `Bearer ${await getToken()}` }, timeout: 20000, validateStatus: () => true });
    if (r.status >= 400) throw E.upstream(`Microsoft Graph : HTTP ${r.status}${r.data?.error?.message ? ` — ${r.data.error.message}` : ''}`);
    return r.data;
  };
  const body = (m) => ({
    subject: m.subject, body: { contentType: 'HTML', content: m.body || '' },
    start: { dateTime: m.start, timeZone: 'UTC' }, end: { dateTime: m.end, timeZone: 'UTC' },
    location: m.lieu ? { displayName: m.lieu } : undefined,
    attendees: (m.attendees || []).map((a) => ({ emailAddress: { address: a.email, name: a.name }, type: 'required' })),
    isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness',
  });
  return {
    available: () => ok(),
    organizer: () => g.organizer || null,
    async create(m) {
      const d = await call('post', `/users/${encodeURIComponent(g.organizer)}/events`, body(m));
      return { id: d.id, joinUrl: d.onlineMeeting?.joinUrl || null, organizer: g.organizer };
    },
    async update(id, m) { await call('patch', `/users/${encodeURIComponent(g.organizer)}/events/${encodeURIComponent(id)}`, body(m)); },
    async cancel(id) { await call('delete', `/users/${encodeURIComponent(g.organizer)}/events/${encodeURIComponent(id)}`); },
  };
}
module.exports = { createGraphTeams };
