/**
 * Lien de calendrier dynamique (SEA-17, D108) : un flux d'abonnement (Outlook, Google, Apple…), PAS un export. Chaque personne a son lien secret ;
 * l'agenda l'interroge régulièrement, si bien que déplacements, changements de lieu et annulations s'y retrouvent seuls. Aucune donnée de dossier n'y figure.
 */
const crypto = require('crypto');
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const { createSecretBox } = require('../../shared/secretbox');
const ics = require('../../shared/ics');

const sha = (x) => crypto.createHash('sha256').update(String(x)).digest('hex');
const TYPES = { ordinaire: '', extraordinaire: ' (séance extraordinaire)', budgetaire: ' (séance budgétaire)', autre: '' };
const JALONS = [['date_limite_redaction', 'redaction', 'Clôture des dépôts (rédaction)'], ['date_limite_dgs', 'dgs', 'Validation DGS'], ['date_limite_mad_commissions', 'commissions', 'Mise à disposition des commissions'], ['date_envoi_convocation', 'convocation', 'Envoi de la convocation']];

function createCalendrier({ db, audit, access, config }) {
  const box = createSecretBox(config?.jwt?.secret || 'dev', 'calendrier');
  const base = () => String(config?.publicBaseUrl || '').replace(/\/+$/, '');
  const vue = (row, token) => {
    if (!row) return { actif: false };
    const url = `${base()}/api/v1/calendrier/${token}.ics`;
    return { actif: true, url, webcal: url.replace(/^https?:/i, 'webcal:'), creeLe: row.cree_le, dernierAcces: row.dernier_acces, nbAcces: row.nb_acces };
  };

  const svc = {
    sha,

    /** Mon lien (réaffichable). */
    async lien(ctx, organismeId) {
      const org = requireOrg(organismeId);
      const row = await db.get('SELECT * FROM calendrier_liens WHERE organisme_id = $1 AND username = $2', [org, ctx.username]);
      return vue(row, row ? box.dechiffre(row.token_chiffre) : null);
    },

    /** Crée le lien, ou en génère un nouveau : l'ancien cesse aussitôt de fonctionner. */
    async regenerer(ctx, organismeId) {
      const org = requireOrg(organismeId); const token = crypto.randomBytes(24).toString('base64url');
      const row = await db.get(`INSERT INTO calendrier_liens (organisme_id, username, token_hash, token_chiffre) VALUES ($1,$2,$3,$4)
        ON CONFLICT (organisme_id, username) DO UPDATE SET token_hash = EXCLUDED.token_hash, token_chiffre = EXCLUDED.token_chiffre, cree_le = now(), dernier_acces = NULL, nb_acces = 0 RETURNING *`,
      [org, ctx.username, sha(token), box.chiffre(token)]);
      await audit.log(ctx, { organismeId: org, action: 'calendrier.lien', entity: 'calendrier_liens', entityId: row.id }); // jamais la clé
      return vue(row, token);
    },

    async revoquer(ctx, organismeId) {
      const org = requireOrg(organismeId);
      const r = await db.get('DELETE FROM calendrier_liens WHERE organisme_id = $1 AND username = $2 RETURNING id', [org, ctx.username]);
      if (r) await audit.log(ctx, { organismeId: org, action: 'calendrier.revocation', entity: 'calendrier_liens', entityId: r.id });
      return { actif: false };
    },

    /** Le flux ICS du lien (public : la clé EST l'authentification). 404 pour une clé inconnue ou révoquée, sans distinction. */
    async flux(fichier) {
      const token = String(fichier || '').replace(/\.ics$/i, '');
      const lien = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? await db.get('SELECT * FROM calendrier_liens WHERE token_hash = $1', [sha(token)]) : null;
      if (!lien) throw E.notFound('Calendrier introuvable');
      await db.run('UPDATE calendrier_liens SET dernier_acces = now(), nb_acces = nb_acces + 1 WHERE id = $1', [lien.id]);
      const ctx = await access.loadContext(lien.username).catch(() => null);
      if (!ctx) throw E.notFound('Calendrier introuvable');
      const org = lien.organisme_id;
      const staff = ctx.isPlatformAdmin || access.rolesIn(ctx, org).some((r) => ['org_admin', 'scc'].includes(r));
      const orgRow = await db.get('SELECT nom FROM organismes WHERE id = $1', [org]);
      const rows = await db.all(`SELECT s.*, i.nom AS instance_nom FROM seances s JOIN instances i ON i.id = s.instance_id
        WHERE s.organisme_id = $1 AND s.date_seance >= now() - interval '90 days' AND s.date_seance <= now() + interval '24 months' ORDER BY s.date_seance`, [org]);
      const evenements = [];
      for (const s of rows) {
        const annulee = s.statut === 'annulee'; const modifie = s.updated_at || s.created_at || new Date(); const seq = Math.floor(new Date(modifie).getTime() / 1000);
        const titre = `${s.instance_nom}${TYPES[s.type] ?? ''}`; const lienApp = `${base()}/seances/${s.id}`;
        const desc = [`${annulee ? 'SÉANCE ANNULÉE — ' : ''}${orgRow?.nom || ''}`, `Ordre du jour : ${lienApp}`, s.teams_join_url ? `Visioconférence Teams : ${s.teams_join_url}` : null].filter(Boolean).join('\n');
        evenements.push(ics.evenement({ uid: `seance-${s.id}@vibedelib`, debut: s.date_seance, fin: new Date(new Date(s.date_seance).getTime() + (s.duree_minutes || 120) * 60000), resume: `${annulee ? 'ANNULÉE — ' : ''}${titre}`,
          lieu: s.lieu, description: desc, url: lienApp, statut: annulee ? 'CANCELLED' : 'CONFIRMED', sequence: seq, modifie, categories: ['Séance'] }));
        if (staff) for (const [col, code, label] of JALONS) {
          if (!s[col]) continue;
          evenements.push(ics.evenement({ uid: `jalon-${code}-${s.id}@vibedelib`, debut: s[col], journee: true, resume: `${label} — ${titre} du ${new Date(s.date_seance).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })}`,
            description: `Jalon de la séance : ${lienApp}`, url: lienApp, statut: annulee ? 'CANCELLED' : 'CONFIRMED', sequence: seq, modifie, categories: ['Jalon'] }));
        }
      }
      const corps = ics.calendrier({ nom: `Séances — ${orgRow?.nom || 'VibeDélib'}`, description: staff ? 'Séances, réunions et jalons (VibeDélib)' : 'Séances et réunions (VibeDélib)', evenements });
      return { corps, etag: `"${sha(corps).slice(0, 32)}"` };
    },
  };
  return svc;
}

module.exports = { createCalendrier };
