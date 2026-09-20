/**
 * Espace élus (section 18, D85) : ce que voit et peut faire un ÉLU. Règles de fond :
 *  - les élus n'accèdent qu'à des DOCUMENTS FINALISÉS EN PDF, mis en page par l'outil (exposé des motifs, projet de délibération,
 *    annexes communicables, convocation, ordre du jour, cahier numérique). Jamais : notes de séance, décomptes de saisie, circuit,
 *    commentaires, brouillons, modifications suivies (MAD-03) ;
 *  - une séance n'apparaît qu'une fois « mise à disposition » (envoi de la convocation, ou arrêt de l'ordre du jour : paramètre
 *    `elus.mad_declencheur`), au même instant pour tous les membres de l'instance (MAD-02) ;
 *  - chaque PDF est servi avec un FILIGRANE NOMINATIF stable (élu + séance : identique d'un téléchargement à l'autre, donc
 *    compatible avec le stockage hors ligne) ;
 *  - chaque document a une VERSION (empreinte du contenu source) : le manifeste permet au client de télécharger en arrière-plan
 *    ce qui manque ou a changé, sans rien recalculer côté serveur ;
 *  - un point retiré de l'ordre du jour reste visible « retiré », sans document (MAD-05) ;
 *  - les notes personnelles sont privées ; aucune route agent n'y accède (ELU-33).
 */
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const sha = (x) => crypto.createHash('sha256').update(typeof x === 'string' || Buffer.isBuffer(x) ? x : JSON.stringify(x)).digest('hex');
const cap = (x) => String(x || '').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const dateFr = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
const AVIS = { favorable: 'Favorable', defavorable: 'Défavorable', reserve: 'Favorable avec réserves', sans_avis: 'Sans avis' };
const SYS = (org) => ({ username: 'espace-elus', kind: 'system', isPlatformAdmin: true, organismes: [], roles: [], orgIds: [org], agent: null, displayName: 'Espace élus' });

/** Filigrane nominatif : pied de page sur chaque page + diagonale très claire (dissuade la rediffusion, MAD-08). */
async function stamp(buffer, text) {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const clean = text.replace(/[^\x20-\x7EÀ-ÿ’—–·]/g, '');
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    page.drawText(clean, { x: 28, y: 14, size: 7, font: f, color: rgb(0.45, 0.45, 0.45) });
    page.drawText(clean, { x: width * 0.12, y: height * 0.32, size: 22, font: f, color: rgb(0.6, 0.6, 0.6), opacity: 0.09, rotate: degrees(40) });
  }
  return Buffer.from(await doc.save());
}

function createEspaceElus({ db, audit, settings, render, tenue, storage, cahier, log }) {
  const nomOf = (e) => `${cap(e.prenom)} ${String(e.nom || '').toUpperCase()}`.trim();
  const cfgOf = async (org) => (await settings.resolve(org));

  // ------------------------------------------------------------------------------------------------- séances visibles
  /** Séances que cet élu a le droit de voir : de son instance, déjà « mises à disposition ». */
  async function visibles(elu, { seanceId } = {}) {
    const org = elu.organismeId; const cfg = await cfgOf(org); const decl = cfg['elus.mad_declencheur']?.value === 'arret' ? 'arret' : 'convocation';
    const p = [org, elu.id]; let w = '';
    if (seanceId) { p.push(seanceId); w = 'AND s.id = $3'; }
    const rows = await db.all(
      `SELECT s.*, i.nom AS instance_nom, i.kind AS instance_kind,
              (SELECT max(c.finished_at) FROM convocations c WHERE c.seance_id = s.id AND c.statut = 'envoyee') AS convoque_le
       FROM seances s JOIN instances i ON i.id = s.instance_id
       WHERE s.organisme_id = $1 AND s.statut <> 'annulee' ${w}
         AND (i.commission_id IS NULL OR EXISTS (SELECT 1 FROM commission_membres m WHERE m.commission_id = i.commission_id AND m.elu_id = $2))
       ORDER BY s.date_seance DESC`, p);
    return rows.filter((s) => (decl === 'arret' ? s.odj_statut !== 'en_preparation' : !!s.convoque_le))
      .map((s) => ({ row: s, madLe: decl === 'arret' ? s.odj_arrete_at : s.convoque_le, declencheur: decl }));
  }

  async function seanceOf(elu, id) {
    const v = (await visibles(elu, { seanceId: id }))[0];
    if (!v) throw E.notFound('Séance introuvable');
    return v;
  }

  // ------------------------------------------------------------------------------------------------- documents d'un point
  const tplVersion = async (org, type) => (await db.get('SELECT version FROM render_templates WHERE organisme_id = $1 AND doc_type = $2', [org, type]))?.version ?? 0;

  /** Documents d'un point et leur VERSION (sans rien rendre : empreinte des sources). */
  async function docsOfItem(org, it, premiereFoisActe) {
    const docs = [];
    if (it.statut === 'retire') return docs;
    if (it.kind === 'deliberation' && it.acte_id) {
      const a = await db.get('SELECT id, updated_at, titre FROM actes WHERE id = $1', [it.acte_id]);
      const texts = await db.all('SELECT id, kind, version_no, deliberation_id FROM tracked_texts WHERE acte_id = $1 ORDER BY id', [a.id]);
      if (premiereFoisActe) {
        const v = sha({ k: 'expose', t: texts.filter((t) => t.kind === 'expose').map((t) => [t.id, t.version_no]), tpl: await tplVersion(org, 'expose'), a: a.updated_at });
        docs.push({ key: `p:${it.id}:expose`, type: 'expose', titre: 'Exposé des motifs', version: v });
      }
      const v = sha({ k: 'projet', t: texts.filter((t) => t.deliberation_id === it.deliberation_id).map((t) => [t.id, t.version_no]), tpl: await tplVersion(org, 'deliberation'), a: a.updated_at });
      docs.push({ key: `p:${it.id}:projet`, type: 'projet', titre: 'Projet de délibération', version: v });
      for (const x of await db.all(`SELECT an.id, an.titre, f.sha256, f.mime FROM annexes an JOIN files f ON f.id = an.file_id WHERE an.acte_id = $1 AND an.communicable AND f.mime = 'application/pdf' ORDER BY an.ordre, an.id`, [a.id])) {
        docs.push({ key: `a:${it.id}:${x.id}`, type: 'annexe', titre: x.titre, version: x.sha256 });
      }
    } else if (it.kind === 'libre') {
      for (const x of await db.all(`SELECT f.id, f.titre, fl.sha256, fl.mime, fl.original_name FROM seance_item_fichiers f JOIN files fl ON fl.id = f.file_id WHERE f.item_id = $1 AND fl.mime = 'application/pdf' ORDER BY f.ordre, f.id`, [it.id])) {
        docs.push({ key: `f:${it.id}:${x.id}`, type: 'piece', titre: x.titre || x.original_name, version: x.sha256 });
      }
    }
    return docs;
  }

  /** Points de la séance avec leurs documents ; les documents de la séance (convocation, ordre du jour, cahier) sont à part. */
  async function contenu(elu, v) {
    const s = v.row; const org = elu.organismeId;
    const items = await db.all(
      `SELECT it.*, a.titre AS acte_titre, a.numero_suivi, ru.libelle AS rubrique, trim(e.prenom || ' ' || e.nom) AS rapporteur, d.titre AS delib_titre
       FROM seance_items it LEFT JOIN actes a ON a.id = it.acte_id LEFT JOIN ref_items ru ON ru.id = a.rubrique_id LEFT JOIN elus e ON e.id = a.rapporteur_id LEFT JOIN deliberations d ON d.id = it.deliberation_id
       WHERE it.seance_id = $1 ORDER BY it.position, it.id`, [s.id]);
    const mine = new Map((await db.all('SELECT item_id, lu, favori FROM elu_points WHERE elu_id = $1', [elu.id])).map((r) => [r.item_id, r]));
    const lues = new Map((await db.all('SELECT doc_key, version FROM elu_lectures WHERE elu_id = $1 AND seance_id = $2', [elu.id, s.id])).reduce((m, r) => { (m.get(r.doc_key) || m.set(r.doc_key, new Set()).get(r.doc_key)).add(r.version); return m; }, new Map()).entries());
    const vus = new Set(); const points = [];
    for (const it of items) {
      const premiere = !!it.acte_id && !vus.has(it.acte_id); if (it.acte_id) vus.add(it.acte_id);
      const docs = await docsOfItem(org, it, premiere);
      const avis = it.acte_id ? await db.all('SELECT c.nom, ac.avis FROM acte_commissions ac JOIN commissions c ON c.id = ac.commission_id WHERE ac.acte_id = $1 AND ac.retiree_at IS NULL AND ac.avis IS NOT NULL ORDER BY c.nom', [it.acte_id]) : [];
      const m = mine.get(it.id);
      points.push({
        id: it.id, position: it.position, kind: it.kind, numero: it.numero, titre: it.kind === 'deliberation' ? (it.delib_titre || it.acte_titre) : it.titre, description: it.kind === 'libre' ? it.description : null,
        retire: it.statut === 'retire', retireMotif: it.statut === 'retire' ? it.retire_motif : null, ajouteApresArret: it.ajoute_apres_arret,
        rapporteur: it.rapporteur || null, rubrique: it.rubrique || null, avisCommissions: avis.map((x) => ({ commission: x.nom, avis: AVIS[x.avis] || x.avis })),
        lu: !!m?.lu, favori: !!m?.favori,
        documents: docs.map((d) => ({ ...d, lu: lues.get(d.key)?.has(d.version) || false, modifie: !!lues.get(d.key) && !lues.get(d.key).has(d.version) })),
      });
    }
    return points;
  }

  /** Documents propres à la séance : convocation, ordre du jour, cahier numérique (profil « élus »). */
  async function docsSeance(elu, v) {
    const s = v.row; const out = [];
    const c = await db.get(`SELECT c.version_no, c.convocation_file_id, c.odj_file_id, cf.sha256 AS csha, of2.sha256 AS osha FROM convocations c
                            LEFT JOIN files cf ON cf.id = c.convocation_file_id LEFT JOIN files of2 ON of2.id = c.odj_file_id WHERE c.seance_id = $1 AND c.statut = 'envoyee' ORDER BY c.version_no DESC LIMIT 1`, [s.id]);
    if (c?.csha) out.push({ key: `v:${s.id}`, type: 'convocation', titre: `Convocation${c.version_no > 1 ? ` (version ${c.version_no})` : ''}`, version: c.csha });
    if (c?.osha) out.push({ key: `o:${s.id}`, type: 'odj', titre: 'Ordre du jour', version: c.osha });
    const b = await db.get("SELECT b.version_no, f.sha256 FROM cahier_builds b JOIN files f ON f.id = b.file_id WHERE b.seance_id = $1 AND b.profil = 'elus' AND b.statut = 'done' ORDER BY b.version_no DESC LIMIT 1", [s.id]);
    if (b) out.push({ key: `c:${s.id}`, type: 'cahier', titre: `Cahier de séance (version ${b.version_no})`, version: b.sha256 });
    return out;
  }

  const svc = {
    stamp, nomOf,

    /** Accueil : prochaine séance, compte à rebours, documents nouveaux ou modifiés depuis la dernière lecture. */
    async accueil(elu) {
      const list = await visibles(elu);
      const now = Date.now();
      const avenir = list.filter((x) => new Date(x.row.date_seance).getTime() >= now - 6 * 3600 * 1000).sort((a, b) => new Date(a.row.date_seance) - new Date(b.row.date_seance));
      const prochaine = avenir[0] || null;
      let nouveautes = 0; let total = 0;
      if (prochaine) {
        for (const p of await contenu(elu, prochaine)) for (const d of p.documents) { total++; if (!d.lu) nouveautes++; }
        for (const d of await docsSeance(elu, prochaine)) { total++; const r = await db.get('SELECT 1 AS x FROM elu_lectures WHERE elu_id = $1 AND seance_id = $2 AND doc_key = $3 AND version = $4', [elu.id, prochaine.row.id, d.key, d.version]); if (!r) nouveautes++; }
      }
      const e = await db.get('SELECT nom, prenom, role FROM elus WHERE id = $1', [elu.id]);
      return {
        elu: { id: elu.id, nom: nomOf(e), qualite: e.role },
        prochaine: prochaine ? { id: prochaine.row.id, instance: prochaine.row.instance_nom, dateSeance: prochaine.row.date_seance, lieu: prochaine.row.lieu, statut: prochaine.row.statut, joursRestants: Math.ceil((new Date(prochaine.row.date_seance).getTime() - now) / 86400000), misADispositionLe: prochaine.madLe, documentsATelecharger: total, nonLus: nouveautes } : null,
        seances: list.map((x) => ({ id: x.row.id, instance: x.row.instance_nom, dateSeance: x.row.date_seance, lieu: x.row.lieu, statut: x.row.statut, passee: new Date(x.row.date_seance).getTime() < now - 6 * 3600 * 1000 })),
      };
    },

    async seance(elu, id) {
      const v = await seanceOf(elu, id); const s = v.row;
      const points = await contenu(elu, v); const docs = await docsSeance(elu, v);
      const cfg = await cfgOf(elu.organismeId);
      return {
        id: s.id, instance: s.instance_nom, dateSeance: s.date_seance, lieu: s.lieu, statut: s.statut, misADispositionLe: v.madLe,
        documents: docs, points, suivreLaSeance: cfg['elus.suivi_direct']?.value !== false && ['tenue'].includes(s.statut),
      };
    },

    /** Manifeste de téléchargement (arrière-plan) : dans l'ordre de lecture, avec la version de chaque document. */
    async manifeste(elu, id) {
      const v = await seanceOf(elu, id);
      const list = [];
      for (const d of await docsSeance(elu, v)) list.push({ ...d, priorite: d.type === 'cahier' ? 90 : 0 });
      let n = 0;
      for (const p of await contenu(elu, v)) for (const d of p.documents) list.push({ key: d.key, type: d.type, titre: `${p.numero ? `${p.numero} — ` : ''}${d.titre}`, version: d.version, itemId: p.id, priorite: 10 + n++ });
      return { seanceId: id, genereLe: new Date().toISOString(), documents: list.map((d) => ({ ...d, url: `/api/v1/elus/documents/${encodeURIComponent(d.key)}` })) };
    },

    /** Un document, en PDF, avec le filigrane nominatif de l'élu ; la lecture est journalisée (MAD-06). */
    async document(elu, key, { journal = true } = {}) {
      const [k, a, b] = String(key).split(':');
      let seanceId; let buffer; let name; let version; let titre;
      const org = elu.organismeId; const ctx = SYS(org);
      if (['v', 'o', 'c'].includes(k)) {
        seanceId = Number(a); const v = await seanceOf(elu, seanceId);
        const d = (await docsSeance(elu, v)).find((x) => x.key === key);
        if (!d) throw E.notFound('Document introuvable');
        version = d.version; titre = d.titre; name = `${d.type}-seance-${seanceId}.pdf`;
        if (k === 'c') { const r = await db.get("SELECT f.storage_key FROM cahier_builds b JOIN files f ON f.id = b.file_id WHERE b.seance_id = $1 AND b.profil = 'elus' AND b.statut = 'done' ORDER BY b.version_no DESC LIMIT 1", [seanceId]); buffer = await storage.get(r.storage_key); }
        else { const r = await db.get(`SELECT f.storage_key FROM convocations c JOIN files f ON f.id = ${k === 'v' ? 'c.convocation_file_id' : 'c.odj_file_id'} WHERE c.seance_id = $1 AND c.statut = 'envoyee' ORDER BY c.version_no DESC LIMIT 1`, [seanceId]); buffer = await storage.get(r.storage_key); }
      } else if (['p', 'a', 'f'].includes(k)) {
        const it = await db.get('SELECT * FROM seance_items WHERE id = $1', [Number(a)]);
        if (!it) throw E.notFound('Document introuvable');
        seanceId = it.seance_id; const v = await seanceOf(elu, seanceId);
        if (it.statut === 'retire') throw E.notFound('Ce point a été retiré de l’ordre du jour');
        const premiere = !it.acte_id || !(await db.get("SELECT 1 AS x FROM seance_items WHERE seance_id = $1 AND acte_id = $2 AND position < $3 AND statut = 'a_traiter'", [seanceId, it.acte_id, it.position]));
        const d = (await docsOfItem(org, it, premiere)).find((x) => x.key === key);
        if (!d) throw E.notFound('Document introuvable');
        version = d.version; titre = d.titre;
        if (k === 'p') {
          const r = await render.renderActe(ctx, org, it.acte_id, b === 'expose' ? { cible: 'expose', mode: 'propre' } : { cible: 'deliberation', deliberationId: it.deliberation_id, mode: 'propre' });
          buffer = r.buffer; name = `${b === 'expose' ? 'expose' : 'projet'}-${it.numero || it.id}.pdf`;
        } else {
          const f = k === 'a'
            ? await db.get('SELECT fl.storage_key, an.titre FROM annexes an JOIN files fl ON fl.id = an.file_id WHERE an.id = $1 AND an.acte_id = $2 AND an.communicable', [Number(b), it.acte_id])
            : await db.get('SELECT fl.storage_key, x.titre FROM seance_item_fichiers x JOIN files fl ON fl.id = x.file_id WHERE x.id = $1 AND x.item_id = $2', [Number(b), it.id]);
          if (!f) throw E.notFound('Document introuvable');
          buffer = await storage.get(f.storage_key); name = `${(f.titre || 'piece').replace(/[^\w-]+/g, '_')}.pdf`;
        }
        void v;
      } else throw E.notFound('Document introuvable');
      const e = await db.get('SELECT nom, prenom FROM elus WHERE id = $1', [elu.id]);
      const s = await db.get('SELECT date_seance FROM seances WHERE id = $1', [seanceId]);
      buffer = await stamp(buffer, `Document confidentiel — remis à ${nomOf(e)} — séance du ${dateFr(s.date_seance)} — ne pas diffuser`);
      if (journal) await svc.lecture(elu, seanceId, key, version, false);
      return { buffer, name, version, titre };
    },

    // ------------------------------------------------------------------------------------------------- lectures, lu, favoris
    async lecture(elu, seanceId, key, version, horsLigne = false) {
      await db.run(`INSERT INTO elu_lectures (elu_id, seance_id, doc_key, version, hors_ligne) VALUES ($1,$2,$3,$4,$5)
                    ON CONFLICT (elu_id, seance_id, doc_key, version) DO UPDATE SET derniere_le = now(), nb = elu_lectures.nb + 1, hors_ligne = elu_lectures.hors_ligne OR EXCLUDED.hors_ligne`, [elu.id, seanceId, key, version, horsLigne]);
    },
    /** Lectures faites hors ligne, transmises au retour du réseau (la date réelle de lecture est conservée). */
    async lectures(elu, seanceId, items) {
      await seanceOf(elu, seanceId);
      let n = 0;
      for (const it of items) {
        const [k, a] = String(it.key).split(':');
        const ok = ['v', 'o', 'c'].includes(k) ? Number(a) === seanceId : (await db.get('SELECT 1 AS x FROM seance_items WHERE id = $1 AND seance_id = $2', [Number(a), seanceId]));
        if (!ok) continue;
        await db.run(`INSERT INTO elu_lectures (elu_id, seance_id, doc_key, version, premiere_le, derniere_le, hors_ligne) VALUES ($1,$2,$3,$4,$5,$5,true)
                      ON CONFLICT (elu_id, seance_id, doc_key, version) DO UPDATE SET nb = elu_lectures.nb + 1, derniere_le = GREATEST(elu_lectures.derniere_le, EXCLUDED.derniere_le), hors_ligne = true`,
        [elu.id, seanceId, it.key, String(it.version).slice(0, 80), it.at ? new Date(it.at) : new Date()]); n++;
      }
      return { enregistrees: n };
    },
    async marquer(elu, itemId, patch) {
      const it = await db.get('SELECT seance_id FROM seance_items WHERE id = $1', [itemId]);
      if (!it) throw E.notFound('Point introuvable');
      await seanceOf(elu, it.seance_id);
      await db.run(`INSERT INTO elu_points (elu_id, item_id, lu, favori) VALUES ($1,$2,COALESCE($3,false),COALESCE($4,false))
                    ON CONFLICT (elu_id, item_id) DO UPDATE SET lu = COALESCE($3, elu_points.lu), favori = COALESCE($4, elu_points.favori)`, [elu.id, itemId, patch.lu ?? null, patch.favori ?? null]);
      return db.get('SELECT lu, favori FROM elu_points WHERE elu_id = $1 AND item_id = $2', [elu.id, itemId]);
    },

    // ------------------------------------------------------------------------------------------------- notes personnelles
    async notes(elu, seanceId) {
      await seanceOf(elu, seanceId);
      const rows = await db.all(
        `SELECT n.*, e.nom, e.prenom, (SELECT array_agg(p.elu_id) FROM elu_notes_partages p WHERE p.note_id = n.id) AS partages
         FROM elu_notes n JOIN elus e ON e.id = n.elu_id
         WHERE n.seance_id = $1 AND (n.elu_id = $2 OR (n.partage = 'groupe' AND n.groupe_id IS NOT NULL AND n.groupe_id = $3) OR (n.partage = 'elus' AND EXISTS (SELECT 1 FROM elu_notes_partages p WHERE p.note_id = n.id AND p.elu_id = $2)))
         ORDER BY n.item_id NULLS FIRST, n.id`, [seanceId, elu.id, elu.groupeId ?? -1]);
      return { items: rows.map((n) => ({ id: n.id, itemId: n.item_id, texte: n.texte, partage: n.partage, avec: n.partages || [], miennes: n.elu_id === elu.id, auteur: n.elu_id === elu.id ? null : nomOf(n), majLe: n.updated_at })) };
    },
    async noter(elu, seanceId, { id, itemId, texte, partage = 'prive', avec = [] }) {
      await seanceOf(elu, seanceId);
      if (itemId && !(await db.get('SELECT 1 AS x FROM seance_items WHERE id = $1 AND seance_id = $2', [itemId, seanceId]))) throw E.notFound('Point introuvable');
      if (partage === 'groupe' && !elu.groupeId) throw E.conflict("Vous n'appartenez à aucun groupe : partagez avec des élus nommés");
      if (partage === 'elus') {
        const valides = await db.all('SELECT id FROM elus WHERE organisme_id = $1 AND actif AND id = ANY($2::int[])', [elu.organismeId, avec]);
        if (!valides.length) throw E.badRequest('Indiquez au moins un élu destinataire');
        avec = valides.map((x) => x.id).filter((x) => x !== elu.id);
      }
      let note;
      if (id) {
        note = await db.get(`UPDATE elu_notes SET texte = $3, partage = $4, groupe_id = $5, updated_at = now() WHERE id = $1 AND elu_id = $2 RETURNING *`, [id, elu.id, texte, partage, partage === 'groupe' ? elu.groupeId : null]);
        if (!note) throw E.notFound('Note introuvable');
      } else note = await db.get('INSERT INTO elu_notes (elu_id, seance_id, item_id, texte, partage, groupe_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [elu.id, seanceId, itemId ?? null, texte, partage, partage === 'groupe' ? elu.groupeId : null]);
      await db.run('DELETE FROM elu_notes_partages WHERE note_id = $1', [note.id]);
      if (partage === 'elus') for (const x of avec) await db.run('INSERT INTO elu_notes_partages (note_id, elu_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [note.id, x]);
      return { id: note.id, partage, avec: partage === 'elus' ? avec : [] };
    },
    async supprimerNote(elu, id) {
      const r = await db.get('DELETE FROM elu_notes WHERE id = $1 AND elu_id = $2 RETURNING id', [id, elu.id]);
      if (!r) throw E.notFound('Note introuvable');
      return { id };
    },
    /** Collègues avec qui partager (élus de l'organisme, sans l'auteur). */
    async collegues(elu) {
      const rows = await db.all('SELECT e.id, e.nom, e.prenom, g.nom AS groupe FROM elus e LEFT JOIN groupes_politiques g ON g.id = e.groupe_id WHERE e.organisme_id = $1 AND e.actif AND e.est_elu AND e.id <> $2 ORDER BY e.nom, e.prenom', [elu.organismeId, elu.id]);
      return { items: rows.map((r) => ({ id: r.id, nom: nomOf(r), groupe: r.groupe })) };
    },

    // ------------------------------------------------------------------------------------------------- suivi en direct
    async direct(elu, seanceId, since, waitMs) {
      const v = await seanceOf(elu, seanceId);
      const cfg = await cfgOf(elu.organismeId);
      return tenue.directPublic(v.row.organisme_id, seanceId, since, waitMs, { resultats: cfg['elus.affiche_resultats']?.value !== false });
    },

    // ------------------------------------------------------------------------------------------------- côté SCC : preuve de consultation (MAD-06)
    /** Qui a consulté quoi, quand (métadonnées seulement : jamais les notes des élus). */
    async consultations(organismeId, seanceId) {
      const org = requireOrg(organismeId);
      const rows = await db.all(
        `SELECT e.id, e.nom, e.prenom, count(DISTINCT l.doc_key)::int AS documents, sum(l.nb)::int AS ouvertures, min(l.premiere_le) AS premiere, max(l.derniere_le) AS derniere, bool_or(l.hors_ligne) AS hors_ligne
         FROM elus e LEFT JOIN elu_lectures l ON l.elu_id = e.id AND l.seance_id = $2
         WHERE e.organisme_id = $1 AND e.actif AND e.est_elu GROUP BY e.id ORDER BY e.nom, e.prenom`, [org, seanceId]);
      return { items: rows.map((r) => ({ eluId: r.id, nom: nomOf(r), documentsLus: r.documents, ouvertures: r.ouvertures || 0, premiereLecture: r.premiere, derniereLecture: r.derniere, horsLigne: !!r.hors_ligne })) };
    },
  };
  void log; void audit; void cahier;
  return svc;
}

module.exports = { createEspaceElus, stamp };
