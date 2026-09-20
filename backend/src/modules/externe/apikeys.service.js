/**
 * Clés d'API (EXT-01, EXT-05, D97). Format : `vd_<préfixe 8 hex>_<secret 32 car.>`. Seule l'empreinte SHA-256 du secret est conservée ;
 * la clé complète n'est renvoyée qu'à la création (ou au renouvellement). Contrôle à chaque appel : clé connue, active, non expirée,
 * adresse IP autorisée, débit respecté. Le middleware n'ouvre AUCUNE portée par lui-même : chaque route vérifie les portées de la clé.
 */
const crypto = require('crypto');
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const PORTEES = {
  'actes:executoires': 'Actes revenus du contrôle de légalité (AR reçu, publiés, exécutoires, archivés) : métadonnées, texte adopté, PDF, annexes publiables',
  'actes:adoptes': 'Délibérations adoptées, avant ou pendant la transmission : mêmes contenus, marqués « adopté, pas encore exécutoire »',
  'actes:encours': 'Actes en rédaction ou en circuit : métadonnées seulement (jamais les textes, PDF ni annexes)',
};
const FORMAT = /^vd_([0-9a-f]{8})_([A-Za-z0-9_-]{32})$/;
const sha = (x) => crypto.createHash('sha256').update(String(x)).digest('hex');
const same = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

const ip4 = (s) => { const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s); return m && m.slice(1).every((x) => Number(x) <= 255) ? (((Number(m[1]) << 24) >>> 0) + (Number(m[2]) << 16) + (Number(m[3]) << 8) + Number(m[4])) >>> 0 : null; };
/** Adresse autorisée ? Liste vide = toutes ; entrées : IP exacte ou réseau IPv4 a.b.c.d/nn ; les adresses IPv6 « mappées » (::ffff:1.2.3.4) sont ramenées en IPv4. */
function ipAutorisee(ip, liste) {
  if (!liste?.length) return true;
  const a = String(ip || '').replace(/^::ffff:/, '');
  return liste.some((e) => {
    if (e === a) return true;
    const [reseau, bits] = String(e).split('/');
    if (bits === undefined) return false;
    const n = ip4(a); const r = ip4(reseau); const b = Number(bits);
    if (n === null || r === null || !(b >= 0 && b <= 32)) return false;
    const masque = b === 0 ? 0 : (0xFFFFFFFF << (32 - b)) >>> 0;
    return ((n & masque) >>> 0) === ((r & masque) >>> 0);
  });
}
const valideIps = (ips) => { for (const e of ips || []) { const [r, b] = String(e).split('/'); const ok = (ip4(r) !== null && (b === undefined || (/^\d{1,2}$/.test(b) && Number(b) <= 32))) || /^[0-9a-f:]+$/i.test(e); if (!ok) throw E.badRequest(`Adresse IP ou réseau invalide : ${e}`); } };

function createApiKeys({ db, audit, log }) {
  const fenetres = new Map(); // id -> [horodatages] (débit par clé, en mémoire)

  const vue = (r) => ({
    id: r.id, nom: r.nom, prefixe: `vd_${r.prefixe}_…`, portees: r.portees, ips: r.ips, limiteMinute: r.limite_minute, expireLe: r.expire_le, actif: r.actif && !r.revoquee_le && (!r.expire_le || new Date(r.expire_le) > new Date()),
    revoquee: !!r.revoquee_le, revoqueeLe: r.revoquee_le, dernierUsage: r.dernier_usage, nbAppels: Number(r.nb_appels), creePar: r.created_by, creeLe: r.created_at,
  });
  function verifPortees(portees) {
    if (!Array.isArray(portees) || !portees.length) throw E.badRequest('Choisissez au moins un droit pour cette clé');
    for (const p of portees) if (!PORTEES[p]) throw E.badRequest(`Droit inconnu : ${p}`);
    return [...new Set(portees)];
  }
  function genere() {
    const prefixe = crypto.randomBytes(4).toString('hex'); const secret = crypto.randomBytes(24).toString('base64url');
    return { prefixe, secret, cle: `vd_${prefixe}_${secret}` };
  }

  const svc = {
    PORTEES, ipAutorisee,

    async lister(organismeId) { return (await db.all('SELECT * FROM api_keys WHERE organisme_id = $1 ORDER BY id DESC', [requireOrg(organismeId)])).map(vue); },

    /** Crée une clé : la clé complète n'est renvoyée QUE ici. */
    async creer(ctx, organismeId, b, { remplace = null } = {}) {
      const org = requireOrg(organismeId); const portees = verifPortees(b.portees); valideIps(b.ips);
      if (b.expireLe && new Date(b.expireLe) <= new Date()) throw E.badRequest('La date d\'expiration doit être dans le futur');
      const k = genere();
      const r = await db.get(
        `INSERT INTO api_keys (organisme_id, nom, prefixe, secret_hash, portees, ips, limite_minute, expire_le, remplace_id, created_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10) RETURNING *`,
        [org, b.nom, k.prefixe, sha(k.secret), JSON.stringify(portees), JSON.stringify(b.ips || []), b.limiteMinute ?? 120, b.expireLe ?? null, remplace, ctx.username]);
      await audit.log(ctx, { organismeId: org, action: 'cle_api.creation', entity: 'api_keys', entityId: r.id, after: { nom: b.nom, portees, ips: b.ips || [], expireLe: b.expireLe ?? null } }); // jamais la clé
      return { ...vue(r), cle: k.cle };
    },

    async modifier(ctx, organismeId, id, b) {
      const org = requireOrg(organismeId);
      const cur = await db.get('SELECT * FROM api_keys WHERE id = $1 AND organisme_id = $2', [id, org]);
      if (!cur) throw E.notFound('Clé introuvable');
      if (cur.revoquee_le) throw E.conflict('Cette clé est révoquée : créez-en une nouvelle');
      const set = []; const p = [id]; const add = (c, v, cast = '') => { p.push(v); set.push(`${c} = $${p.length}${cast}`); };
      if (b.nom !== undefined) add('nom', b.nom);
      if (b.portees !== undefined) add('portees', JSON.stringify(verifPortees(b.portees)), '::jsonb');
      if (b.ips !== undefined) { valideIps(b.ips); add('ips', JSON.stringify(b.ips), '::jsonb'); }
      if (b.limiteMinute !== undefined) add('limite_minute', b.limiteMinute);
      if (b.expireLe !== undefined) add('expire_le', b.expireLe);
      if (b.actif !== undefined) add('actif', b.actif);
      if (!set.length) return vue(cur);
      const r = await db.get(`UPDATE api_keys SET ${set.join(', ')} WHERE id = $1 RETURNING *`, p);
      await audit.log(ctx, { organismeId: org, action: 'cle_api.modification', entity: 'api_keys', entityId: id, before: { portees: cur.portees, actif: cur.actif }, after: { portees: r.portees, actif: r.actif } });
      return vue(r);
    },

    async revoquer(ctx, organismeId, id) {
      const org = requireOrg(organismeId);
      const r = await db.get('UPDATE api_keys SET actif = false, revoquee_le = now(), revoquee_par = $3 WHERE id = $1 AND organisme_id = $2 AND revoquee_le IS NULL RETURNING *', [id, org, ctx.username]);
      if (!r) throw E.notFound('Clé introuvable ou déjà révoquée');
      await audit.log(ctx, { organismeId: org, action: 'cle_api.revocation', entity: 'api_keys', entityId: id });
      return vue(r);
    },

    /** Renouvelle : nouvelle clé aux mêmes droits, l'ancienne est révoquée immédiatement (ou laissée jusqu'à `finAncienneLe` pour une bascule en douceur). */
    async renouveler(ctx, organismeId, id, { finAncienneLe } = {}) {
      const org = requireOrg(organismeId);
      const cur = await db.get('SELECT * FROM api_keys WHERE id = $1 AND organisme_id = $2', [id, org]);
      if (!cur || cur.revoquee_le) throw E.notFound('Clé introuvable ou déjà révoquée');
      const nouvelle = await svc.creer(ctx, org, { nom: cur.nom, portees: cur.portees, ips: cur.ips, limiteMinute: cur.limite_minute, expireLe: cur.expire_le && new Date(cur.expire_le) > new Date() ? cur.expire_le : null }, { remplace: id });
      if (finAncienneLe) await db.run('UPDATE api_keys SET expire_le = $2 WHERE id = $1', [id, finAncienneLe]); else await svc.revoquer(ctx, org, id);
      await audit.log(ctx, { organismeId: org, action: 'cle_api.renouvellement', entity: 'api_keys', entityId: id, after: { nouvelle: nouvelle.id } });
      return nouvelle;
    },

    /** Middleware d'authentification : Bearer ou X-API-Key. Renseigne req.apiKey = { id, organismeId, nom, portees }. */
    authenticate: async (req, res, next) => {
      try {
        const h = req.headers.authorization || '';
        const brut = (h.startsWith('Bearer ') ? h.slice(7) : req.headers['x-api-key'] || '').trim();
        const m = FORMAT.exec(brut);
        const refus = () => E.unauthorized('Clé d\'API invalide, expirée ou révoquée');
        if (!m) throw refus();
        const r = await db.get('SELECT * FROM api_keys WHERE prefixe = $1', [m[1]]);
        if (!r || !same(sha(m[2]), r.secret_hash) || !r.actif || r.revoquee_le || (r.expire_le && new Date(r.expire_le) <= new Date())) throw refus();
        if (!ipAutorisee(req.ip, r.ips)) throw E.forbidden('Adresse IP non autorisée pour cette clé');
        // débit : fenêtre glissante d'une minute, par clé
        const t = Date.now(); const w = (fenetres.get(r.id) || []).filter((x) => t - x < 60000);
        if (w.length >= r.limite_minute) { res.setHeader('Retry-After', '30'); throw E.tooMany("Trop d'appels : limite de la clé atteinte"); }
        w.push(t); fenetres.set(r.id, w);
        db.run('UPDATE api_keys SET nb_appels = nb_appels + 1, dernier_usage = CASE WHEN dernier_usage IS NULL OR dernier_usage < now() - interval \'1 minute\' THEN now() ELSE dernier_usage END WHERE id = $1', [r.id]).catch((e) => log?.warn?.({ err: e.message }, 'clé d\'API : compteur non mis à jour'));
        req.apiKey = { id: r.id, organismeId: r.organisme_id, nom: r.nom, portees: r.portees };
        next();
      } catch (err) { next(err); }
    },
  };
  return svc;
}

module.exports = { createApiKeys, PORTEES, ipAutorisee };
