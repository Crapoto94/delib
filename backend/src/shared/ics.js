/**
 * Générateur iCalendar (RFC 5545) minimal : c'est un FLUX d'abonnement (Outlook, Google, Apple…), jamais un fichier à envoyer.
 * Lignes terminées par CRLF, repliées à 75 octets, textes échappés, dates en UTC : Outlook les convertit à l'heure locale.
 */
const crlf = '\r\n';

/** Échappe un texte (RFC 5545 §3.3.11). */
const echappe = (t) => String(t ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Replie une ligne à 75 octets (les caractères multi-octets ne sont jamais coupés). */
function replie(ligne) {
  const out = []; let cur = ''; let n = 0;
  for (const ch of ligne) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; }
    cur += ch; n += b;
  }
  out.push(cur);
  return out.join(`${crlf} `);
}

/** Date ISO / Date → « 20261104T193000Z ». */
const utc = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const jour = (d) => new Date(d).toISOString().slice(0, 10).replace(/-/g, '');

/**
 * Un événement. `debut`/`fin` : instants ; `journee: true` : événement d'une journée entière à la date de `debut`.
 * `statut` : CONFIRMED | TENTATIVE | CANCELLED. `sequence` : à incrémenter à chaque changement (les agendas remplacent l'ancienne version).
 */
function evenement({ uid, debut, fin, journee = false, resume, lieu, description, url, statut = 'CONFIRMED', sequence = 0, modifie, categories }) {
  const l = ['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${utc(modifie || new Date())}`];
  if (journee) { l.push(`DTSTART;VALUE=DATE:${jour(debut)}`); l.push(`DTEND;VALUE=DATE:${jour(new Date(new Date(debut).getTime() + 86400000))}`); }
  else { l.push(`DTSTART:${utc(debut)}`); l.push(`DTEND:${utc(fin || new Date(new Date(debut).getTime() + 3600000))}`); }
  l.push(`SUMMARY:${echappe(resume)}`);
  if (lieu) l.push(`LOCATION:${echappe(lieu)}`);
  if (description) l.push(`DESCRIPTION:${echappe(description)}`);
  if (url) l.push(`URL:${url}`);
  if (categories?.length) l.push(`CATEGORIES:${categories.map(echappe).join(',')}`);
  l.push(`STATUS:${statut}`, `SEQUENCE:${sequence}`, `TRANSP:${journee ? 'TRANSPARENT' : 'OPAQUE'}`);
  if (modifie) l.push(`LAST-MODIFIED:${utc(modifie)}`);
  l.push('END:VEVENT');
  return l;
}

/** Le calendrier complet : `nom` est le titre affiché dans l'agenda ; l'actualisation est demandée toutes les heures. */
function calendrier({ nom, description, evenements }) {
  const l = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//VibeDelib//Calendrier des seances//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${echappe(nom)}`, 'X-WR-TIMEZONE:Europe/Paris', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  if (description) l.push(`X-WR-CALDESC:${echappe(description)}`);
  for (const e of evenements) l.push(...e);
  l.push('END:VCALENDAR');
  return `${l.map(replie).join(crlf)}${crlf}`;
}

module.exports = { echappe, replie, evenement, calendrier, utc };
