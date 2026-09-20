/**
 * Convocations (CONV-01 à CONV-09) : la convocation d'une séance et son ordre du jour sont adressés à des CONVOQUÉS — élus de
 * l'instance ET agents de la Ville (invités : DGS, directeurs, rapporteurs, secrétaires de commission…).
 *
 * Chaque convoqué reçoit un LIEN PERSONNEL (jeton unique, /c/<jeton>) : on sait ainsi qui a ouvert le lien, qui a consulté la
 * convocation, qui a consulté l'ordre du jour, qui a accusé réception et qui a répondu. Tout est journalisé (preuve d'envoi et de
 * consultation) ; l'adresse IP n'est conservée que sous forme d'empreinte.
 *
 * Modificatif (CONV-07) : un nouvel envoi après une première convocation est une nouvelle VERSION, avec les différences d'ordre du
 * jour ; chaque convoqué reçoit alors un nouveau lien, l'ancien indique qu'une version plus récente existe.
 * L'envoi des e-mails se fait en arrière plan : la requête répond dès que les documents et les liens sont créés.
 */
const crypto = require('crypto');
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const { parisParts } = require('../../shared/time');

const TYPES = ['envoi', 'echec', 'relance', 'ouverture', 'convocation_lue', 'odj_lu', 'accuse', 'reponse'];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dayNumber = (d) => { const p = parisParts(new Date(d)); return Date.UTC(p.y, p.m - 1, p.d) / 86400000; };
const token = () => crypto.randomBytes(24).toString('base64url');
const cap = (s) => String(s || '').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

function createConvocations({ db, audit, render, odj, seances, storage, mail, settings, config, log, dir }) {
  const seanceRow = async (org, id) => {
    const s = await db.get('SELECT s.*, i.nom AS instance_nom, i.kind AS instance_kind, i.commission_id FROM seances s JOIN instances i ON i.id = s.instance_id WHERE s.id = $1 AND s.organisme_id = $2', [id, requireOrg(org)]);
    if (!s) throw E.notFound('Séance introuvable');
    return s;
  };
  const allowed = async (ctx, org) => { if (!(await odj.canEditOdj(ctx, org))) throw E.forbidden('La convocation est réservée au SCC, à la DGS et aux administrateurs'); };
  const linkOf = (tok) => `${config.publicBaseUrl}/c/${tok}`;
  const hashIp = (ip) => (ip ? crypto.createHash('sha256').update(`${config.jwt.secret}|${ip}`).digest('hex').slice(0, 16) : null);
  const footerOf = (cfg) => ({ line1: cfg['mail.footer1']?.value, line2: cfg['mail.footer2']?.value, line3: cfg['mail.footer3']?.value, color: cfg['mail.footerColor']?.value });
  const dateLong = (d) => new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  const heure = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', 'h');

  // ------------------------------------------------------------------------------------------ convoqués possibles
  /** Élus de l'instance : tous les conseillers pour le Conseil, les membres pour une commission (CONV-01, CONV-10). */
  async function eluxOf(org, s) {
    const rows = s.commission_id
      ? await db.all(`SELECT e.*, g.nom AS groupe_nom, m.fonction AS fonction_commission FROM commission_membres m JOIN elus e ON e.id = m.elu_id LEFT JOIN groupes_politiques g ON g.id = e.groupe_id
                      WHERE m.commission_id = $1 AND e.actif ORDER BY e.nom, e.prenom`, [s.commission_id])
      : await db.all(`SELECT e.*, g.nom AS groupe_nom FROM elus e LEFT JOIN groupes_politiques g ON g.id = e.groupe_id WHERE e.organisme_id = $1 AND e.actif AND e.est_elu ORDER BY e.nom, e.prenom`, [org]);
    return rows.map((e) => ({ id: e.id, nom: `${cap(e.prenom)} ${String(e.nom || '').toUpperCase()}`.trim(), email: e.email || null, qualite: e.role || null, groupe: e.groupe_nom || null, aUnEmail: !!e.email }));
  }

  async function resolveAgent(username) {
    const u = String(username || '').trim().toLowerCase().replace(/^@/, '');
    if (!u) throw E.badRequest('Identifiant d\'agent vide');
    const a = await dir.getAgent(u);
    if (a) {
      const poste = await dir.posteAffiche({ displayName: a.displayName, nom: a.nom, prenom: a.prenom, direction: a.direction?.label, service: a.service, poste: a.poste });
      return { username: u, nom: a.displayName || u, email: a.email || (config.emailDomain ? `${u}@${config.emailDomain}` : null), qualite: [poste, a.direction?.label].filter(Boolean).join(' · ') || null };
    }
    const hit = (await dir.searchLogins(u, 10)).find((h) => h.username === u);
    if (!hit) throw E.notFound(`Agent « ${u} » introuvable dans l'annuaire`);
    return { username: u, nom: hit.displayName || u, email: hit.email || (config.emailDomain ? `${u}@${config.emailDomain}` : null), qualite: [hit.poste, hit.direction].filter(Boolean).join(' · ') || null };
  }

  async function delaiOf(org, seance, now = new Date()) {
    const cfg = await settings.resolve(org);
    const requis = Number(cfg['convocation.delai_jours_francs']?.value ?? 5);
    const urgence = Number(cfg['convocation.delai_urgence']?.value ?? 1);
    const mode = cfg['convocation.delai_mode']?.value === 'avertir' ? 'avertir' : 'bloquer';
    const joursFrancs = Math.max(0, dayNumber(seance.date_seance) - dayNumber(now) - 1);
    return { joursFrancs, requis, requisUrgence: urgence, mode, ok: joursFrancs >= requis };
  }

  /** Ce qui sera proposé à l'écran d'envoi : convoqués possibles, état de l'ordre du jour, contrôle du délai, versions déjà envoyées. */
  async function preparation(ctx, org, seanceId) {
    await allowed(ctx, org);
    const s = await seanceRow(org, seanceId);
    const d = await odj.get(ctx, org, seanceId);
    const secretaires = s.commission_id ? await db.all('SELECT username FROM commission_secretaires WHERE commission_id = $1 ORDER BY username', [s.commission_id]) : [];
    const versions = await db.all('SELECT version_no, created_at, statut FROM convocations WHERE seance_id = $1 ORDER BY version_no DESC', [seanceId]);
    return {
      seance: { id: s.id, instance: s.instance_nom, dateSeance: s.date_seance, lieu: s.lieu, statut: s.statut, commission: !!s.commission_id },
      odj: { arrete: s.odj_statut !== 'en_preparation', statut: s.odj_statut, points: d.items.filter((i) => i.statut === 'a_traiter').length },
      delai: await delaiOf(org, s),
      elus: await eluxOf(org, s),
      agentsSuggeres: secretaires.map((r) => r.username),
      versions: versions.map((v) => ({ version: v.version_no, creeLe: v.created_at, statut: v.statut })),
      prochaineVersion: (versions[0]?.version_no ?? 0) + 1,
    };
  }

  // ------------------------------------------------------------------------------------------ documents
  async function buildDocs(ctx, org, s, { version, objet, message, urgence, urgenceMotif, items, differences }) {
    const orgRow = await db.get('SELECT nom, contact FROM organismes WHERE id = $1', [org]);
    const vars = { organisme: orgRow?.nom || '', instance: s.instance_nom, date_seance: dateLong(s.date_seance).toUpperCase() };
    const numbered = items.filter((i) => i.kind !== 'chapitre');
    const listLines = items.map((i) => (i.kind === 'chapitre' ? `# ${i.titre}` : `**${i.numero ?? '·'}** — ${i.titre}`)).join('\n');
    const sign = [orgRow?.contact?.signataire, orgRow?.contact?.signataireQualite].filter(Boolean);
    const conv = await render.build({ organismeId: org, docType: 'convocation', vars, watermark: '', title: `Convocation — ${s.instance_nom}`, content: [
      { type: 'space', h: 20 },
      { type: 'title', text: orgRow?.nom || '', size: 14, align: 'center', bold: true, after: 10 },
      { type: 'title', text: version > 1 ? `CONVOCATION MODIFICATIVE (version ${version})` : 'CONVOCATION', size: 18, align: 'center', bold: true, boxed: true, after: 14 },
      { type: 'runs', runs: [{ type: 'text', text: [
        `Mesdames et Messieurs les membres du ${s.instance_nom},`, '',
        `Vous êtes convoqué(e) à la séance du **${dateLong(s.date_seance)}** à **${heure(s.date_seance)}**${s.lieu ? `, ${s.lieu}` : ''}.`,
        ...(urgence ? ['', `**Convocation adressée en urgence** — motif : ${urgenceMotif}`] : []),
        ...(message ? ['', message] : []),
        ...(differences && (differences.ajoutes.length || differences.retires.length) ? ['', '**Modifications de l\'ordre du jour**', ...differences.ajoutes.map((t) => `- ajouté : ${t}`), ...differences.retires.map((t) => `- retiré : ${t}`)] : []),
        '', `**Ordre du jour** (${numbered.length} point(s))`, '', listLines,
        ...(sign.length ? ['', '', ...sign] : []),
      ].join('\n') }] },
    ] });
    const odjDoc = await render.build({ organismeId: org, docType: 'odj', vars, watermark: '', title: `Ordre du jour — ${s.instance_nom}`, content: [
      { type: 'space', h: 20 },
      { type: 'title', text: orgRow?.nom || '', size: 14, align: 'center', bold: true, after: 10 },
      { type: 'title', text: 'ORDRE DU JOUR', size: 18, align: 'center', bold: true, boxed: true, after: 10 },
      { type: 'title', text: `${s.instance_nom} — ${dateLong(s.date_seance)} à ${heure(s.date_seance)}`, size: 12, align: 'center', bold: true, after: 14 },
      { type: 'runs', runs: [{ type: 'text', text: items.map((i) => (i.kind === 'chapitre' ? `# ${i.titre}` : `**${i.numero ?? '·'}** — ${i.titre}${i.rapporteur ? `\nRapporteur : ${i.rapporteur}${i.rubrique ? ` · ${i.rubrique}` : ''}` : ''}\n`)).join('\n') }] },
    ] });
    const store = async (doc, name) => {
      const put = await storage.put(doc.buffer, { organismeId: org, ext: 'pdf' });
      return (await db.get(`INSERT INTO files (organisme_id, storage_key, original_name, mime, size, pages, sha256, created_by) VALUES ($1,$2,$3,'application/pdf',$4,$5,$6,$7) RETURNING id`,
        [org, put.key, name, put.size, doc.pageCount, put.sha256, ctx.username])).id;
    };
    return { convocationFileId: await store(conv, `convocation-seance-${s.id}-v${version}.pdf`), odjFileId: await store(odjDoc, `odj-seance-${s.id}-v${version}.pdf`) };
  }

  // ------------------------------------------------------------------------------------------ envoi
  async function logEvent(convId, destId, type, meta = null, req = null) {
    await db.run('INSERT INTO convocation_events (convocation_id, destinataire_id, type, ip_hash, user_agent, meta) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',
      [convId, destId, type, hashIp(req?.ip), req?.ua ? String(req.ua).slice(0, 200) : null, meta ? JSON.stringify(meta) : null]);
  }

  async function sendOne(org, conv, s, dest, { relance = false } = {}) {
    const cfg = await settings.resolve(org);
    const subject = `${relance ? 'Rappel — ' : ''}${conv.modificatif ? 'Convocation modifiée' : 'Convocation'} — ${s.instance_nom} du ${dateLong(s.date_seance)}`;
    const p = (t) => `<p>${esc(t)}</p>`;
    const html = [
      p(`Bonjour ${dest.nom},`),
      p(relance ? `Nous vous rappelons que vous êtes convoqué(e) à la séance du ${s.instance_nom} du ${dateLong(s.date_seance)} à ${heure(s.date_seance)}${s.lieu ? `, ${s.lieu}` : ''}.`
        : `Vous êtes convoqué(e) à la séance du ${s.instance_nom} du ${dateLong(s.date_seance)} à ${heure(s.date_seance)}${s.lieu ? `, ${s.lieu}` : ''}.`),
      conv.urgence ? p(`Convocation adressée en urgence : ${conv.urgence_motif}`) : '',
      conv.message ? p(conv.message) : '',
      `<p><a href="${esc(linkOf(dest.token))}"><strong>Consulter la convocation et l'ordre du jour</strong></a></p>`,
      p('Ce lien vous est personnel : merci de ne pas le transférer. Son ouverture et la consultation des documents sont enregistrées (preuve de mise à disposition).'),
    ].join('');
    let to = dest.email; let subj = subject; let body = html;
    if (config.mailRedirectTo) { to = config.mailRedirectTo; subj = `[RECETTE → ${dest.email}] ${subject}`; body = `<p><em>Mode recette : ce message était destiné à ${esc(dest.email)}.</em></p>${html}`; }
    await mail.send({ to, subject: subj, html: body, footer: footerOf(cfg) });
  }

  async function dispatch(org, convId, { relance = false, only = null } = {}) {
    const conv = await db.get('SELECT * FROM convocations WHERE id = $1', [convId]);
    const s = await seanceRow(org, conv.seance_id);
    const dests = await db.all(`SELECT * FROM convocation_destinataires WHERE convocation_id = $1 ${only ? 'AND id = ANY($2::int[])' : ''} ORDER BY id`, only ? [convId, only] : [convId]);
    let ok = 0; let ko = 0;
    for (const d of dests) {
      if (!d.email) { ko++; await db.run("UPDATE convocation_destinataires SET envoi_statut = 'echec', erreur = $2 WHERE id = $1", [d.id, "Pas d'adresse e-mail"]); await logEvent(convId, d.id, 'echec', { erreur: "Pas d'adresse e-mail" }); continue; }
      try {
        await sendOne(org, conv, s, d, { relance });
        ok++;
        if (relance) { await db.run('UPDATE convocation_destinataires SET relances = relances + 1, derniere_relance_at = now() WHERE id = $1', [d.id]); await logEvent(convId, d.id, 'relance'); }
        else { await db.run("UPDATE convocation_destinataires SET envoi_statut = 'envoye', envoye_at = now(), erreur = NULL WHERE id = $1", [d.id]); await logEvent(convId, d.id, 'envoi'); }
      } catch (e) {
        ko++;
        await db.run("UPDATE convocation_destinataires SET envoi_statut = CASE WHEN $3 THEN envoi_statut ELSE 'echec' END, erreur = $2 WHERE id = $1", [d.id, String(e.message).slice(0, 300), relance]);
        await logEvent(convId, d.id, 'echec', { erreur: String(e.message).slice(0, 300), relance });
      }
    }
    if (!relance) await db.run("UPDATE convocations SET statut = 'envoyee', finished_at = now() WHERE id = $1", [convId]);
    return { ok, ko };
  }

  const svc = {
    TYPES, preparation, delaiOf,
    pending: new Set(),
    async idle() { while (svc.pending.size) await Promise.allSettled([...svc.pending]); },
    background(p) { const w = p.catch((e) => log.error({ err: e.message }, 'convocation : échec')).finally(() => svc.pending.delete(w)); svc.pending.add(w); },

    /** Crée la version suivante (convocation ou modificatif), génère les documents et les liens personnels, lance l'envoi. */
    async envoyer(ctx, organismeId, seanceId, b = {}) {
      const org = requireOrg(organismeId);
      await allowed(ctx, org);
      const s = await seanceRow(org, seanceId);
      if (s.statut === 'annulee') throw E.conflict('La séance est annulée');
      if (s.odj_statut === 'en_preparation') throw E.conflict("L'ordre du jour n'est pas arrêté : arrêtez-le avant de convoquer (ODJ-06)");
      const delai = await delaiOf(org, s);
      let avertissement = null;
      if (!delai.ok) {
        if (b.urgence) {
          if (!b.urgenceMotif || b.urgenceMotif.trim().length < 5) throw E.badRequest("Le motif d'urgence est obligatoire (5 caractères au moins)");
          if (delai.joursFrancs < delai.requisUrgence) throw E.deadline(`Même en urgence, ${delai.requisUrgence} jour(s) franc(s) sont exigés avant la séance (il n'en reste que ${delai.joursFrancs})`);
          avertissement = `Délai réduit à ${delai.joursFrancs} jour(s) franc(s) (${delai.requis} requis) : urgence — ${b.urgenceMotif.trim()}`;
        } else if (delai.mode === 'bloquer') {
          throw E.deadline(`Le délai de convocation n'est pas respecté : ${delai.joursFrancs} jour(s) franc(s) avant la séance, ${delai.requis} requis. Convoquez en urgence (motif obligatoire) ou reportez la séance.`);
        } else avertissement = `Délai non respecté : ${delai.joursFrancs} jour(s) franc(s) avant la séance, ${delai.requis} requis`;
      }

      // convoqués
      const audience = await eluxOf(org, s);
      const eluIds = b.eluIds ?? audience.map((e) => e.id);
      const chosen = [];
      for (const id of [...new Set(eluIds)]) {
        const e = audience.find((x) => x.id === id);
        if (!e) throw E.badRequest(`L'élu ${id} ne fait pas partie des membres de cette instance`);
        chosen.push({ kind: 'elu', eluId: e.id, nom: e.nom, email: e.email, qualite: e.qualite, groupe: e.groupe });
      }
      for (const u of [...new Set((b.agents || []).map((x) => String(x).trim().toLowerCase().replace(/^@/, '')))]) {
        const a = await resolveAgent(u);
        chosen.push({ kind: 'agent', username: a.username, nom: a.nom, email: a.email, qualite: a.qualite, groupe: null });
      }
      if (!chosen.length) throw E.badRequest('Aucun convoqué : choisissez au moins un élu ou un agent');

      const d = await odj.get(ctx, org, seanceId);
      const items = d.items.filter((i) => i.statut === 'a_traiter').map((i) => ({ numero: i.numero, titre: i.titre, kind: i.kind, rubrique: i.acte?.rubrique ?? null, rapporteur: i.acte?.rapporteur ?? null, key: `${i.acte?.id ?? 't'}:${i.deliberationId ?? i.titre}` }));
      if (!items.length) throw E.conflict("L'ordre du jour est vide");
      const prev = await db.get('SELECT * FROM convocations WHERE seance_id = $1 ORDER BY version_no DESC LIMIT 1', [seanceId]);
      const version = (prev?.version_no ?? 0) + 1;
      let differences = null;
      if (prev) {
        const before = new Map((prev.odj_snapshot || []).map((x) => [x.key, x])); const now = new Map(items.map((x) => [x.key, x]));
        differences = { ajoutes: items.filter((x) => !before.has(x.key)).map((x) => x.titre), retires: [...before.values()].filter((x) => !now.has(x.key)).map((x) => x.titre) };
      }
      const objet = (b.objet && b.objet.trim()) || `${version > 1 ? 'Convocation modifiée' : 'Convocation'} — ${s.instance_nom} du ${dateLong(s.date_seance)}`;
      const files = await buildDocs(ctx, org, s, { version, objet, message: b.message?.trim() || null, urgence: !!b.urgence && !delai.ok, urgenceMotif: b.urgenceMotif?.trim() || null, items, differences });
      const conv = await db.get(
        `INSERT INTO convocations (organisme_id, seance_id, version_no, modificatif, objet, message, urgence, urgence_motif, delai_jours_francs, delai_requis, avertissement, odj_snapshot, differences, convocation_file_id, odj_file_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16) RETURNING *`,
        [org, seanceId, version, version > 1, objet, b.message?.trim() || null, !!b.urgence && !delai.ok, (b.urgence && !delai.ok && b.urgenceMotif?.trim()) || null, delai.joursFrancs, delai.requis, avertissement,
          JSON.stringify(items), differences ? JSON.stringify(differences) : null, files.convocationFileId, files.odjFileId, ctx.username]);
      for (const c of chosen) {
        await db.run(`INSERT INTO convocation_destinataires (convocation_id, kind, elu_id, username, nom, qualite, groupe, email, token) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [conv.id, c.kind, c.eluId ?? null, c.username ?? null, c.nom, c.qualite, c.groupe, c.email, token()]);
      }
      await audit.log(ctx, { organismeId: org, action: 'convocation.envoi', entity: 'seances', entityId: seanceId, after: { version, destinataires: chosen.length, elus: chosen.filter((c) => c.kind === 'elu').length, agents: chosen.filter((c) => c.kind === 'agent').length, urgence: conv.urgence, avertissement } });
      svc.background(dispatch(org, conv.id));
      return svc.get(ctx, org, seanceId, version);
    },

    // ------------------------------------------------------------------------------------------ suivi (page de logs et de statistiques)
    async versions(ctx, org, seanceId) {
      await allowed(ctx, org); await seanceRow(org, seanceId);
      const rows = await db.all(
        `SELECT c.*, count(d.id)::int AS n, count(*) FILTER (WHERE d.envoi_statut = 'envoye')::int AS envoyes, count(*) FILTER (WHERE d.envoi_statut = 'echec')::int AS echecs,
                count(*) FILTER (WHERE d.ouvertures > 0)::int AS ouverts, count(*) FILTER (WHERE d.conv_lectures > 0)::int AS conv_lue, count(*) FILTER (WHERE d.odj_lectures > 0)::int AS odj_lu,
                count(*) FILTER (WHERE d.accuse_at IS NOT NULL)::int AS accuses, count(*) FILTER (WHERE d.reponse = 'present')::int AS presents, count(*) FILTER (WHERE d.reponse = 'absent')::int AS absents
         FROM convocations c LEFT JOIN convocation_destinataires d ON d.convocation_id = c.id WHERE c.seance_id = $1 GROUP BY c.id ORDER BY c.version_no DESC`, [seanceId]);
      return rows.map(toVersion);
    },

    async get(ctx, org, seanceId, n) {
      const v = (await svc.versions(ctx, org, seanceId)).find((x) => x.version === Number(n));
      if (!v) throw E.notFound('Version de la convocation introuvable');
      return v;
    },

    async destinataires(ctx, org, seanceId, n) {
      const v = await svc.get(ctx, org, seanceId, n);
      const rows = await db.all('SELECT * FROM convocation_destinataires WHERE convocation_id = $1 ORDER BY kind, nom', [v.id]);
      return rows.map((d) => ({
        id: d.id, kind: d.kind, username: d.username, eluId: d.elu_id, nom: d.nom, qualite: d.qualite, groupe: d.groupe, email: d.email, lien: linkOf(d.token),
        envoi: { statut: d.envoi_statut, at: d.envoye_at, erreur: d.erreur },
        ouvertures: d.ouvertures, premiereOuvertureAt: d.premiere_ouverture_at, derniereOuvertureAt: d.derniere_ouverture_at,
        convocationLue: { fois: d.conv_lectures, at: d.conv_lue_at }, odjLu: { fois: d.odj_lectures, at: d.odj_lu_at },
        accuseAt: d.accuse_at, reponse: d.reponse, reponseAt: d.reponse_at, reponseCommentaire: d.reponse_commentaire, relances: d.relances, derniereRelanceAt: d.derniere_relance_at,
      }));
    },

    /** Journal (preuve) : tous les évènements de la version, du plus récent au plus ancien. */
    async journal(ctx, org, seanceId, n, { type, destinataireId, limit = 100, offset = 0 } = {}) {
      const v = await svc.get(ctx, org, seanceId, n);
      const p = [v.id]; const w = ['e.convocation_id = $1'];
      if (type) { p.push(type); w.push(`e.type = $${p.length}`); }
      if (destinataireId) { p.push(destinataireId); w.push(`e.destinataire_id = $${p.length}`); }
      const total = (await db.get(`SELECT count(*)::int AS n FROM convocation_events e WHERE ${w.join(' AND ')}`, p)).n;
      p.push(limit, offset);
      const rows = await db.all(
        `SELECT e.*, d.nom, d.kind, d.qualite FROM convocation_events e LEFT JOIN convocation_destinataires d ON d.id = e.destinataire_id
         WHERE ${w.join(' AND ')} ORDER BY e.at DESC, e.id DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p);
      return { total, items: rows.map((e) => ({ id: e.id, at: e.at, type: e.type, destinataireId: e.destinataire_id, nom: e.nom, kind: e.kind, qualite: e.qualite, empreinteIp: e.ip_hash, navigateur: e.user_agent, meta: e.meta })) };
    },

    /** Statistiques : totaux, taux, répartition élus / agents / groupes, chronologie des ouvertures, non-lecteurs. */
    async stats(ctx, org, seanceId, n) {
      const v = await svc.get(ctx, org, seanceId, n);
      const dests = await svc.destinataires(ctx, org, seanceId, n);
      const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
      const tot = (list) => ({
        total: list.length, envoyes: list.filter((d) => d.envoi.statut === 'envoye').length, echecs: list.filter((d) => d.envoi.statut === 'echec').length,
        ouverts: list.filter((d) => d.ouvertures > 0).length, convocationLue: list.filter((d) => d.convocationLue.fois > 0).length, odjLu: list.filter((d) => d.odjLu.fois > 0).length,
        accuses: list.filter((d) => d.accuseAt).length, presents: list.filter((d) => d.reponse === 'present').length, absents: list.filter((d) => d.reponse === 'absent').length,
        sansReponse: list.filter((d) => !d.reponse).length,
      });
      const t = tot(dests);
      const groupes = new Map();
      for (const d of dests.filter((x) => x.kind === 'elu')) { const g = groupes.get(d.groupe || 'Sans groupe') || []; g.push(d); groupes.set(d.groupe || 'Sans groupe', g); }
      const chrono = await db.all(
        `SELECT to_char(date_trunc('day', e.at AT TIME ZONE 'Europe/Paris'), 'YYYY-MM-DD') AS jour, count(*) FILTER (WHERE e.type = 'ouverture')::int AS ouvertures,
                count(*) FILTER (WHERE e.type = 'convocation_lue')::int AS convocation, count(*) FILTER (WHERE e.type = 'odj_lu')::int AS odj
         FROM convocation_events e WHERE e.convocation_id = $1 AND e.type IN ('ouverture', 'convocation_lue', 'odj_lu') GROUP BY 1 ORDER BY 1`, [v.id]);
      const delais = dests.filter((d) => d.premiereOuvertureAt && d.envoi.at).map((d) => (new Date(d.premiereOuvertureAt) - new Date(d.envoi.at)) / 3600000);
      return {
        version: v.version, totaux: t,
        taux: { ouverture: pct(t.ouverts, t.envoyes), convocationLue: pct(t.convocationLue, t.envoyes), odjLu: pct(t.odjLu, t.envoyes), accuse: pct(t.accuses, t.envoyes), reponse: pct(t.presents + t.absents, t.envoyes) },
        parType: { elu: tot(dests.filter((d) => d.kind === 'elu')), agent: tot(dests.filter((d) => d.kind === 'agent')) },
        parGroupe: [...groupes.entries()].map(([groupe, l]) => ({ groupe, ...tot(l) })).sort((a, b) => b.total - a.total),
        chronologie: chrono,
        delaiMoyenPremiereOuvertureHeures: delais.length ? Math.round((delais.reduce((a, b) => a + b, 0) / delais.length) * 10) / 10 : null,
        nonLecteurs: dests.filter((d) => d.envoi.statut === 'envoye' && d.convocationLue.fois === 0).map((d) => ({ id: d.id, nom: d.nom, kind: d.kind, qualite: d.qualite, email: d.email, ouvert: d.ouvertures > 0, relances: d.relances, derniereRelanceAt: d.derniereRelanceAt })),
        enEchec: dests.filter((d) => d.envoi.statut === 'echec').map((d) => ({ id: d.id, nom: d.nom, erreur: d.envoi.erreur })),
      };
    },

    /** Relance les convoqués qui n'ont pas encore consulté la convocation (même lien personnel). */
    async relancer(ctx, org, seanceId, n, { cible = 'non_lecteurs' } = {}) {
      const v = await svc.get(ctx, org, seanceId, n);
      const rows = await db.all('SELECT id, ouvertures, conv_lectures, reponse, envoi_statut FROM convocation_destinataires WHERE convocation_id = $1', [v.id]);
      const only = rows.filter((d) => d.envoi_statut === 'envoye' && (cible === 'sans_reponse' ? !d.reponse : d.conv_lectures === 0)).map((d) => d.id);
      if (!only.length) return { relances: 0 };
      const newest = (await db.get('SELECT max(version_no) AS m FROM convocations WHERE seance_id = $1', [seanceId])).m;
      if (Number(n) !== newest) throw E.conflict(`Une version plus récente (v${newest}) existe : relancez celle-là`);
      await audit.log(ctx, { organismeId: org, action: 'convocation.relance', entity: 'seances', entityId: seanceId, after: { version: Number(n), cible, destinataires: only.length } });
      svc.background(dispatch(org, v.id, { relance: true, only }));
      return { relances: only.length };
    },

    /** Preuve d'envoi et de consultation (CSV). */
    async exportCsv(ctx, org, seanceId, n) {
      const list = await svc.destinataires(ctx, org, seanceId, n);
      const q = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
      const iso = (d) => (d ? new Date(d).toISOString() : '');
      const head = ['Convoqué', 'Type', 'Qualité', 'Groupe', 'E-mail', 'Envoi', 'Statut envoi', 'Première ouverture', 'Ouvertures', 'Convocation consultée', 'Fois', 'Ordre du jour consulté', 'Fois', 'Accusé de lecture', 'Réponse', 'Relances'];
      const rows = list.map((d) => [d.nom, d.kind === 'elu' ? 'élu' : 'agent', d.qualite, d.groupe, d.email, iso(d.envoi.at), d.envoi.statut, iso(d.premiereOuvertureAt), d.ouvertures, iso(d.convocationLue.at), d.convocationLue.fois, iso(d.odjLu.at), d.odjLu.fois, iso(d.accuseAt), d.reponse ?? '', d.relances].map(q).join(';'));
      const bom = String.fromCharCode(0xFEFF);
      return [bom + head.map(q).join(';'), ...rows, ''].join(String.fromCharCode(10));
    },

    // ------------------------------------------------------------------------------------------ côté convoqué (lien personnel, sans connexion)
    async byToken(tok) {
      if (!tok || String(tok).length < 20) throw E.notFound('Lien inconnu');
      const d = await db.get('SELECT * FROM convocation_destinataires WHERE token = $1', [String(tok)]);
      if (!d) throw E.notFound('Lien inconnu');
      const conv = await db.get('SELECT * FROM convocations WHERE id = $1', [d.convocation_id]);
      return { d, conv };
    },

    /** Ouverture du lien : c'est ici que « lu » commence (première ouverture, nombre d'ouvertures). */
    async openToken(tok, req) {
      const { d, conv } = await svc.byToken(tok);
      const s = await db.get('SELECT s.*, i.nom AS instance_nom FROM seances s JOIN instances i ON i.id = s.instance_id WHERE s.id = $1', [conv.seance_id]);
      await db.run('UPDATE convocation_destinataires SET ouvertures = ouvertures + 1, premiere_ouverture_at = COALESCE(premiere_ouverture_at, now()), derniere_ouverture_at = now() WHERE id = $1', [d.id]);
      await logEvent(conv.id, d.id, 'ouverture', null, req);
      const org = await db.get('SELECT id, nom, logo_path, logo_sha256 FROM organismes WHERE id = $1', [conv.organisme_id]);
      const newest = (await db.get('SELECT max(version_no) AS m FROM convocations WHERE seance_id = $1', [conv.seance_id])).m;
      const fresh = await db.get('SELECT * FROM convocation_destinataires WHERE id = $1', [d.id]);
      return {
        organisme: { id: org.id, nom: org.nom, hasLogo: !!org.logo_path, logoVersion: org.logo_sha256 ? org.logo_sha256.slice(0, 12) : null },
        convoque: { nom: d.nom, qualite: d.qualite },
        seance: { instance: s.instance_nom, dateSeance: s.date_seance, lieu: s.lieu, annulee: s.statut === 'annulee' },
        convocation: { version: conv.version_no, modificatif: conv.modificatif, objet: conv.objet, message: conv.message, urgence: conv.urgence, urgenceMotif: conv.urgence_motif, differences: conv.differences, envoyeLe: d.envoye_at },
        ordreDuJour: conv.odj_snapshot.map(({ numero, titre, kind, rubrique, rapporteur }) => ({ numero, titre, kind, rubrique, rapporteur })),
        remplacee: conv.version_no < newest ? { version: newest } : null,
        lu: { convocation: fresh.conv_lectures > 0, odj: fresh.odj_lectures > 0, accuseAt: fresh.accuse_at },
        reponse: fresh.reponse ? { reponse: fresh.reponse, at: fresh.reponse_at, commentaire: fresh.reponse_commentaire } : null,
      };
    },

    async pdfToken(tok, kind, req) {
      const { d, conv } = await svc.byToken(tok);
      const fileId = kind === 'odj' ? conv.odj_file_id : conv.convocation_file_id;
      const f = await db.get('SELECT storage_key FROM files WHERE id = $1', [fileId]);
      if (!f) throw E.notFound('Document indisponible');
      const [colN, colAt, type] = kind === 'odj' ? ['odj_lectures', 'odj_lu_at', 'odj_lu'] : ['conv_lectures', 'conv_lue_at', 'convocation_lue'];
      await db.run(`UPDATE convocation_destinataires SET ${colN} = ${colN} + 1, ${colAt} = COALESCE(${colAt}, now()) WHERE id = $1`, [d.id]);
      await logEvent(conv.id, d.id, type, null, req);
      return { buffer: await storage.get(f.storage_key), name: `${kind === 'odj' ? 'ordre-du-jour' : 'convocation'}-v${conv.version_no}.pdf` };
    },

    async accuseToken(tok, req) {
      const { d, conv } = await svc.byToken(tok);
      const r = await db.get('UPDATE convocation_destinataires SET accuse_at = COALESCE(accuse_at, now()) WHERE id = $1 RETURNING accuse_at', [d.id]);
      await logEvent(conv.id, d.id, 'accuse', null, req);
      return { accuseAt: r.accuse_at };
    },

    async reponseToken(tok, { reponse, commentaire }, req) {
      const { d, conv } = await svc.byToken(tok);
      const s = await db.get('SELECT statut FROM seances WHERE id = $1', [conv.seance_id]);
      if (s.statut === 'annulee') throw E.conflict('La séance est annulée');
      const r = await db.get('UPDATE convocation_destinataires SET reponse = $2, reponse_commentaire = $3, reponse_at = now() WHERE id = $1 RETURNING reponse, reponse_at', [d.id, reponse, commentaire?.trim() || null]);
      await logEvent(conv.id, d.id, 'reponse', { reponse }, req);
      return { reponse: r.reponse, at: r.reponse_at };
    },
  };

  const toVersion = (r) => ({
    id: r.id, seanceId: r.seance_id, version: r.version_no, modificatif: r.modificatif, objet: r.objet, message: r.message, urgence: r.urgence, urgenceMotif: r.urgence_motif,
    delai: { joursFrancs: r.delai_jours_francs, requis: r.delai_requis }, avertissement: r.avertissement, differences: r.differences, statut: r.statut, points: (r.odj_snapshot || []).length,
    creePar: r.created_by, creeLe: r.created_at, termineLe: r.finished_at,
    compteurs: { destinataires: r.n, envoyes: r.envoyes, echecs: r.echecs, ouverts: r.ouverts, convocationLue: r.conv_lue, odjLu: r.odj_lu, accuses: r.accuses, presents: r.presents, absents: r.absents },
  });

  return svc;
}

module.exports = { createConvocations, TYPES };
