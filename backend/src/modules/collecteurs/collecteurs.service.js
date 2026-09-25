/**
 * Collecteurs d'arrêtés (COL-01).
 * Un collecteur moissonne une source :
 *  - « mail »    : une boîte mail Microsoft Graph (application) — messages non lus avec pièces jointes ;
 *  - « dossier » : un dossier de partage (UNC SMB ou disque local) — fichiers à la racine ou dans des sous-dossiers.
 * Pour chaque pièce : extraction du texte (PDF/DOCX), détection automatique de la trame, détermination de l'élu
 * destinataire et du type d'arrêté (catalogue du collecteur, sinon suggestion IA, sinon indices), puis création de
 * l'arrêté. Dès que le dossier est certain, il repart « à signer » vers le parapheur avec l'élu comme signataire ;
 * sinon il reste « en attente » et alerte l'administration (centres de notification + courriel). Chaque passage est
 * journalisé ; au retour de signature (événement « acte.signe ») l'arrêté signé est déposé dans le dossier « signé »
 * du collecteur et un courriel de retour est envoyé.
 */
const crypto = require('crypto');
const Jszip = require('jszip');
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const { createSecretBox } = require('../../shared/secretbox');
const { nextCounter, inspectPdf } = require('../../shared/infra');
const { convertirEnPdf } = require('../../shared/convert');
const { choisirPartage } = require('./partage');

const INTERVALLES = { '1h': 3600 * 1000, '4h': 4 * 3600 * 1000, '24h': 24 * 3600 * 1000 };
const EXTENSIONS = { pdf: 'pdf', docx: 'docx' };
const MAX_TEXTE = 200000;      // borne de l'analyse locale
const MAX_TEXTE_IA = 15000;    // début de document envoyé à l'IA
const TAILLE_MAX = 20 * 1024 * 1024;
const TAILLE_MAX_IA = 60 * 1024 * 1024;

let pdfjs = null;
async function lirePdf(buffer) {
  pdfjs = pdfjs || await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, verbosity: 0, isEvalSupported: false }).promise;
  try {
    let out = '';
    for (let i = 1; i <= doc.numPages && out.length < MAX_TEXTE; i++) {
      const page = await doc.getPage(i);
      out += `${(await page.getTextContent()).items.map((x) => x.str).join(' ')} `;
      page.cleanup();
    }
    return (out || '').replace(/\s+/g, ' ').trim();
  } finally { await doc.destroy(); }
}

/** Extraction du texte d'un DOCX (document.xml), écrit directement dans les mp3 — la musique n'est pas analysée. */
async function lireDocx(buffer) {
  try {
    const zip = await Jszip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml')?.async('string');
    if (!xml) return '';
    return xml
      .replace(/<w:p[ >]/gi, '\n').replace(/<w:tab[ /]/gi, '\t')
      .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#160;|&nbsp;/g, ' ')
      .replace(/\s+/g, ' ').trim();
  } catch { return ''; }
}

const texteDu = (buffer, ext) => (ext === 'docx' ? lireDocx(buffer) : lirePdf(buffer));

// ------------------------------------------------------------------------------------------------------------- petites aides
const sansAccent = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const nettoyerNom = (s) => sansAccent(s).replace(/[^a-z0-9 -]/g, '').replace(/ {2,}/g, ' ').trim();
const parseJson = (texte) => {
  const s = String(texte || ''); const begin = s.indexOf('{'); const end = s.lastIndexOf('}');
  if (begin === -1 || end <= begin) return null;
  try { return JSON.parse(s.slice(begin, end + 1)); } catch { return null; }
};

/** « RÉPUBLIQUE FRANÇAISE », le nom de la collectivité et une numérotation d'acte → la trame est déjà portée par le document. */
function tramePresente(texte, nomCollectivite) {
  const debut = String(texte || '').slice(0, 500);
  const marque = nomCollectivite ? nettoyerNom(nomCollectivite) : '';
  const a = marque && nettoyerNom(debut).includes(marque);
  const b = /R[EÉ]?PUBLIQUE[^A-Z]{0,12}FRAN[^A-Z]{0,12}AISE/i.test(debut);
  const c = /n[°o]\s*\d{2,}|ARR[EÉ]?T[^A-Z]{0,20}N[°o]/i.test(texte);
  return Boolean((a && c) || b);
}

/** Un élu correspond à un indice (sous-dossier, nom, adresse) — insensible aux accents, à la casse et aux espaces. */
function eluCorrespond(elu, indice) {
  const cle = nettoyerNom(indice);
  if (!cle) return false;
  return [elu.nomComplet, `${elu.prenom} ${elu.nom}`, elu.email, elu.prenom, elu.nom].filter(Boolean).some((x) => x !== undefined && nettoyerNom(x) === cle);
}

function createCollecteurs({ db, audit, settings, config, log, mail, ai, prompts, refs, storage, elus, parapheur, render, o365 }) {
  const box = createSecretBox(config.jwt?.secret || '', 'collecteurs');
  const chiffre = (s) => box.chiffre(s);
  const dechiffre = (s) => box.dechiffre(s);

  const SELECT = `SELECT c.*, t.nom AS type_arrete_nom, e.nom AS elu_nom
                  FROM collecteurs c
                  LEFT JOIN collecteur_types_arretes t ON t.id = c.type_arrete_id
                  LEFT JOIN elus e ON e.id = c.elu_id`;

  // ------------------------------------------------------------------------------------------------------------- vues
  const toType = (r) => r && ({ id: r.id, nom: r.nom, actif: r.actif });
  const toCollecteur = (r) => {
    if (!r) return null;
    const c = r.config || {};
    const base = {
      id: r.id, nom: r.nom, type: r.type, actif: r.actif, intervalle: r.intervalle,
      typeArreteId: r.type_arrete_id, typeArreteNom: r.type_arrete_nom ?? null,
      eluId: r.elu_id, eluNom: r.elu_nom ?? null,
      emailRetour: r.email_retour || null,
      dernierPassage: r.dernier_passage ?? null, prochainPassage: r.prochain_passage ?? null,
      dernierResultat: r.dernier_resultat ?? null, createdBy: r.created_by, createdAt: r.created_at,
      motDePasseConfigure: !!c.motDePasse,
    };
    if (r.type === 'mail') {
      return { ...base, mailbox: c.graphMailbox || '', dossierSignes: c.dossierSignes || null, retraitMail: c.retraitMail !== false, essai: !!c.essai };
    }
    return { ...base, cible: c.cible || '', utilisateur: c.utilisateur || '', sousDossiers: c.sousDossiers === 'elus' ? 'elus' : 'gauche', mouvement: c.mouvement === 'supprimer' ? 'supprimer' : 'deplacer', dossierSignes: c.dossierSignes || 'signe', essai: !!c.essai };
  };
  const secretsOf = (r) => {
    const c = r.config || {}; const o = {};
    if (c.motDePasse) o.motDePasse = dechiffre(c.motDePasse);
    return o;
  };

  // --------------------------------------------------------------------------------------------------------- sources
  async function sourcePartage(collecteur) {
    const c = collecteur.config || {};
    const { motDePasse } = secretsOf(collecteur);
    return choisirPartage({ cible: c.cible, utilisateur: c.utilisateur || null, motDePasse });
  }
  /** La boîte est lue par l'API de la Ville (Graph côté APM) : seuls le nom de la boîte (facultatif) et rien d'autre. */
  async function sourceMail(collecteur) {
    if (!o365) throw E.conflict("L’accès aux boîtes mail n’est pas configuré : renseignez l’API de la Ville (APM).");
    const c = collecteur.config || {};
    return { adapter: o365, mailbox: (c.graphMailbox || '').trim() || null };
  }

  // -------------------------------------------------------------------------------------------------------- référentiels
  async function typeArreteRef(org) {
    const r = await refs.byCode('type_acte', 'arrete', org).catch(() => null);
    if (r) return r;
    const d = await db.get("SELECT id, meta FROM ref_items WHERE code = 'arrete' AND organisme_id = $1", [org]);
    return d ? { id: d.id, meta: d.meta } : null;
  }

  // ---------------------------------------------------------------------------------------------------------- analyse IA
  /** Analyse d'une pièce par l'IA : la consigne est éditable dans Paramétrages / Assistant IA (code « collecteurs »). */
  async function analyseIa(org, collecteur, { texte, nom, origine }) {
    if (!prompts || !ai) return null;
    if (!(await prompts.actif(org, 'collecteurs').catch(() => false))) return null;
    const typesArrête = await db.all('SELECT nom FROM collecteur_types_arretes WHERE organisme_id = $1 AND actif ORDER BY nom', [org]);
    const elusLocaux = (await elus.list(org, { actif: true })).map((e) => `${e.nomComplet}${e.email ? ` <${e.email}>` : ''}`).slice(0, 80);
    const { system, modele } = await prompts.resolve(org, 'collecteurs');
    const prompt = [
      collecteur.type === 'mail' ? `Source : courriel de ${origine || '?'} reçu le ${new Date().toLocaleDateString('fr-FR')}.` : `Source : dossier « ${origine || 'racine'} ».`,
      `Fichier : ${nom}`,
      typesArrête.length ? `Types d'arrêté existants : ${typesArrête.map((t) => `« ${t.nom} »`).join(', ')}.` : 'Aucun type d’arrêté dans le catalogue : « type » sera null.',
      elusLocaux.length ? `Élus disponibles : ${elusLocaux.join(' ; ')}.` : 'Aucun élu.',
      '',
      `Début du document :\n${String(texte || '').slice(0, MAX_TEXTE_IA)}`,
    ].join('\n');
    const r = await ai.query({ system, prompt, maxTokens: 800, temperature: 0.1, model: modele }).catch((e) => {
      log?.warn?.({ collecteur: collecteur.id, err: e.message }, 'analyse IA d’un arrêté collecté impossible');
      return null;
    });
    return r?.text ? parseJson(r.text) : null;
  }

  // --------------------------------------------------------------------------------------------------- création de fichier
  const copieFichier = async (buffer, org, originalName, ext, createdBy) => {
    const nom = String(originalName || `acte.${ext}`).slice(0, 200);
    const put = await storage.put(buffer, { organismeId: org, ext, categorie: 'annexes', nom, titre: nom.replace(/\.[^.]+$/, ''), description: "Collecteur d'arrêtés", auteur: createdBy });
    return db.get(
      `INSERT INTO files (organisme_id, storage_key, original_name, mime, size, sha256, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [org, put.key, nom, ext === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', put.size, put.sha256, createdBy]);
  };

  // ------------------------------------------------------------------------------------------------------ création acte
  async function creerActe(org, collecteur, { origine, nom, buffer, ext, elu, typeNom, objet, trame, ok, ia, sha }) {
    const arreteRef = await typeArreteRef(org);
    const cfg = await settings.resolve(org);
    // Direction porteuse : celle de l'organisme, sinon la première de l'organigramme, sinon un code dédié.
    let directionCode = cfg['organisation.direction_generale']?.value || null;
    let directionLabel = null;
    if (directionCode) {
      directionLabel = (await db.get("SELECT label FROM organisation_entites WHERE organisme_id = $1 AND type = 'direction' AND code = $2", [org, directionCode]).catch(() => null))?.label || directionCode;
    } else {
      const d = await db.get("SELECT code, label FROM organisation_entites WHERE organisme_id = $1 AND type = 'direction' ORDER BY ordre, id LIMIT 1", [org]).catch(() => null);
      directionCode = d?.code || 'COLLECTEUR';
      directionLabel = d?.label || 'Arrêtés collectés';
    }
    const natureId = arreteRef?.meta?.natureCode ? (await refs.byCode('nature', arreteRef.meta.natureCode, org).catch(() => null))?.id ?? null : null;
    const trameFinale = trame === 'presente' ? 'presente' : 'a_ajouter';
    const titre = String(objet || nom.replace(/\.[a-z0-9]+$/i, '')).trim().slice(0, 250) || 'Arrêté (collecteur)';
    const posDefault = { page: 1, x: 75, y: 85, w: 150, h: 60 };
    const custom = {
      collecteur: {
        collecteurId: collecteur.id, collecteurNom: collecteur.nom, origine: origine || null, fichier: nom,
        eluId: elu?.id ?? null, eluNom: elu?.nomComplet ?? null,
        typeNom: typeNom || null, ia: ia || null, revue: !ok, sha256: sha, creerLe: new Date().toISOString(),
      },
    };

    const r = await db.tx(async (q) => {
      const maxSuivi = (await q.get('SELECT COALESCE(max(numero_suivi), 0)::int AS m FROM actes WHERE organisme_id = $1', [org])).m;
      const numero = await nextCounter(q, org, 'acte', { plancher: maxSuivi });
      custom.collecteur.numeroSuivi = numero;
      const a = await q.get(
        `INSERT INTO actes (organisme_id, numero_suivi, type_id, titre, redacteur, direction_code, direction_label, service_code, service_label,
           nature_id, incidence_financiere, urgence, confidentialite, commentaire_initial, custom, statut, document_source_trame, signature_position, source_collecteur)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,NULL,$8,$9,FALSE,'normale',$10,$11::jsonb,$12,$13,$14::jsonb,TRUE) RETURNING *`,
        [org, numero, arreteRef.id, titre, collecteur.created_by || '@collecteur', directionCode, directionLabel, natureId,
          false, `Collecté le ${new Date().toLocaleString('fr-FR')} par le collecteur « ${collecteur.nom} ».`, JSON.stringify(custom),
          ok ? 'a_signer' : 'brouillon', trameFinale, JSON.stringify(posDefault)]);
      await q.run('INSERT INTO deliberations (acte_id, ordre, titre) VALUES ($1, 1, $2)', [a.id, titre]);
      return a;
    });

    // document source : l'original (PDF/DOCX), puis le PDF de consultation (Word converti, trame posée si besoin).
    const src = await copieFichier(buffer, org, nom, ext, '@collecteur');
    let pdfBuffer = ext === 'docx' ? await convertirEnPdf(buffer, 'docx') : buffer;
    if (!pdfBuffer) throw E.incomplete('Conversion Word → PDF indisponible sur le serveur (LibreOffice absent)');
    let pdfFileId = src.id;
    if (ext === 'docx' || trameFinale === 'a_ajouter') {
      if (trameFinale === 'a_ajouter') pdfBuffer = await render.apposerTrame(org, pdfBuffer, r, 'arrete');
      const { pages } = await inspectPdf(pdfBuffer);
      const pf = await copieFichier(pdfBuffer, org, nom.replace(/\.[a-z0-9]+$/i, '') + '.pdf', 'pdf', '@collecteur');
      await db.run('UPDATE files SET pages = $2 WHERE id = $1', [pf.id, pages]);
      pdfFileId = pf.id;
    }
    await db.run('UPDATE actes SET document_source_file_id = $2, document_source_pdf_file_id = $3 WHERE id = $1', [r.id, src.id, pdfFileId]);
    await audit.log(null, { organismeId: org, action: 'acte.collecte', entity: 'actes', entityId: r.id, after: { collecteur: collecteur.nom, origine, fichier: nom, elu: elu?.email ?? null, type: typeNom || null, statut: ok ? 'a_signer' : 'brouillon', trame: trameFinale } });
    return { ...r, document_source_file_id: src.id, document_source_pdf_file_id: pdfFileId };
  }

  /** Alerte les administrations (scc, org_admin) : centre de notifications + courriel (collecteur et cadres). */
  async function alerter(org, acte, collecteur, motifs) {
    let admins = await db.all("SELECT r.username, u.email FROM user_org_roles r LEFT JOIN agent_ref u ON u.username = r.username WHERE r.organisme_id = $1 AND r.role IN ('org_admin','scc')", [org]);
    admins = admins.filter((x, i, a) => a.findIndex((y) => y.username === x.username) === i);
    const titre = `Arrêté collecté à revoir — ${acte.titre}`;
    const corps = `Le collecteur « ${collecteur.nom} » a créé l’arrêté n° ${acte.numero_suivi} « ${acte.titre} » mais ${motifs}. Ouvrez le dossier #${acte.numero_suivi} pour compléter, puis lancez l’envoi en signature.`;
    const lien = `/dossiers/${acte.id}`;
    const html = `<p>${corps.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
    const vus = new Set();
    for (const u of admins) {
      if (vus.has(u.username)) continue; vus.add(u.username);
      await db.run("INSERT INTO notifications (organisme_id, username, family, rule_code, acte_id, title, body, link) VALUES ($1,$2,'collecteur','collecteur.attente',$3,$4,$5,$6)",
        [org, u.username, acte.id, titre, corps, lien]).catch(() => null);
      if (u.email) await mail.send({ to: u.email, subject: `[Arrêté] ${titre}`, html }).catch((e) => log?.warn?.({ e: e.message }, 'courriel d’alerte non envoyé'));
    }
    if (collecteur.email_retour) await mail.send({ to: collecteur.email_retour, subject: `[Arrêté] ${titre}`, html }).catch(() => null);
  }

  // ------------------------------------------------------------------------------------------------------- pipeline fichier
  /** Écrit une ligne au journal des collectes (une par pièce, quel que soit le résultat — y compris les erreurs). */
  async function journaliser(collecteur, { origine, nom, statut, acteId = null, eluId = null, detail = {}, erreur = null }) {
    await db.run(
      `INSERT INTO collectes (collecteur_id, at, origine, nom_fichier, statut, acte_id, elu_id, detail, erreur, traite_at)
       VALUES ($1, now(), $2, $3, $4, $5, $6, $7::jsonb, $8, now())`,
      [collecteur.id, origine || null, nom, statut, acteId, eluId, JSON.stringify(detail), erreur ? String(erreur).slice(0, 1000) : null]);
  }

  /** Traite une pièce : analyse → création de l'arrêté → signature immédiate ou attente (alerte). Retourne un statut. */
  async function traiterFichier(org, collecteur, { origine, nom, buffer }) {
    const ext = EXTENSIONS[(String(nom).split('.').pop() || '').toLowerCase()];
    if (!ext) {
      const erreur = `Extension non prise en charge : ${nom}`;
      await journaliser(collecteur, { origine, nom, statut: 'erreur', erreur });
      return { statut: 'erreur', erreur };
    }
    if (buffer.length > TAILLE_MAX) {
      const erreur = `Fichier trop volumineux (> ${TAILLE_MAX / 1048576} Mo) : ${nom}`;
      await journaliser(collecteur, { origine, nom, statut: 'erreur', erreur });
      return { statut: 'erreur', erreur };
    }
    try {
      return await traiterContenu(org, collecteur, { origine, nom, buffer, ext });
    } catch (e) {
      log?.warn?.({ collecteur: collecteur.id, fichier: nom, err: e.message }, 'traitement d’une pièce collectée en erreur');
      await journaliser(collecteur, { origine, nom, statut: 'erreur', erreur: e.message });
      return { statut: 'erreur', erreur: e.message };
    }
  }

  async function traiterContenu(org, collecteur, { origine, nom, buffer, ext }) {
    const sha = crypto.createHash('sha256').update(buffer).digest('hex');

    // doublon : même pièce déjà collectée par ce collecteur (30 jours glissants).
    const dup = await db.get(`SELECT c.acte_id, a.titre, a.numero_suivi
      FROM collectes c JOIN actes a ON a.id = c.acte_id
      WHERE c.collecteur_id = $1 AND (c.detail->>'sha256') = $2 AND c.statut IN ('traite','attente') AND c.at > now() - interval '30 days' LIMIT 1`, [collecteur.id, sha]);
    if (dup) {
      const detail = { sha256: sha, acteId: dup.acte_id, numeroSuivi: dup.numero_suivi, titre: dup.titre };
      await journaliser(collecteur, { origine, nom, statut: 'doublon', acteId: dup.acte_id, detail });
      return { statut: 'doublon', doublon: { acteId: dup.acte_id, titre: dup.titre }, detail };
    }

    let texte = '';
    if (buffer.length <= TAILLE_MAX_IA) texte = await texteDu(buffer, ext).catch(() => '');

    // — destinataire (élu) : indice du sous-dossier → suggestion IA → paramètre du collecteur.
    let elu = null;
    if (origine && collecteur.sousDossiers === 'elus') elu = (await elus.list(org, { actif: true })).find((e) => eluCorrespond(e, origine)) || null;

    // — type d'arrêté : catalogue fixé par le collecteur d'abord.
    let typeNom = collecteur.type_arrete_nom || null;

    // — analyse IA (propositions seulement : élu, type, objet, trame) — bridée sur les très gros fichiers.
    let ia = null;
    if (texte && buffer.length <= TAILLE_MAX_IA) ia = await analyseIa(org, collecteur, { texte, nom, origine });
    if (ia) {
      const elusLocaux = await elus.list(org, { actif: true });
      if (!elu && ia.email) elu = elusLocaux.find((e) => e.email && ia.email && e.email.toLowerCase() === String(ia.email).toLowerCase()) || null;
      if (!elu && ia.destinataire) elu = elusLocaux.find((e) => eluCorrespond(e, ia.destinataire)) || null;
      if (ia.type && !typeNom) {
        const t = (await db.all('SELECT id, nom FROM collecteur_types_arretes WHERE organisme_id = $1 AND actif', [org])).find((x) => nettoyerNom(x.nom) === nettoyerNom(ia.type));
        if (t) typeNom = t.nom;
      }
    }

    const incertains = [];
    if (elu) { /* destinataire connu */ }
    else if (collecteur.elu_id) { const e = await elus.get(org, collecteur.elu_id).catch(() => null); if (e) elu = e; else incertains.push('l’élu paramétré est introuvable'); }
    else incertains.push('l’élu destinataire est inconnu (ni IA' + (origine ? ', ni sous-dossier' : '') + ')');
    if (!typeNom) incertains.push('le type d’arrêté est vide (catalogue du collecteur non renseigné)');

    const orgRow = await db.get('SELECT nom FROM organismes WHERE id = $1', [org]);
    const objet = ia?.objet || String(nom).replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim() || 'Arrêté (collecteur)';
    const trame = (ia?.trame === 'presente' ? 'presente' : (tramePresente(texte, orgRow?.nom) ? 'presente' : 'a_ajouter'));
    const ok = !incertains.length;

    const acte = await creerActe(org, collecteur, { origine, nom, buffer, ext, elu, typeNom, objet, trame, ok, ia, sha });
    const detail = {
      sha256: sha, origine, statutAvant: 'recu',
      analyse: ia ? { objet: ia.objet, destinataire: ia.destinataire, email: ia.email, type: ia.type, trame: ia.trame, confiance: ia.confiance, remarque: ia.remarque } : null,
      incertains, envoye: false,
    };

    let statut = 'traite';
    if (ok) {
      const signataire = { nom: elu.nomComplet, email: elu.email, qualite: 'arrêté (collecteur)' };
      try {
        await parapheur.demanderEnvoi(null, org, acte.id, { auto: true, signataire });
        detail.envoye = true;
      } catch (e) {
        statut = 'attente';
        detail.envoyeErreur = e.message;
        await alerter(org, acte, collecteur, [`l’envoi en signature pour ${elu.nomComplet} a échoué : ${e.message}`]);
      }
    } else {
      statut = 'attente';
      await alerter(org, acte, collecteur, incertains.join(' ; '));
    }

    await journaliser(collecteur, { origine, nom, statut, acteId: acte.id, eluId: elu?.id ?? null, detail });
    return { statut, nom, acteId: acte.id };
  }

  // -------------------------------------------------------------------------------------------------------- collecter
  async function collecter(collecteur) {
    // on repart de la ligne complète (avec le type d'arrêté et l'élu joints) : les appelants peuvent passer la ligne brute.
    collecteur = (await db.get(`${SELECT} WHERE c.id = $1`, [collecteur.id])) || collecteur;
    const org = requireOrg(collecteur.organisme_id);
    const rapport = { traites: 0, attentes: 0, erreurs: 0, doublons: 0, ignore: 0, messages: [] };
    try {
      if (collecteur.type === 'mail') {
        const { adapter, mailbox } = await sourceMail(collecteur);
        const messages = await adapter.lister(mailbox);
        for (const m of messages) {
          let toutesOk = true; let traite = false;
          for (const p of m.pieces) {
            let buffer;
            try { buffer = await adapter.telecharger(mailbox, m.id, p.id); }
            catch (e) { toutesOk = false; rapport.erreurs++; rapport.messages.push({ fichier: p.nom, erreur: e.message }); await journaliser(collecteur, { origine: String(m.de || 'mail').split('@')[0], nom: p.nom, statut: 'erreur', erreur: `Pièce jointe illisible : ${e.message}` }); continue; }
            const r = await traiterFichier(org, collecteur, { origine: String(m.de || 'mail').split('@')[0], nom: p.nom, buffer });
            if (r.statut === 'traite') { rapport.traites++; traite = true; }
            else if (r.statut === 'attente') { rapport.attentes++; toutesOk = false; }
            else if (r.statut === 'doublon') { rapport.doublons++; toutesOk = false; }
            else { rapport.erreurs++; toutesOk = false; }
            if (r.erreur) rapport.messages.push({ fichier: p.nom, erreur: r.erreur });
          }
          // on retire le message seulement si toutes ses pièces ont été traitées (boîte propre, rien de perdu).
          if (toutesOk && traite && collecteur.config?.retraitMail !== false) {
            await adapter.confirmer(mailbox, m.id).catch(() => null);
            await adapter.supprimer(mailbox, m.id).catch(() => null);
          }
        }
      } else {
        const p = await sourcePartage(collecteur);
        const souss = collecteur.config?.sousDossiers === 'elus' ? await p.listerSousDossiers() : [''];
        for (const sous of souss) {
          for (const f of await p.listerFichiers(sous)) {
            if (f.nom.startsWith('.')) continue;
            let buffer;
            try { buffer = await p.lire(sous, f.nom); } catch (e) { rapport.erreurs++; rapport.messages.push({ fichier: f.nom, erreur: e.message }); await journaliser(collecteur, { origine: sous || 'racine', nom: f.nom, statut: 'erreur', erreur: `Lecture impossible : ${e.message}` }); continue; }
            const r = await traiterFichier(org, collecteur, { origine: sous || 'racine', nom: f.nom, buffer });
            if (r.statut === 'traite') rapport.traites++;
            else if (r.statut === 'attente') { rapport.attentes++; continue; } // on laisse la pièce sur place pour revue
            else if (r.statut === 'doublon') rapport.doublons++;
            else rapport.erreurs++;
            if (r.erreur) rapport.messages.push({ fichier: f.nom, erreur: r.erreur });
            // déplacement des pièces (traitées, en erreur ou doublons) vers _traites/<date> — tout sauf les attentes.
            try {
              if (collecteur.config?.mouvement === 'supprimer') await p.supprimer(sous, f.nom);
              else await p.deplace(sous, f.nom, `_traites/${new Date().toISOString().slice(0, 10)}/${sous || 'racine'}`);
            } catch (e) { rapport.messages.push({ fichier: f.nom, deplacement: e.message }); }
          }
        }
      }
      return rapport;
    } catch (e) {
      // panne de la source (partage injoignable, boîte/API ville indisponible…) : on la conserve pour l'administration.
      rapport.erreur = e.message;
      throw e;
    } finally {
      const inter = INTERVALLES[collecteur.intervalle] || INTERVALLES['24h'];
      await db.run('UPDATE collecteurs SET dernier_passage = now(), prochain_passage = now() + ($2 * interval \'1 millisecond\'), dernier_resultat = $3::jsonb WHERE id = $1',
        [collecteur.id, inter, JSON.stringify({ at: new Date().toISOString(), ...rapport })]);
    }
  }

  // ------------------------------------------------------------------------------------------------------- API publique
  const svc = {
    EXTENSIONS, INTERVALLES,

    // ---- catalogue des types d'arrêté --------------------------------------------------------------
    async types(org) { return (await db.all('SELECT * FROM collecteur_types_arretes WHERE organisme_id = $1 ORDER BY nom', [requireOrg(org)])).map(toType); },
    async ajouterType(ctx, org, nom) {
      const o = requireOrg(org); const n = String(nom || '').trim();
      if (n.length < 3) throw E.badRequest('Nom de type trop court');
      try {
        const r = await db.get('INSERT INTO collecteur_types_arretes (organisme_id, nom) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING *', [o, n]);
        if (!r) throw E.conflict('Ce type d’arrêté existe déjà');
        await audit.log(ctx, { organismeId: o, action: 'collecteur.type_arrete', entity: 'collecteur_types_arretes', entityId: r.id, after: toType(r) });
        return toType(r);
      } catch (e) { if (e.code === '23505') throw E.conflict('Ce type d’arrêté existe déjà'); throw e; }
    },
    async retirerType(ctx, org, id) {
      const o = requireOrg(org);
      const r = await db.get("DELETE FROM collecteur_types_arretes cta WHERE cta.id = $1 AND cta.organisme_id = $2 AND NOT EXISTS (SELECT 1 FROM collecteurs c WHERE c.type_arrete_id = cta.id) RETURNING cta.id", [id, o]).catch(() => null);
      if (!r) throw E.conflict('Type d’arrêté utilisé par un collecteur ou introuvable');
      await audit.log(ctx, { organismeId: o, action: 'collecteur.type_arrete_retire', entity: 'collecteur_types_arretes', entityId: id });
      return { ok: true };
    },

    // ---- collecteurs ----------------------------------------------------------------------------------
    async list(ctx, org) { return (await db.all(`${SELECT} WHERE c.organisme_id = $1 ORDER BY c.nom`, [requireOrg(org)])).map(toCollecteur); },
    async get(ctx, org, id) { return toCollecteur(await db.get(`${SELECT} WHERE c.organisme_id = $1 AND c.id = $2`, [requireOrg(org), id])); },

    async creer(ctx, org, b) {
      const o = requireOrg(org);
      if (!['mail', 'dossier'].includes(b.type)) throw E.badRequest('type attendu : mail ou dossier');
      const nom = String(b.nom || '').trim();
      if (nom.length < 2) throw E.badRequest('Nom du collecteur trop court');
      if (b.type === 'dossier' && !String(b.config?.cible || '').trim()) throw E.badRequest('Indiquez le dossier source (chemin local ou UNC)');
      const cfg = { ...(b.config || {}) };
      if (cfg.motDePasse) cfg.motDePasse = chiffre(cfg.motDePasse);
      const r = await db.get(
        `INSERT INTO collecteurs (organisme_id, nom, type, actif, intervalle, type_arrete_id, elu_id, email_retour, config, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING *`,
        [o, nom, b.type, b.actif !== false, b.intervalle || '24h', b.typeArreteId ?? null, b.eluId ?? null, b.emailRetour || null, JSON.stringify(cfg), ctx.username]);
      await audit.log(ctx, { organismeId: o, action: 'collecteur.create', entity: 'collecteurs', entityId: r.id, after: { nom: r.nom, type: r.type } });
      return toCollecteur(await db.get(`${SELECT} WHERE c.id = $1`, [r.id]));
    },

    async maj(ctx, org, id, b) {
      const o = requireOrg(org);
      const cur = await db.get('SELECT * FROM collecteurs WHERE id = $1 AND organisme_id = $2', [id, o]);
      if (!cur) throw E.notFound('Collecteur introuvable');
      const cfg = { ...(cur.config || {}), ...(b.config || {}) };
      if (b.config?.motDePasse) cfg.motDePasse = chiffre(b.config.motDePasse);
      const set = ['updated_at = now()']; const params = [o, id];
      const put = (col, v) => { params.push(v); set.push(`${col} = $${params.length}`); };
      if (b.nom !== undefined) put('nom', String(b.nom).trim());
      if (b.actif !== undefined) put('actif', !!b.actif);
      if (b.intervalle !== undefined) put('intervalle', b.intervalle);
      if (b.typeArreteId !== undefined) put('type_arrete_id', b.typeArreteId || null);
      if (b.eluId !== undefined) put('elu_id', b.eluId || null);
      if (b.emailRetour !== undefined) put('email_retour', b.emailRetour || null);
      if (b.config) put('config', JSON.stringify(cfg));
      if (set.length > 1) await db.run(`UPDATE collecteurs SET ${set.join(', ')} WHERE id = $1 AND organisme_id = $2`, params);
      return toCollecteur(await db.get(`${SELECT} WHERE c.id = $1`, [id]));
    },

    async supprimer(ctx, org, id) {
      const o = requireOrg(org);
      const r = await db.get('DELETE FROM collecteurs WHERE id = $1 AND organisme_id = $2 AND NOT EXISTS (SELECT 1 FROM collectes cl WHERE cl.collecteur_id = collecteurs.id) RETURNING id, nom', [id, o]).catch(() => null);
      if (!r) throw E.conflict('Collecteur introuvable ou ayant déjà collecté des arrêtés (désactivez-le plutôt)');
      await audit.log(ctx, { organismeId: o, action: 'collecteur.delete', entity: 'collecteurs', entityId: id, after: r });
      return { ok: true };
    },

    /** Vérifie la source (partage accessible / boîte joignable) sans rien moissonner. */
    async tester(ctx, org, id) {
      const c = await db.get('SELECT * FROM collecteurs WHERE id = $1 AND organisme_id = $2', [id, requireOrg(org)]);
      if (!c) throw E.notFound('Collecteur introuvable');
      if (c.type === 'mail') { const { adapter, mailbox } = await sourceMail(c); await adapter.tester(mailbox); return { ok: true, message: `Boîte joignable via l’API de la Ville${mailbox ? ` (${mailbox})` : ''}` }; }
      const p = await sourcePartage(c);
      return p.tester();
    },

    /** Moissonne un collecteur à la demande (bouton). Surveillance anti-parrallèle par source/collecteur. */
    async collecterMaintenant(ctx, org, id) {
      const c = await db.get('SELECT * FROM collecteurs WHERE id = $1 AND organisme_id = $2', [id, requireOrg(org)]);
      if (!c) throw E.notFound('Collecteur introuvable');
      if (!c.actif) throw E.conflict('Collecteur désactivé : activez-le avant de lancer une collecte');
      const r = await collecter(c);
      return { ...r, collecteur: toCollecteur(await db.get(`${SELECT} WHERE c.id = $1`, [id])) };
    },

    /** Entrée planificateur (par organisme) : collecte les sources échues. Retourne le nombre de collecte lancées. */
    async runDt(orgId) {
      const due = await db.all(`SELECT * FROM collecteurs WHERE organisme_id = $1 AND actif AND (prochain_passage IS NULL OR prochain_passage <= now())`, [requireOrg(orgId)]);
      for (const c of due) {
        try { await collecter(c); }
        catch (e) { log?.warn?.({ collecteur: c.id, err: e.message }, 'collecte planifiée en erreur'); }
      }
      return due.length;
    },

    async collectes(ctx, org, collecteurId, { limite = 50 } = {}) {
      return db.all(`SELECT cl.*, a.titre AS acte_titre, a.numero_suivi AS acte_numero, e.nom AS elu_nom
        FROM collectes cl LEFT JOIN actes a ON a.id = cl.acte_id LEFT JOIN elus e ON e.id = cl.elu_id
        WHERE cl.collecteur_id = $1 ORDER BY cl.at DESC LIMIT $2`, [collecteurId, Math.min(Number(limite) || 50, 200)]);
    },

    /** Retour de signature (bus « acte.signe ») : dépôt « signé » + courriel de retour, si le collecteur en est équipé. */
    async retourSigne(org, acteId) {
      const a = await db.get('SELECT custom, titre, numero_suivi FROM actes WHERE id = $1 AND organisme_id = $2', [acteId, org]);
      const cc = a?.custom?.collecteur;
      if (!cc?.collecteurId) return null;
      const c = await db.get('SELECT * FROM collecteurs WHERE id = $1 AND organisme_id = $2', [cc.collecteurId, org]);
      if (!c) return null;
      const envoi = await db.get('SELECT document_signe_file_id FROM parapheur_envois WHERE acte_id = $1 ORDER BY id DESC LIMIT 1', [acteId]);
      const nomF = cc.fichier || `arretes-${a.numero_suivi}.pdf`;
      const attachement = envoi?.document_signe_file_id
        ? (await db.get('SELECT storage_key FROM files WHERE id = $1', [envoi.document_signe_file_id]).catch(() => null))?.storage_key
        : null;
      if (c.type === 'dossier') {
        try {
          if (attachement) {
            const p = await sourcePartage(c);
            await p.ecrire(c.config?.dossierSignes || 'signe', nomF, await storage.get(attachement));
          }
        } catch (e) { log?.warn?.({ e: e.message, acteId }, 'dépôt de l’arrêté signé dans le dossier « signé » impossible'); }
      }
      if (c.email_retour) {
        await mail.send({ to: c.email_retour, subject: `Arrêté signé — ${a.titre}`, html: `<p>L’arrêté « ${a.titre} » (n° ${a.numero_suivi}) a été signé à l’issue de votre demande.</p>`, ...(attachement ? { attachments: [{ filename: nomF, content: (await storage.get(attachement)).toString('base64') }] } : {}) }).catch((e) => log?.warn?.({ e: e.message, acteId }, 'courriel de retour non envoyé'));
      }
      await audit.log(null, { organismeId: org, action: 'acte.retour_signe', entity: 'actes', entityId: acteId, after: { collecteur: c.nom, dossierSignes: c.type === 'dossier' ? c.config?.dossierSignes || 'signe' : null, emailRetour: !!c.email_retour } });
      return { ok: true };
    },
  };

  return svc;
}
module.exports = { createCollecteurs };