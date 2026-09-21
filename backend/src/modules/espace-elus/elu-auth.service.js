/**
 * Authentification de l'espace élus (ELU-10 à ELU-12, D85). Totalement séparée de celle des agents :
 *  - jeton signé avec un secret DÉRIVÉ et une audience « elus » : un jeton d'élu est rejeté par l'API des agents, et inversement ;
 *  - sessions dans `elu_sessions` (révocables, courtes) ; comptes dans `elu_comptes` ;
 *  - invitation par le SCC (lien à usage unique, jamais conservé en clair), mot de passe robuste, code à usage unique par mail,
 *    verrouillage après 5 échecs, appareils de confiance.
 * Rien ici ne donne accès à autre chose qu'à l'espace élus : `req.elu` ne porte aucun rôle d'agent.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const sha = (x) => crypto.createHash('sha256').update(String(x)).digest('hex');
const same = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const cap = (x) => String(x || '').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const MAX_ECHECS = 5;
const VERROU_MIN = 15;
const SMS_VALIDITE_MIN = 5;   // ELU-83 : le code SMS est valable 5 minutes
const SMS_ESSAIS = 3;
const SMS_SESSION_HEURES = 12; // ELU-83 : jeton de 12 heures exactement
const SMS_LIMITE = 5;          // demandes par quart d'heure, par adresse ou par IP

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) { crypto.scryptSync(String(pw), 'x'.repeat(32), 64); return false; } // temps constant même sans mot de passe
  return same(crypto.scryptSync(String(pw), salt, 64).toString('hex'), hash);
}
/** Mot de passe robuste : 12 caractères au moins, avec des lettres et des chiffres (ou symboles). */
function policy(pw) {
  if (String(pw).length < 12) return 'Le mot de passe doit comporter au moins 12 caractères';
  if (!/\p{L}/u.test(pw) || !/[\d\W_]/.test(pw)) return 'Le mot de passe doit mêler des lettres et des chiffres ou des symboles';
  if (/^(.)\1+$/.test(pw)) return 'Mot de passe trop simple';
  return null;
}

function createEluAuth({ db, config, mail, settings, audit, log, sms }) {
  const secret = crypto.createHmac('sha256', config.jwt.secret).update('vibedelib:espace-elus').digest('hex');
  const footerOf = (cfg) => ({ line1: cfg['mail.footer1']?.value, line2: cfg['mail.footer2']?.value, line3: cfg['mail.footer3']?.value, color: cfg['mail.footerColor']?.value });
  const nomOf = (e) => `${cap(e.prenom)} ${String(e.nom || '').toUpperCase()}`.trim();

  async function send(org, email, subject, html) {
    const cfg = await settings.resolve(org);
    let to = email; let subj = subject; let body = html;
    if (config.mailRedirectTo) { to = config.mailRedirectTo; subj = `[RECETTE → ${email}] ${subject}`; body = `<p><em>Mode recette : ce message était destiné à ${email}.</em></p>${html}`; }
    await mail.send({ to, subject: subj, html: body, footer: footerOf(cfg) });
  }
  const baseUrl = async (org) => String((await settings.resolve(org))['elus.url_base']?.value || process.env.ELUS_URL || 'http://localhost:5160/elus.html').replace(/\/+$/, '');

  async function nouveauLien(org, eluId) {
    const token = crypto.randomBytes(32).toString('base64url');
    await db.run('UPDATE elu_comptes SET invitation_hash = $2, invitation_expire = now() + interval \'7 days\', invite_le = now() WHERE elu_id = $1', [eluId, sha(token)]);
    return `${await baseUrl(org)}#/invitation/${token}`;
  }

  const journalOubli = (o) => db.run('INSERT INTO elu_oublis (organisme_id, elu_id, email, evenement, ip, detail) VALUES ($1,$2,$3,$4,$5,$6)', [o.organismeId ?? null, o.eluId ?? null, o.email ? String(o.email).toLowerCase().slice(0, 200) : null, o.evenement, o.ip ?? null, o.detail ?? null]);

  const svc = {
    hashPassword, checkPassword, policy,

    // ---------------------------------------------------------------------------------------- côté SCC
    /** Comptes de l'organisme : chaque élu actif avec l'état de son accès (jamais de mot de passe ni de lien). */
    async comptes(organismeId) {
      const org = requireOrg(organismeId);
      const rows = await db.all(`SELECT e.id, e.nom, e.prenom, e.email, e.est_elu, g.nom AS groupe, c.actif, c.password_hash IS NOT NULL AS accepte, c.invite_le, c.accepte_le, c.derniere_connexion, c.verrouille_jusqu,
                                        (c.elu_id IS NOT NULL) AS a_un_compte
                                 FROM elus e LEFT JOIN groupes_politiques g ON g.id = e.groupe_id LEFT JOIN elu_comptes c ON c.elu_id = e.id
                                 WHERE e.organisme_id = $1 AND e.actif AND e.est_elu ORDER BY e.nom, e.prenom`, [org]);
      return { items: rows.map((r) => ({ eluId: r.id, nom: nomOf(r), email: r.email, groupe: r.groupe, aUnEmail: !!r.email, compte: r.a_un_compte ? (!r.actif ? 'desactive' : r.accepte ? 'actif' : 'invite') : 'aucun', inviteLe: r.invite_le, accepteLe: r.accepte_le, derniereConnexion: r.derniere_connexion, verrouille: !!r.verrouille_jusqu && new Date(r.verrouille_jusqu) > new Date() })) };
    },

    /** Invitation (ou renvoi) : le lien est envoyé par mail à l'élu, le SCC ne le voit jamais et n'a jamais accès au mot de passe. */
    async inviter(ctx, organismeId, eluId) {
      const org = requireOrg(organismeId);
      const e = await db.get('SELECT * FROM elus WHERE id = $1 AND organisme_id = $2 AND actif', [eluId, org]);
      if (!e) throw E.notFound('Élu introuvable');
      if (!e.email) throw E.conflict("Cet élu n'a pas d'adresse e-mail : renseignez-la d'abord");
      await db.run(`INSERT INTO elu_comptes (elu_id, organisme_id, email, invite_par) VALUES ($1,$2,$3,$4)
                    ON CONFLICT (elu_id) DO UPDATE SET email = EXCLUDED.email, invite_par = EXCLUDED.invite_par, actif = true`, [eluId, org, e.email.toLowerCase(), ctx.username]);
      const lien = await nouveauLien(org, eluId);
      const orgRow = await db.get('SELECT nom FROM organismes WHERE id = $1', [org]);
      await send(org, e.email, `Votre accès à l’espace des élus — ${orgRow?.nom || ''}`,
        `<p>Bonjour ${cap(e.prenom)},</p><p>Un accès personnel à l’espace des élus de <b>${orgRow?.nom || ''}</b> a été créé pour vous. Il vous permet de consulter les documents des séances, y compris depuis l’application mobile.</p>`
        + `<p><a href="${lien}">Activer mon accès et choisir mon mot de passe</a> (lien valable 7 jours, à usage unique).</p><p>Ce lien vous est personnel : ne le transmettez pas.</p>`);
      await audit.log(ctx, { organismeId: org, action: 'elu.invitation', entity: 'elus', entityId: eluId });
      return { eluId, invite: true };
    },
    async desactiver(ctx, organismeId, eluId, actif) {
      const org = requireOrg(organismeId);
      const r = await db.get('UPDATE elu_comptes SET actif = $3 WHERE elu_id = $1 AND organisme_id = $2 RETURNING elu_id', [eluId, org, actif]);
      if (!r) throw E.notFound("Cet élu n'a pas de compte");
      if (!actif) await db.run('UPDATE elu_sessions SET revoquee_le = now() WHERE elu_id = $1 AND revoquee_le IS NULL', [eluId]);
      await audit.log(ctx, { organismeId: org, action: actif ? 'elu.reactivation' : 'elu.desactivation', entity: 'elus', entityId: eluId });
      return { eluId, actif };
    },

    // ---------------------------------------------------------------------------------------- côté élu (publiques)
    async accepterInvitation(token, motDePasse) {
      const c = await db.get('SELECT * FROM elu_comptes WHERE invitation_hash = $1', [sha(token)]);
      if (!c || !c.invitation_expire || new Date(c.invitation_expire) < new Date()) throw E.badRequest('Lien d’invitation invalide ou expiré : demandez-en un nouveau au secrétariat');
      const pb = policy(motDePasse); if (pb) throw E.badRequest(pb);
      await db.run('UPDATE elu_comptes SET password_hash = $2, invitation_hash = NULL, invitation_expire = NULL, accepte_le = now(), echecs = 0, verrouille_jusqu = NULL WHERE elu_id = $1', [c.elu_id, hashPassword(motDePasse)]);
      return { ok: true };
    },
    /** « Mot de passe oublié » : renvoie un lien ; la réponse est toujours la même (pas d'énumération des comptes). */
    async oubli(email, organismeId) {
      const rows = await db.all(`SELECT c.*, e.prenom FROM elu_comptes c JOIN elus e ON e.id = c.elu_id WHERE lower(c.email) = lower($1) AND c.actif ${organismeId ? 'AND c.organisme_id = $2' : ''}`, organismeId ? [email, organismeId] : [email]);
      for (const c of rows) {
        const lien = await nouveauLien(c.organisme_id, c.elu_id);
        await send(c.organisme_id, c.email, 'Réinitialisation de votre mot de passe', `<p>Bonjour ${cap(c.prenom)},</p><p><a href="${lien}">Choisir un nouveau mot de passe</a> (lien valable 7 jours, à usage unique). Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.</p>`);
      }
      return { ok: true };
    },

    /**
     * « Mot de passe oublié » par SMS (ELU-83) : envoie un code à 6 chiffres sur le mobile de l'élu (5 minutes). La réponse est TOUJOURS la même
     * (un identifiant de défi et une durée) que le compte existe ou non : aucune énumération. Chaque cas est journalisé (ELU-84).
     */
    async oubliSms({ email, organismeId, ip }) {
      const mail_ = String(email || '').trim().toLowerCase();
      const defi = crypto.randomUUID(); const reponse = { challenge: defi, expireDans: SMS_VALIDITE_MIN * 60 };
      const org = organismeId ?? null;
      // limite : 5 demandes par quart d'heure et par adresse, et par IP
      const recentes = (await db.get("SELECT count(*)::int AS n FROM elu_oublis WHERE evenement = 'demande' AND at > now() - interval '15 minutes' AND (lower(email) = $1 OR ($2::text IS NOT NULL AND ip = $2))", [mail_, ip ?? null])).n;
      await journalOubli({ organismeId: org, email: mail_, evenement: 'demande', ip });
      if (recentes >= SMS_LIMITE) { await journalOubli({ organismeId: org, email: mail_, evenement: 'limite', ip, detail: `${recentes} demandes en 15 minutes` }); return reponse; }
      const rows = await db.all(`SELECT c.elu_id, c.organisme_id, c.email, e.nom, e.prenom, COALESCE(e.mobile_local, e.telephone) AS mobile FROM elu_comptes c JOIN elus e ON e.id = c.elu_id
                                 WHERE lower(c.email) = $1 AND c.actif AND e.actif ${org ? 'AND c.organisme_id = $2' : ''}`, org ? [mail_, org] : [mail_]);
      if (rows.length !== 1) { await journalOubli({ organismeId: org, email: mail_, evenement: 'compte_inconnu', ip, detail: rows.length > 1 ? 'plusieurs collectivités' : null }); return reponse; }
      const c = rows[0];
      const mobile = sms.normaliserMobile(c.mobile);
      if (!mobile) { await journalOubli({ organismeId: c.organisme_id, eluId: c.elu_id, email: mail_, evenement: 'sans_mobile', ip }); return reponse; }
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      await db.run("UPDATE elu_codes SET utilise_le = now() WHERE elu_id = $1 AND canal = 'sms' AND utilise_le IS NULL", [c.elu_id]); // un seul code valable à la fois
      await db.run("INSERT INTO elu_codes (id, elu_id, code_hash, expire_le, canal) VALUES ($1,$2,$3, now() + ($4 || ' minutes')::interval, 'sms')", [defi, c.elu_id, sha(`${defi}:${code}`), String(SMS_VALIDITE_MIN)]);
      try {
        await sms.envoyer({ organismeId: c.organisme_id, mobile, message: `VibeDélib : votre code de connexion est ${code}. Valable ${SMS_VALIDITE_MIN} minutes. Ne le communiquez à personne.` });
        await journalOubli({ organismeId: c.organisme_id, eluId: c.elu_id, email: mail_, evenement: 'code_envoye', ip, detail: sms.masquer(mobile) });
      } catch (e) {
        await db.run('UPDATE elu_codes SET utilise_le = now() WHERE id = $1', [defi]);
        await journalOubli({ organismeId: c.organisme_id, eluId: c.elu_id, email: mail_, evenement: 'echec_envoi', ip, detail: String(e.message).slice(0, 200) });
      }
      return reponse;
    },

    /** Vérifie le code SMS (3 essais, 5 minutes) : connecte l'élu avec un jeton de 12 heures, sans appareil de confiance. */
    async oubliSmsCode({ challenge, code, ip, appareil }) {
      const d = await db.get("SELECT k.*, e.organisme_id, e.email FROM elu_codes k JOIN elus e ON e.id = k.elu_id WHERE k.id = $1 AND k.canal = 'sms'", [challenge]);
      const inconnu = () => E.unauthorized('Code invalide ou expiré : demandez-en un nouveau');
      if (!d || d.utilise_le) throw inconnu();
      if (new Date(d.expire_le) < new Date()) { await db.run('UPDATE elu_codes SET utilise_le = now() WHERE id = $1', [challenge]); await journalOubli({ organismeId: d.organisme_id, eluId: d.elu_id, evenement: 'code_expire', email: d.email, ip }); throw inconnu(); }
      if (d.essais >= SMS_ESSAIS) throw inconnu();
      if (!same(sha(`${challenge}:${String(code).trim()}`), d.code_hash)) {
        const n = d.essais + 1;
        await db.run('UPDATE elu_codes SET essais = $2::int, utilise_le = CASE WHEN $2::int >= $3::int THEN now() ELSE utilise_le END WHERE id = $1', [challenge, n, SMS_ESSAIS]);
        await journalOubli({ organismeId: d.organisme_id, eluId: d.elu_id, evenement: 'code_refuse', email: d.email, ip, detail: `essai ${n}/${SMS_ESSAIS}` });
        throw E.unauthorized(n >= SMS_ESSAIS ? 'Code incorrect : trop d’essais, demandez un nouveau code' : 'Code incorrect');
      }
      await db.run('UPDATE elu_codes SET utilise_le = now() WHERE id = $1', [challenge]);
      const c = await db.get('SELECT c.*, e.nom, e.prenom FROM elu_comptes c JOIN elus e ON e.id = c.elu_id WHERE c.elu_id = $1 AND c.actif AND e.actif', [d.elu_id]);
      if (!c) throw inconnu();
      await db.run('UPDATE elu_comptes SET echecs = 0, verrouille_jusqu = NULL WHERE elu_id = $1', [c.elu_id]); // le code prouve la possession du mobile : le verrou du mot de passe tombe
      await journalOubli({ organismeId: c.organisme_id, eluId: c.elu_id, email: c.email, evenement: 'code_valide', ip });
      const session = await svc._session(c, { ip, appareil, heures: SMS_SESSION_HEURES, via: 'sms' });
      send(c.organisme_id, c.email, 'Connexion à votre espace des élus par code SMS', `<p>Bonjour ${cap(c.prenom)},</p><p>Vous venez de vous connecter à l’espace des élus avec un <b>code reçu par SMS</b> (mot de passe oublié). Cette session dure 12 heures.</p><p>Si ce n’était pas vous, prévenez le secrétariat sans attendre.</p>`).catch(() => undefined);
      return session;
    },

    /** Journal des oublis de mot de passe (ELU-84) pour l'administration, avec compteurs des dernières 24 h. */
    async oublis(organismeId, { evenement, limit = 100 } = {}) {
      const org = requireOrg(organismeId);
      const p = [org]; let w = '';
      if (evenement) { p.push(evenement); w = 'AND o.evenement = $2'; }
      p.push(limit);
      const rows = await db.all(`SELECT o.id, o.evenement, o.email, o.ip, o.detail, o.at, o.elu_id, e.nom, e.prenom FROM elu_oublis o LEFT JOIN elus e ON e.id = o.elu_id
                                 WHERE (o.organisme_id = $1 OR (o.organisme_id IS NULL AND lower(o.email) IN (SELECT lower(email) FROM elu_comptes WHERE organisme_id = $1))) ${w} ORDER BY o.id DESC LIMIT $${p.length}`, p);
      const cpt = await db.all("SELECT evenement, count(*)::int AS n FROM elu_oublis WHERE (organisme_id = $1 OR organisme_id IS NULL) AND at > now() - interval '24 hours' GROUP BY evenement", [org]);
      return { items: rows.map((r) => ({ id: Number(r.id), evenement: r.evenement, email: r.email, eluId: r.elu_id, elu: r.elu_id ? nomOf(r) : null, ip: r.ip, detail: r.detail, le: r.at })), dernieres24h: Object.fromEntries(cpt.map((c) => [c.evenement, c.n])) };
    },

    /** Étape 1 : mot de passe. Renvoie une session (appareil de confiance) ou un défi dont le code part par mail. */
    async connexion({ email, motDePasse, appareil, organismeId, ip }) {
      // Connexion de DÉVELOPPEMENT, comme pour les agents : le mot de passe commun DEV_LOGIN_PASSWORD identifie n'importe quel élu actif par son adresse,
      // sans invitation préalable ni code par mail. Refusée en production ; chaque usage est journalisé et audité.
      if (config.devLoginPassword && config.env !== 'production' && same(String(motDePasse), String(config.devLoginPassword))) {
        const es = await db.all('SELECT e.id, e.organisme_id, e.nom, e.prenom, e.email FROM elus e WHERE lower(e.email) = lower($1) AND e.actif' + (organismeId ? ' AND e.organisme_id = $2' : ''), organismeId ? [email, organismeId] : [email]);
        if (es.length > 1) throw E.conflict('Plusieurs collectivités utilisent cette adresse : indiquez la collectivité', { organismes: es.map((r) => r.organisme_id) });
        if (es.length === 1) {
          const e = es[0];
          await db.run('INSERT INTO elu_comptes (elu_id, organisme_id, email, actif, accepte_le) VALUES ($1,$2,$3,true, now()) ON CONFLICT (elu_id) DO NOTHING', [e.id, e.organisme_id, String(e.email).toLowerCase()]);
          const c = await db.get('SELECT c.*, e.nom, e.prenom FROM elu_comptes c JOIN elus e ON e.id = c.elu_id WHERE c.elu_id = $1 AND c.actif', [e.id]);
          if (c) {
            log.warn({ elu: e.id }, 'connexion de développement à l’espace des élus (sans mot de passe personnel ni code)');
            await audit.log({ username: 'elu:' + e.id, ip }, { organismeId: e.organisme_id, action: 'elu.connexion_dev', entity: 'elus', entityId: e.id });
            return { session: await svc._session(c, { ip, appareil, via: 'dev' }) };
          }
        }
      }
      const rows = await db.all('SELECT c.*, e.nom, e.prenom FROM elu_comptes c JOIN elus e ON e.id = c.elu_id WHERE lower(c.email) = lower($1) AND c.actif AND e.actif' + (organismeId ? ' AND c.organisme_id = $2' : ''), organismeId ? [email, organismeId] : [email]);
      if (rows.length > 1) throw E.conflict('Plusieurs collectivités utilisent cette adresse : indiquez la collectivité', { organismes: rows.map((r) => r.organisme_id) });
      const c = rows[0];
      if (c?.verrouille_jusqu && new Date(c.verrouille_jusqu) > new Date()) throw E.locked(`Trop d’échecs : compte verrouillé jusqu’à ${new Date(c.verrouille_jusqu).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })}`);
      const ok = checkPassword(motDePasse, c?.password_hash);
      if (!c || !c.password_hash || !ok) {
        if (c) await db.run("UPDATE elu_comptes SET echecs = echecs + 1, verrouille_jusqu = CASE WHEN echecs + 1 >= $2 THEN now() + ($3 || ' minutes')::interval ELSE verrouille_jusqu END WHERE elu_id = $1", [c.elu_id, MAX_ECHECS, String(VERROU_MIN)]);
        throw E.unauthorized('Identifiants incorrects');
      }
      await db.run('UPDATE elu_comptes SET echecs = 0, verrouille_jusqu = NULL WHERE elu_id = $1', [c.elu_id]);
      if (appareil && await db.get('SELECT 1 AS x FROM elu_appareils WHERE elu_id = $1 AND appareil_hash = $2 AND confiance_jusqu > now()', [c.elu_id, sha(appareil)])) return { session: await svc._session(c, { ip, appareil }) };
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); const id = crypto.randomUUID();
      await db.run("INSERT INTO elu_codes (id, elu_id, code_hash, expire_le, appareil) VALUES ($1,$2,$3, now() + interval '10 minutes', $4)", [id, c.elu_id, sha(`${id}:${code}`), appareil ? sha(appareil) : null]);
      await send(c.organisme_id, c.email, 'Votre code de connexion', `<p>Bonjour ${cap(c.prenom)},</p><p>Votre code de connexion à l’espace des élus : <b style="font-size:20px;letter-spacing:3px">${code}</b></p><p>Il est valable 10 minutes. Ne le communiquez à personne.</p>`);
      return { challenge: id, expireDans: 600 };
    },

    /** Étape 2 : code à usage unique (5 essais). `faireConfiance` mémorise l'appareil (durée paramétrable). */
    async code({ challenge, code, faireConfiance, appareil, ip }) {
      const d = await db.get("SELECT * FROM elu_codes WHERE id = $1 AND canal = 'mail'", [challenge]);
      if (!d || d.utilise_le || new Date(d.expire_le) < new Date() || d.essais >= MAX_ECHECS) throw E.unauthorized('Code invalide ou expiré : reprenez la connexion');
      if (!same(sha(`${challenge}:${String(code).trim()}`), d.code_hash)) {
        await db.run('UPDATE elu_codes SET essais = essais + 1 WHERE id = $1', [challenge]);
        throw E.unauthorized('Code incorrect');
      }
      await db.run('UPDATE elu_codes SET utilise_le = now() WHERE id = $1', [challenge]);
      const c = await db.get('SELECT c.*, e.nom, e.prenom FROM elu_comptes c JOIN elus e ON e.id = c.elu_id WHERE c.elu_id = $1 AND c.actif AND e.actif', [d.elu_id]);
      if (!c) throw E.unauthorized('Compte désactivé');
      if (faireConfiance && appareil) {
        const jours = Number((await settings.resolve(c.organisme_id))['elus.appareil_jours']?.value ?? 30);
        await db.run("INSERT INTO elu_appareils (elu_id, appareil_hash, confiance_jusqu) VALUES ($1,$2, now() + ($3 || ' days')::interval) ON CONFLICT (elu_id, appareil_hash) DO UPDATE SET confiance_jusqu = EXCLUDED.confiance_jusqu", [c.elu_id, sha(appareil), String(jours)]);
      }
      return svc._session(c, { ip, appareil });
    },

    async _session(c, { ip, appareil, heures: imposees, via = 'mot_de_passe' }) {
      const heures = imposees ?? Number((await settings.resolve(c.organisme_id))['elus.session_heures']?.value ?? 12);
      const jti = crypto.randomUUID(); const expire = new Date(Date.now() + heures * 3600 * 1000);
      await db.run('INSERT INTO elu_sessions (jti, elu_id, expire_le, ip, appareil, via) VALUES ($1,$2,$3,$4,$5,$6)', [jti, c.elu_id, expire, ip ?? null, appareil ? sha(appareil).slice(0, 12) : null, via]);
      await db.run('UPDATE elu_comptes SET derniere_connexion = now() WHERE elu_id = $1', [c.elu_id]);
      const token = jwt.sign({ sub: String(c.elu_id), jti, aud: 'elus' }, secret, { algorithm: 'HS256', expiresIn: Math.floor((expire.getTime() - Date.now()) / 1000) });
      return { token, tokenType: 'Bearer', expiresAt: expire.toISOString(), elu: { id: c.elu_id, nom: nomOf(c), organismeId: c.organisme_id } };
    },

    async deconnexion(jti) { await db.run('UPDATE elu_sessions SET revoquee_le = now() WHERE jti = $1', [jti]); return { ok: true }; },

    /** Middleware : jeton d'élu valide, session non révoquée, compte actif. Ne charge AUCUN rôle d'agent. */
    authenticate: async (req, res, next) => {
      try {
        const h = req.headers.authorization || ''; const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
        if (!token) throw E.unauthorized();
        let claims;
        try { claims = jwt.verify(token, secret, { algorithms: ['HS256'], audience: 'elus' }); } catch { throw E.unauthorized('Jeton invalide ou expiré'); }
        const s = await db.get('SELECT * FROM elu_sessions WHERE jti = $1', [claims.jti]);
        if (!s || s.revoquee_le || new Date(s.expire_le) <= new Date() || String(s.elu_id) !== claims.sub) throw E.unauthorized('Session expirée ou révoquée');
        const e = await db.get(`SELECT e.id, e.nom, e.prenom, e.email, e.organisme_id, e.groupe_id, c.actif FROM elus e JOIN elu_comptes c ON c.elu_id = e.id WHERE e.id = $1`, [s.elu_id]);
        if (!e || !e.actif) throw E.unauthorized('Compte désactivé');
        req.elu = { id: e.id, organismeId: e.organisme_id, groupeId: e.groupe_id, nom: nomOf(e), jti: claims.jti, ip: req.ip };
        next();
      } catch (err) { next(err); }
    },
  };
  void log;
  return svc;
}

module.exports = { createEluAuth, policy };
