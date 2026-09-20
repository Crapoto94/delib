/**
 * SmsPort (ELU-85) : envoi d'un SMS à un mobile. Deux modes, choisis par organisme (`sms.mode`) :
 *  - « simulation » (défaut) : rien n'est envoyé, le message est journalisé (texte lisible : c'est ce qui permet d'essayer) ;
 *  - « http » : passerelle générique — POST JSON vers `sms.url` avec un jeton (chiffré au repos), corps issu d'un modèle
 *    (`sms.modele`, défaut {"recipient":"{to}","message":"{message}"} : passerelle SMS de la Ville, POST /api/v1/messages avec clé API en Bearer).
 * Le port ne connaît ni les élus ni les codes : il reçoit un numéro et un texte.
 */
const crypto = require('crypto');
const { createHttpClient } = require('./http-client');
const { createSecretBox } = require('../shared/secretbox');
const { E } = require('../shared/errors');

/** Numéro mobile → format international (+33…) ; null si invalide. Accepte 06 12 34 56 78, +33 6…, 0033 6…, et un international générique. */
function normaliserMobile(brut) {
  const t = String(brut || '').replace(/[\s.\-()]/g, '');
  if (/^0[67]\d{8}$/.test(t)) return `+33${t.slice(1)}`;
  if (/^(\+|00)33[67]\d{8}$/.test(t)) return `+33${t.replace(/^(\+|00)33/, '')}`;
  if (/^\+[1-9]\d{7,14}$/.test(t)) return t;
  return null;
}
const masquer = (n) => (n ? `${n.slice(0, 3)} •• •• •• ${n.slice(-2)}` : '');

function createSms({ db, config, settings, log, tls, http: injected }) {
  const box = createSecretBox(config?.jwt?.secret || 'dev', 'sms');
  const val = (c, k, d) => (c[k]?.value === undefined || c[k]?.value === null || c[k]?.value === '' ? d : c[k].value);

  const svc = {
    normaliserMobile, masquer,

    /** Chiffre le jeton de la passerelle avant de le ranger dans les paramètres. */
    chiffrerJeton: (t) => box.chiffre(t),

    async config(organismeId) {
      const c = await settings.resolve(organismeId);
      return { mode: val(c, 'sms.mode', 'simulation'), url: String(val(c, 'sms.url', '')), expediteur: String(val(c, 'sms.expediteur', 'VibeDelib')), modele: String(val(c, 'sms.modele', '')), jetonDefini: !!val(c, 'sms.jeton', '') };
    },

    /** Envoie (ou simule) un SMS. Ne renvoie jamais le jeton ; lève une erreur 502 si la passerelle échoue. */
    async envoyer({ organismeId, mobile, message }) {
      const n = normaliserMobile(mobile);
      if (!n) throw E.badRequest('Numéro de mobile invalide');
      const c = await settings.resolve(organismeId);
      const mode = val(c, 'sms.mode', 'simulation');
      if (mode !== 'http') {
        await db.run("INSERT INTO sms_journal (organisme_id, mobile_masque, mobile, message, mode, statut) VALUES ($1,$2,$3,$4,'simulation','simule')", [organismeId, masquer(n), n, message]);
        log?.info?.({ mobile: masquer(n) }, 'SMS simulé (aucun envoi réel)');
        return { simule: true };
      }
      const url = String(val(c, 'sms.url', ''));
      if (!/^https?:\/\/.+/i.test(url)) throw E.conflict('Passerelle SMS non configurée (URL manquante)');
      const jeton = box.dechiffre(val(c, 'sms.jeton', ''));
      const modele = String(val(c, 'sms.modele', '')) || '{"recipient":"{to}","message":"{message}"}';
      const esc = (s) => JSON.stringify(String(s)).slice(1, -1); // insertion sûre dans un modèle JSON
      let corps;
      try { corps = JSON.parse(modele.replace('{to}', esc(n)).replace('{message}', esc(message)).replace('{expediteur}', esc(val(c, 'sms.expediteur', 'VibeDelib')))); } catch { throw E.conflict('Modèle de corps SMS invalide (JSON attendu)'); }
      const http = injected || createHttpClient({ baseURL: undefined, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, tls, timeoutMs: 15000 });
      let statut = 'envoye'; let erreur = null;
      try {
        const r = await http.post(url, corps, injected ? { headers: { Authorization: `Bearer ${jeton}` } } : undefined);
        if (r.status >= 300) { statut = 'echec'; erreur = `HTTP ${r.status}`; }
      } catch (e) { statut = 'echec'; erreur = e.code || e.message; }
      // en réel, le texte du message (qui contient le code) n'est JAMAIS conservé
      await db.run("INSERT INTO sms_journal (organisme_id, mobile_masque, message, mode, statut, erreur) VALUES ($1,$2,'(masqué)','http',$3,$4)", [organismeId, masquer(n), statut, erreur]);
      if (statut === 'echec') throw E.upstream(`Passerelle SMS : ${erreur}`);
      return { simule: false };
    },

    /** Enregistre la configuration de la passerelle (le jeton est chiffré ; vide = conservé). */
    async enregistrer(ctx, organismeId, b) {
      const put = (key, v) => settings.put(ctx, { scope: 'organisme', organismeId, key, val: v });
      if (b.mode === 'http' && !/^https?:\/\/.+/i.test(String(b.url ?? (await settings.resolve(organismeId))['sms.url']?.value ?? ''))) throw E.badRequest('Adresse de la passerelle (http ou https) obligatoire en mode passerelle');
      if (b.mode !== undefined) await put('sms.mode', b.mode);
      if (b.url !== undefined) await put('sms.url', b.url);
      if (b.expediteur !== undefined) await put('sms.expediteur', b.expediteur);
      if (b.modele !== undefined) {
        if (b.modele) { try { JSON.parse(b.modele.replace('{to}', 'x').replace('{message}', 'x').replace('{expediteur}', 'x')); } catch { throw E.badRequest('Le modèle de corps doit être un JSON valide'); } }
        await put('sms.modele', b.modele);
      }
      if (b.jeton) await put('sms.jeton', box.chiffre(b.jeton));
      return svc.config(organismeId);
    },

    /** Derniers messages du journal (le texte n'est lisible qu'en simulation). */
    async journal(organismeId, limit = 30) {
      return (await db.all('SELECT id, mobile_masque, message, mode, statut, erreur, created_at FROM sms_journal WHERE organisme_id = $1 ORDER BY id DESC LIMIT $2', [organismeId, limit]))
        .map((r) => ({ id: Number(r.id), mobile: r.mobile_masque, message: r.message, mode: r.mode, statut: r.statut, erreur: r.erreur, le: r.created_at }));
    },
    uid: () => crypto.randomUUID(),
  };
  return svc;
}

module.exports = { createSms, normaliserMobile, masquer };
