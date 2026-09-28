/**
 * Lien de calendrier dynamique pour les ÉLUS (Outlook, Google, Apple…) : même principe que `seances/calendrier.service.js`
 * (agents), mais le flux ne reprend que les séances visibles de CET élu (conseil + les commissions dont il est membre),
 * via `espace.seanceIds()` — jamais les jalons internes (rédaction, DGS…), qui ne concernent pas les élus.
 */
const crypto = require('crypto');
const { E } = require('../../shared/errors');
const { createSecretBox } = require('../../shared/secretbox');
const ics = require('../../shared/ics');

const sha = (x) => crypto.createHash('sha256').update(String(x)).digest('hex');
const TYPES = { ordinaire: '', extraordinaire: ' (séance extraordinaire)', budgetaire: ' (séance budgétaire)', autre: '' };

function createEluCalendrier({ db, audit, espace, config }) {
  const box = createSecretBox(config?.jwt?.secret || 'dev', 'calendrier-elus');
  const base = () => String(config?.publicBaseUrl || '').replace(/\/+$/, '');
  const vue = (row, token) => {
    if (!row) return { actif: false };
    const url = `${base()}/api/v1/calendrier-elus/${token}.ics`;
    return { actif: true, url, webcal: url.replace(/^https?:/i, 'webcal:'), creeLe: row.cree_le, dernierAcces: row.dernier_acces, nbAcces: row.nb_acces };
  };

  const svc = {
    /** Mon lien (réaffichable). */
    async lien(elu) {
      const row = await db.get('SELECT * FROM elu_calendrier_liens WHERE organisme_id = $1 AND elu_id = $2', [elu.organismeId, elu.id]);
      return vue(row, row ? box.dechiffre(row.token_chiffre) : null);
    },

    /** Crée le lien, ou en génère un nouveau : l'ancien cesse aussitôt de fonctionner. */
    async regenerer(elu) {
      const token = crypto.randomBytes(24).toString('base64url');
      const row = await db.get(`INSERT INTO elu_calendrier_liens (organisme_id, elu_id, token_hash, token_chiffre) VALUES ($1,$2,$3,$4)
        ON CONFLICT (organisme_id, elu_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, token_chiffre = EXCLUDED.token_chiffre, cree_le = now(), dernier_acces = NULL, nb_acces = 0 RETURNING *`,
      [elu.organismeId, elu.id, sha(token), box.chiffre(token)]);
      await audit.log({ username: `elu:${elu.id}`, kind: 'elu' }, { organismeId: elu.organismeId, action: 'calendrier.lien', entity: 'elu_calendrier_liens', entityId: row.id }); // jamais la clé
      return vue(row, token);
    },

    async revoquer(elu) {
      const r = await db.get('DELETE FROM elu_calendrier_liens WHERE organisme_id = $1 AND elu_id = $2 RETURNING id', [elu.organismeId, elu.id]);
      if (r) await audit.log({ username: `elu:${elu.id}`, kind: 'elu' }, { organismeId: elu.organismeId, action: 'calendrier.revocation', entity: 'elu_calendrier_liens', entityId: r.id });
      return { actif: false };
    },

    /** Le flux ICS du lien (public : la clé EST l'authentification). 404 pour une clé inconnue, révoquée, ou un élu désactivé. */
    async flux(fichier) {
      const token = String(fichier || '').replace(/\.ics$/i, '');
      const lien = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? await db.get('SELECT * FROM elu_calendrier_liens WHERE token_hash = $1', [sha(token)]) : null;
      if (!lien) throw E.notFound('Calendrier introuvable');
      await db.run('UPDATE elu_calendrier_liens SET dernier_acces = now(), nb_acces = nb_acces + 1 WHERE id = $1', [lien.id]);
      const e = await db.get('SELECT id, organisme_id FROM elus WHERE id = $1 AND organisme_id = $2 AND actif AND est_elu', [lien.elu_id, lien.organisme_id]);
      if (!e) throw E.notFound('Calendrier introuvable');
      const elu = { id: e.id, organismeId: e.organisme_id };
      const orgRow = await db.get('SELECT nom FROM organismes WHERE id = $1', [elu.organismeId]);
      const ids = await espace.seanceIds(elu);
      const rows = ids.length ? await db.all(`SELECT s.*, i.nom AS instance_nom FROM seances s JOIN instances i ON i.id = s.instance_id WHERE s.id = ANY($1::int[]) ORDER BY s.date_seance`, [ids]) : [];
      const evenements = rows.map((s) => {
        const annulee = s.statut === 'annulee'; const modifie = s.updated_at || s.created_at || new Date(); const seq = Math.floor(new Date(modifie).getTime() / 1000);
        const titre = `${s.instance_nom}${TYPES[s.type] ?? ''}`; const lienApp = `${base()}/elus/#/seances/${s.id}`;
        const desc = [`${annulee ? 'SÉANCE ANNULÉE — ' : ''}${orgRow?.nom || ''}`, s.teams_join_url ? `Visioconférence Teams : ${s.teams_join_url}` : null].filter(Boolean).join('\n');
        return ics.evenement({ uid: `seance-${s.id}@vibedelib`, debut: s.date_seance, fin: new Date(new Date(s.date_seance).getTime() + (s.duree_minutes || 120) * 60000), resume: `${annulee ? 'ANNULÉE — ' : ''}${titre}`,
          lieu: s.lieu, description: desc, url: lienApp, statut: annulee ? 'CANCELLED' : 'CONFIRMED', sequence: seq, modifie, categories: ['Séance'] });
      });
      const corps = ics.calendrier({ nom: `Mes séances — ${orgRow?.nom || 'VibeDélib'}`, description: 'Séances et réunions auxquelles vous siégez (VibeDélib)', evenements });
      return { corps, etag: `"${sha(corps).slice(0, 32)}"` };
    },
  };
  return svc;
}

module.exports = { createEluCalendrier };
