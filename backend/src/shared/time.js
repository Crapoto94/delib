/** Jours ouvrés (samedis, dimanches et jours fériés exclus) — SLA des étapes, rétroplanning, échéances. */
const isoDay = (d) => d.toISOString().slice(0, 10);

function isBusinessDay(d, holidays = new Set()) {
  const wd = d.getUTCDay();
  return wd !== 0 && wd !== 6 && !holidays.has(isoDay(d));
}

/** Ajoute n jours ouvrés (n peut être négatif, ou fractionnaire : arrondi au supérieur). */
function addBusinessDays(from, n, holidays = new Set()) {
  const d = new Date(from.getTime());
  let left = Math.ceil(Math.abs(n)); const step = n < 0 ? -1 : 1;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + step);
    if (isBusinessDay(d, holidays)) left--;
  }
  return d;
}

/** Nombre de jours ouvrés entre deux dates (a exclu, b inclus). */
function businessDaysBetween(a, b, holidays = new Set()) {
  if (b <= a) return 0;
  const d = new Date(a.getTime()); let n = 0;
  while (d < b) { d.setUTCDate(d.getUTCDate() + 1); if (d <= b && isBusinessDay(d, holidays)) n++; }
  return n;
}

const TZ = 'Europe/Paris';
const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Date et heure « murales » à Paris : { y, m, d, h, min, iso (AAAA-MM-JJ), wd (0 = dimanche) }. */
function parisParts(date) {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const y = +p.year; const m = +p.month; const d = +p.day;
  return { y, m, d, h: +p.hour, min: +p.minute, iso: `${p.year}-${p.month}-${p.day}`, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** Instant UTC correspondant à jj/mm/aaaa hh:mm à Paris. */
function parisToDate(y, m, d, h = 0, min = 0) {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const seen = parisParts(new Date(guess));
  const offMin = Math.round((Date.UTC(seen.y, seen.m - 1, seen.d, seen.h, seen.min) - guess) / 60000);
  return new Date(guess - offMin * 60000);
}

const isSendWindow = (date, holidays = new Set(), from = 8, to = 18) => {
  const p = parisParts(date);
  return isBusinessDay(new Date(Date.UTC(p.y, p.m - 1, p.d)), holidays) && p.h >= from && p.h < to;
};

/** Premier instant d'envoi autorisé (jour ouvré, 8 h – 18 h heure de Paris) à partir de `date`. */
function nextSendWindow(date, holidays = new Set(), from = 8, to = 18) {
  if (isSendWindow(date, holidays, from, to)) return date;
  const p = parisParts(date);
  const day = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const todayOk = isBusinessDay(day, holidays) && p.h < from;
  let target = day;
  if (!todayOk) { target = addBusinessDays(day, 1, holidays); }
  return parisToDate(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(), from, 0);
}

module.exports = { addBusinessDays, businessDaysBetween, isBusinessDay, isoDay, parisParts, parisToDate, isSendWindow, nextSendWindow };
