/**
 * Adaptateur MailPort — API centrale APM `POST /api/v1/mail/send` (permission `mail_send`, guide §3.3).
 * `content` = corps HTML seul : l'APM l'habille du gabarit institutionnel ; le pied de page passe en paramètres
 * (footer1..3, footerColor), jamais en dur ici (NOT-15).
 */
const { createHttpClient, call } = require('./http-client');
const { E } = require('../shared/errors');

function createApmMail(config) {
  const http = createHttpClient({ baseURL: config.apm.url, headers: { 'X-API-KEY': config.apm.key }, tls: config.tls });
  return {
    /** message : { to, subject, html, footer?:{ line1, line2, line3, color }, attachments?:[{ filename, content(base64) }] } */
    async send(message) {
      const body = { to: message.to, subject: message.subject, content: message.html };
      const f = message.footer || {};
      if (f.line1) body.footer1 = f.line1;
      if (f.line2) body.footer2 = f.line2;
      if (f.line3) body.footer3 = f.line3;
      if (f.color) body.footerColor = f.color;
      if (message.attachments?.length) body.attachments = message.attachments;
      const r = await call('APM mail/send', () => http.post('/api/v1/mail/send', body));
      if (r.status === 200 && (r.data?.status === 'success' || r.data?.success === true)) return { ok: true };
      throw E.upstream(`APM mail/send : HTTP ${r.status}${r.data?.message ? ` — ${r.data.message}` : ''}`);
    },
    async ping() { return 1; },
  };
}

module.exports = { createApmMail };
