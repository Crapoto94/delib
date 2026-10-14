/**
 * Backlog : bugs signalés et évolutions demandées par les utilisateurs.
 * Chacun peut déposer une demande ; le SCC ou l'administrateur la traite (acceptée, refusée avec motif, réalisée)
 * et chaque changement d'état est notifié par courriel au demandeur.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ESC[c]);
const TYPE = { bug: 'Anomalie', evolution: 'Évolution' };
const STATUT = { demandee: 'Demandée', acceptee: 'Acceptée', refusee: 'Refusée', realisee: 'Réalisée' };
const PHRASE = {
  acceptee: 'a été <strong>acceptée</strong> : elle est inscrite au backlog de VibeDélib.',
  refusee: 'a été <strong>refusée</strong>.',
  realisee: 'a été <strong>réalisée</strong> : elle est disponible dans VibeDélib.',
  demandee: 'est de nouveau <strong>en attente d’examen</strong>.',
};

const toDemande = (r) => ({
  id: r.id, type: r.type, titre: r.titre, description: r.description, versionApp: r.version_app, statut: r.statut, motif: r.motif,
  demandeur: r.demandeur, demandeurNom: r.demandeur_nom, demandeurEmail: r.demandeur_email, traitePar: r.traite_par, traiteLe: r.traite_le, creeLe: r.created_at,
});

const MAX_PIECES = 5; const MAX_OCTETS = 10 * 1048576;
const TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', log: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
};
const MAGIC = { png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], jpeg: [0xff, 0xd8, 0xff], gif: [0x47, 0x49, 0x46], webp: [0x52, 0x49, 0x46, 0x46], pdf: [0x25, 0x50, 0x44, 0x46], docx: [0x50, 0x4b], xlsx: [0x50, 0x4b], pptx: [0x50, 0x4b], odt: [0x50, 0x4b], ods: [0x50, 0x4b] };
const toPiece = (p) => ({ id: p.id, nom: p.nom, mime: p.mime, taille: p.taille });

function createBacklog({ db, audit, mail, settings, config, log, storage }) {
  const footerOf = (cfg) => ({ line1: cfg['mail.footer1']?.value, line2: cfg['mail.footer2']?.value, line3: cfg['mail.footer3']?.value, color: cfg['mail.footerColor']?.value });

  /** Courriel au demandeur. Ne bloque jamais le changement d'état : renvoie 'envoye', 'sans_adresse' ou 'echec'. */
  async function notifier(org, d, par) {
    if (!d.demandeur_email) return 'sans_adresse';
    const p = (t) => `<p>${t}</p>`;
    const html = [
      p(`Bonjour ${esc(d.demandeur_nom || d.demandeur)},`),
      p(`Votre demande n° ${d.id} (${TYPE[d.type].toLowerCase()}) « ${esc(d.titre)} » ${PHRASE[d.statut]}`),
      d.motif ? p(`<strong>${d.statut === 'refusee' ? 'Motif' : 'Précision'} :</strong> ${esc(d.motif)}`) : '',
      p(`Traitée par ${esc(par)}.`),
    ].join('');
    const subject = `[VibeDélib] ${TYPE[d.type]} n° ${d.id} — ${STATUT[d.statut].toLowerCase()}`;
    let to = d.demandeur_email; let subj = subject; let body = html;
    if (config.mailRedirectTo) { to = config.mailRedirectTo; subj = `[RECETTE → ${d.demandeur_email}] ${subject}`; body = `<p><em>Mode recette : ce message était destiné à ${esc(d.demandeur_email)}.</em></p>${html}`; }
    try { await mail.send({ to, subject: subj, html: body, footer: footerOf(await settings.resolve(org)) }); return 'envoye'; }
    catch (e) { log?.warn?.({ e: e.message, id: d.id }, 'courriel de suivi du backlog non envoyé'); return 'echec'; }
  }

  return {
    async creer(ctx, organismeId, b, fichiers = []) {
      const org = requireOrg(organismeId);
      const titre = String(b.titre ?? '').replace(/\s+/g, ' ').trim(); const description = String(b.description ?? '').trim();
      if (titre.length < 3 || titre.length > 200) throw E.badRequest('Le titre doit faire de 3 à 200 caractères');
      if (description.length < 3 || description.length > 5000) throw E.badRequest('La description doit faire de 3 à 5000 caractères');
      if (fichiers.length > MAX_PIECES) throw E.badRequest(`Au plus ${MAX_PIECES} pièces jointes`);
      const pieces = fichiers.map((f) => {
        const nom = Array.from(String(f.originalname || 'piece')).map((c) => ('\\/:*?"<>|'.includes(c) || c.charCodeAt(0) < 32 ? '_' : c)).join('').trim().slice(0, 150) || 'piece';
        const ext = (nom.split('.').pop() || '').toLowerCase(); const mime = TYPES[ext];
        if (!mime) throw E.badRequest(`Pièce jointe non acceptée (.${ext}) : image, PDF, texte, Word, Excel, PowerPoint ou OpenDocument`);
        if (!f.buffer?.length || f.size > MAX_OCTETS) throw E.badRequest(`« ${nom} » est vide ou dépasse 10 Mo`);
        const m = MAGIC[ext]; if (m && !m.every((o, i) => f.buffer[i] === o)) throw E.badRequest(`Le contenu de « ${nom} » ne correspond pas à son extension`);
        return { f, nom, ext, mime };
      });
      const r = await db.get('INSERT INTO backlog_demandes (organisme_id, type, titre, description, version_app, demandeur, demandeur_nom, demandeur_email) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [org, b.type, titre, description, b.versionApp ? String(b.versionApp).slice(0, 20) : null, ctx.username, ctx.displayName || null, ctx.email || null]);
      const enregistrees = [];
      for (const { f, nom, ext, mime } of pieces) {
        const put = await storage.put(f.buffer, { organismeId: org, ext, categorie: 'backlog', nom, description: `Pièce jointe de la demande n° ${r.id} du backlog`, auteur: ctx.username });
        enregistrees.push(toPiece(await db.get('INSERT INTO backlog_pieces (demande_id, nom, mime, taille, storage_key, sha256) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [r.id, nom, mime, put.size, put.key, put.sha256])));
      }
      await audit.log(ctx, { organismeId: org, action: 'backlog.demande', entity: 'backlog_demandes', entityId: r.id, after: { type: r.type, titre, pieces: enregistrees.length } });
      return { ...toDemande(r), pieces: enregistrees };
    },

    /** Demandes de l'organisme (administration) ; `username` limite aux demandes d'une personne. */
    async lister(organismeId, { statut, username } = {}) {
      const org = requireOrg(organismeId); const args = [org]; let where = 'organisme_id = $1';
      if (statut) { args.push(statut); where += ` AND statut = $${args.length}`; }
      if (username) { args.push(username); where += ` AND demandeur = $${args.length}`; }
      const rows = await db.all(`SELECT * FROM backlog_demandes WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT 500`, args);
      const pieces = rows.length ? await db.all('SELECT * FROM backlog_pieces WHERE demande_id = ANY($1::int[]) ORDER BY id', [rows.map((x) => x.id)]) : [];
      return { items: rows.map((x) => ({ ...toDemande(x), pieces: pieces.filter((p) => p.demande_id === x.id).map(toPiece) })) };
    },

    /** Contenu d'une pièce jointe : le demandeur ou le SCC / l'administrateur. */
    async piece(ctx, roles, organismeId, id, pieceId) {
      const org = requireOrg(organismeId);
      const p = await db.get('SELECT p.*, d.demandeur FROM backlog_pieces p JOIN backlog_demandes d ON d.id = p.demande_id WHERE p.id = $2 AND d.id = $1 AND d.organisme_id = $3', [id, pieceId, org]);
      if (!p) throw E.notFound('Pièce jointe introuvable');
      if (p.demandeur !== ctx.username && !roles.some((x) => ['org_admin', 'scc'].includes(x)) && !ctx.isPlatformAdmin) throw E.forbidden('Accès refusé');
      return { buffer: await storage.get(p.storage_key), name: p.nom, mime: p.mime, sha256: p.sha256 };
    },

    async changerEtat(ctx, organismeId, id, { statut, motif }) {
      const org = requireOrg(organismeId);
      const cur = await db.get('SELECT * FROM backlog_demandes WHERE id = $1 AND organisme_id = $2', [id, org]);
      if (!cur) throw E.notFound('Demande introuvable');
      if (cur.statut === statut) throw E.badRequest(`La demande est déjà « ${STATUT[statut].toLowerCase()} »`);
      if (statut === 'realisee' && cur.statut === 'refusee') throw E.badRequest('Une demande refusée ne peut pas être déclarée réalisée : acceptez-la d’abord');
      const m = String(motif ?? '').trim();
      if (statut === 'refusee' && m.length < 3) throw E.badRequest('Un refus doit être motivé');
      const r = await db.get('UPDATE backlog_demandes SET statut = $3, motif = $4, traite_par = $5, traite_le = now() WHERE id = $1 AND organisme_id = $2 RETURNING *', [id, org, statut, m || null, ctx.username]);
      await audit.log(ctx, { organismeId: org, action: `backlog.${statut}`, entity: 'backlog_demandes', entityId: id, before: { statut: cur.statut }, after: { statut, motif: m || null } });
      return { ...toDemande(r), courriel: await notifier(org, r, ctx.displayName || ctx.username) };
    },
  };
}

module.exports = { createBacklog };
