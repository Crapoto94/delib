/**
 * Adaptateur TeletransmissionPort — SIMULATEUR S²LOW (TLT-19, D20, D82).
 * Reproduit, d'après la spécification v5.1 (module ACTES), ce que répond S²LOW : validations de la création (`KO` + message),
 * statuts 17 → 1 → 2 → 3 → 4 (acquittement, ARActe), refus (6), erreur (-1), annulation (0), documents de la préfecture (courrier 2,
 * demande de pièces 3, lettre d'observation 4, déféré 5), réponse à la préfecture, bordereau d'acquittement et acte tamponné.
 * L'état du « serveur distant » vit dans les tables `s2low_sim_*` : il survit aux redémarrages et n'est jamais lu par le reste de l'outil.
 * Le déroulement est piloté à la main (`avancer`) : chaque appel fait franchir une étape à la transaction selon son SCÉNARIO.
 *
 * Contrat du port : testConnexion, classification, creer, confirmer, statut, documentsPrefecture, marquerLu, repondre, annuler,
 * bordereau, tampon ; en plus, propres à la simulation : avancer, etat, SCENARIOS.
 */
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const STATUS = { '-1': 'Erreur', 0: 'Annulé', 1: 'Posté', 2: 'En attente de transmission', 3: 'Transmis', 4: 'Acquittement reçu', 5: 'Validé', 6: 'Refusé', 17: "En attente d'être postée" };
const DOC_TYPE = { 2: 'Courrier simple', 3: 'Demande de pièces complémentaires', 4: "Lettre d'observations", 5: 'Déféré au tribunal administratif' };
const NATURES = [[1, 'Délibérations'], [2, 'Actes réglementaires'], [3, 'Actes individuels'], [4, 'Contrats, conventions et avenants'], [5, 'Documents budgétaires et financiers'], [6, 'Autres']];
const TYPES_PJ = [['99_DE', 'Délibération'], ['99_AU', 'Autre document'], ['22_AN', 'Annexe'], ['99_CO', 'Convention'], ['99_PL', 'Plan']];

/** Étape par étape : `status` (nouveau statut), `ar` (génère l'ARActe), `doc` (document de la préfecture), `bloque` (attend une réponse). */
const SCENARIOS = {
  nominal: { label: 'Nominal : transmis puis acquitté par la préfecture', steps: [{ status: 2 }, { status: 3 }, { status: 4, ar: true }] },
  observation: { label: "Acquitté, puis lettre d'observations de la préfecture", steps: [{ status: 2 }, { status: 3 }, { status: 4, ar: true }, { doc: 4 }] },
  pieces: { label: 'Demande de pièces complémentaires avant l’acquittement', steps: [{ status: 2 }, { status: 3 }, { doc: 3, bloque: true }, { status: 4, ar: true }] },
  defere: { label: 'Acquitté, puis déféré au tribunal administratif', steps: [{ status: 2 }, { status: 3 }, { status: 4, ar: true }, { doc: 5 }] },
  refus: { label: 'Refusé par la préfecture', steps: [{ status: 2 }, { status: 6 }] },
  erreur: { label: 'Erreur de transmission (statut -1)', steps: [{ status: -1 }] },
};
const NUMERO = /^[A-Z0-9_]{1,15}$/;

const ymd = (d) => new Date(d).toISOString().slice(0, 10).replace(/-/g, '');

function createS2lowSimulateur({ db }) {
  const ko = (message) => ({ ok: false, message });
  const rowOf = async (remoteId) => db.get('SELECT * FROM s2low_sim_transactions WHERE remote_id = $1', [remoteId]);
  const view = (r) => ({ remoteId: r.remote_id, numero: r.numero, status: r.status, label: STATUS[r.status] || String(r.status), scenario: r.scenario, attente: r.attente, message: r.message, ar: r.ar });

  const svc = {
    mode: 'simulation', SCENARIOS, STATUS,

    async testConnexion() { return { ok: true, message: 'Simulateur S²LOW : connexion simulée' }; },

    /** Classification de la préfecture (natures, types de pièces) : la matière est contrôlée par l'outil d'après matieres.txt (TLT-04). */
    async classification() { return { natures: NATURES.map(([code, label]) => ({ code, label })), typesPj: TYPES_PJ.map(([code, label]) => ({ code, label })) }; },

    /** POST actes_transac_create.php : `OK` + identifiant, ou `KO` + message. */
    async creer(p) {
      if (!NUMERO.test(p.number || '')) return ko('Numéro de l’acte invalide (15 caractères au plus : majuscules, chiffres ou « _ »)');
      if (!p.subject || p.subject.length > 500) return ko('Objet de l’acte absent ou de plus de 500 caractères');
      if (!Number.isInteger(p.natureCode) || !NATURES.some(([c]) => c === p.natureCode)) return ko('Code de nature inconnu de la classification');
      if (!Array.isArray(p.classif) || p.classif.filter(Boolean).length < 2) return ko('La classification doit comporter au moins deux niveaux');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.decisionDate || '')) return ko('Date de la décision invalide (AAAA-MM-JJ)');
      if (!p.file?.name) return ko('Le fichier de l’acte est obligatoire');
      if (!TYPES_PJ.some(([c]) => c === p.typeActe)) return ko('Type de la pièce principale absent de la classification');
      if (p.annexes?.some((a) => !TYPES_PJ.some(([c]) => c === a.typePj))) return ko('Type de pièce jointe absent de la classification');
      if (p.annexes?.some((a) => !/\.(pdf|jpe?g|png)$/i.test(a.name || ''))) return ko('Format d’annexe non autorisé (PDF, JPG ou PNG)');
      if (await db.get("SELECT 1 AS x FROM s2low_sim_transactions WHERE organisme_id = $1 AND numero = $2 AND status <> 0", [p.organismeId, p.number])) return ko('Un acte porte déjà ce numéro');
      const scenario = SCENARIOS[p.scenario] ? p.scenario : 'nominal';
      const r = await db.get(
        `INSERT INTO s2low_sim_transactions (organisme_id, remote_id, numero, payload, status, scenario) VALUES ($1, 'tmp', $2, $3::jsonb, $4, $5) RETURNING id`,
        [p.organismeId, p.number, JSON.stringify(p), p.enAttente ? 17 : 1, scenario]);
      const remoteId = `S2L-${String(r.id).padStart(6, '0')}`;
      await db.run('UPDATE s2low_sim_transactions SET remote_id = $2 WHERE id = $1', [r.id, remoteId]);
      return { ok: true, id: remoteId };
    },

    /** Confirmation par l'utilisateur sur S²LOW (mode « préparation puis confirmation ») : 17 → 1. */
    async confirmer(remoteId) {
      const r = await rowOf(remoteId);
      if (!r) return ko('Transaction inconnue');
      if (r.status !== 17) return ko('La transaction n’est pas en attente d’être postée');
      await db.run('UPDATE s2low_sim_transactions SET status = 1, updated_at = now() WHERE id = $1', [r.id]);
      return { ok: true };
    },

    async statut(remoteId) { const r = await rowOf(remoteId); return r ? view(r) : null; },

    /** Documents de la préfecture non lus (list_document_prefecture). */
    async documentsPrefecture(organismeId) {
      return (await db.all(`SELECT d.id, d.type, d.titre, d.contenu, d.created_at, t.remote_id FROM s2low_sim_documents d JOIN s2low_sim_transactions t ON t.id = d.sim_id
                            WHERE t.organisme_id = $1 AND NOT d.lu ORDER BY d.id`, [organismeId]))
        .map((d) => ({ id: String(d.id), remoteId: d.remote_id, type: d.type, titre: d.titre, contenu: d.contenu, date: d.created_at }));
    },
    /** document_prefecture_mark_as_read : sans cet appel le même document revient à chaque interrogation. */
    async marquerLu(docId) { await db.run('UPDATE s2low_sim_documents SET lu = true WHERE id = $1', [Number(docId)]); },

    /** Réponse à la préfecture (type_envoie 4 : envoi de pièces ; 3 : refus d'envoi). */
    async repondre(remoteId, { typeEnvoie, message }) {
      const r = await rowOf(remoteId);
      if (!r) return ko('Transaction inconnue');
      if (![3, 4].includes(typeEnvoie)) return ko('type_envoie doit valoir 3 (refus d’envoi) ou 4 (envoi de pièces)');
      if (typeEnvoie === 3) await db.run('UPDATE s2low_sim_transactions SET status = 6, attente = false, message = $2, updated_at = now() WHERE id = $1', [r.id, message || 'Envoi de pièces refusé']);
      else await db.run('UPDATE s2low_sim_transactions SET attente = false, updated_at = now() WHERE id = $1', [r.id]);
      return { ok: true };
    },

    async annuler(remoteId) {
      const r = await rowOf(remoteId);
      if (!r) return ko('Transaction inconnue');
      if ([4, 5, 6].includes(r.status)) return ko('La transaction est déjà acquittée ou clôturée : elle ne peut plus être annulée');
      await db.run('UPDATE s2low_sim_transactions SET status = 0, updated_at = now() WHERE id = $1', [r.id]);
      return { ok: true };
    },

    /** Bordereau d'acquittement (actes_create_pdf.php) : PDF. */
    async bordereau(remoteId) {
      const r = await rowOf(remoteId);
      if (!r?.ar) return null;
      const doc = await PDFDocument.create(); const page = doc.addPage([595, 842]);
      const f = await doc.embedFont(StandardFonts.Helvetica); const fb = await doc.embedFont(StandardFonts.HelveticaBold);
      const line = (t, y, opt = {}) => page.drawText(t, { x: 60, y, size: opt.size || 11, font: opt.bold ? fb : f, color: rgb(0, 0, 0) });
      line('ACCUSÉ DE RÉCEPTION D’UN ACTE (SIMULATION)', 780, { bold: true, size: 15 });
      line('Document généré par le simulateur S²LOW : il n’a aucune valeur juridique.', 758, { size: 9 });
      line(`Identifiant unique de l’acte : ${r.ar.id}`, 715, { bold: true });
      line(`Numéro de l’acte : ${r.numero}`, 695); line(`Objet : ${String(r.payload.subject).slice(0, 90)}`, 675);
      line(`Date de la décision : ${r.payload.decisionDate}`, 655); line(`Accusé de réception émis le : ${new Date(r.ar.date).toLocaleString('fr-FR')}`, 635);
      line(`Transaction : ${r.remote_id}`, 615);
      return Buffer.from(await doc.save());
    },

    /** Acte tamponné avec la date de publication (`tampon=true&date_affichage=`). */
    async tampon(pdfBuffer, { dateAffichage, ar }) {
      const doc = await PDFDocument.load(pdfBuffer); const page = doc.getPage(0); const f = await doc.embedFont(StandardFonts.HelveticaBold);
      const { width, height } = page.getSize(); const y = height - 22;
      page.drawRectangle({ x: 24, y: y - 6, width: width - 48, height: 22, borderColor: rgb(0.8, 0.1, 0.1), borderWidth: 1, color: rgb(1, 1, 1), opacity: 0.85 });
      page.drawText(`SIMULATION — Reçu en préfecture le ${new Date(ar.date).toLocaleDateString('fr-FR')} — Publié le ${new Date(dateAffichage).toLocaleDateString('fr-FR')} — ${ar.id}`.slice(0, 118), { x: 30, y, size: 7.5, font: f, color: rgb(0.8, 0.1, 0.1) });
      return Buffer.from(await doc.save());
    },

    // ---------------------------------------------------------------------------------- simulation : faire avancer le « serveur »
    /**
     * Fait franchir `pas` étape(s) du scénario à la transaction indiquée, ou à toutes celles de l'organisme qui peuvent avancer.
     * Une transaction encore « en attente d'être postée » (17) ou qui attend une réponse à la préfecture n'avance pas.
     */
    async avancer({ organismeId, remoteId, pas = 1 }) {
      const rows = remoteId ? [await rowOf(remoteId)].filter(Boolean) : await db.all("SELECT * FROM s2low_sim_transactions WHERE organisme_id = $1 AND status NOT IN (17, 0, -1, 6) ORDER BY id", [organismeId]);
      const changes = [];
      for (const r0 of rows) {
        let r = r0;
        for (let i = 0; i < pas; i++) {
          if ([17, 0, -1, 6].includes(r.status) || r.attente) break;
          const step = SCENARIOS[r.scenario].steps[r.step];
          if (!step) break;
          let ar = r.ar; let message = r.message; let status = step.status ?? r.status; let attente = false;
          if (step.ar) ar = { id: `${r.payload.departement || '094'}-${r.payload.siren || 'SIMULATION'}-${ymd(new Date())}-${r.numero}-DE`, date: new Date().toISOString() };
          if (step.status === 6) message = 'Acte refusé par la préfecture (simulation)';
          if (step.status === -1) message = 'Erreur simulée lors de la transmission';
          if (step.doc) {
            await db.run('INSERT INTO s2low_sim_documents (sim_id, type, titre, contenu) VALUES ($1,$2,$3,$4)', [r.id, step.doc, `${DOC_TYPE[step.doc]} — ${r.numero}`,
              step.doc === 3 ? 'La préfecture demande la transmission de pièces complémentaires (simulation).' : step.doc === 4 ? 'La préfecture adresse une lettre d’observations (simulation).' : 'Le préfet a déféré l’acte au tribunal administratif (simulation).']);
            if (step.bloque) attente = true;
          }
          r = await db.get('UPDATE s2low_sim_transactions SET status = $2, step = step + 1, ar = $3::jsonb, message = $4, attente = $5, updated_at = now() WHERE id = $1 RETURNING *', [r.id, status, ar ? JSON.stringify(ar) : null, message, attente]);
          changes.push({ remoteId: r.remote_id, status: r.status, label: STATUS[r.status], doc: step.doc || null });
        }
      }
      return changes;
    },

    /** État complet du serveur factice (écran de simulation). */
    async etat(organismeId) {
      const rows = await db.all('SELECT * FROM s2low_sim_transactions WHERE organisme_id = $1 ORDER BY id DESC LIMIT 100', [organismeId]);
      return rows.map((r) => ({ ...view(r), etapes: SCENARIOS[r.scenario].steps.length, etape: r.step, peutAvancer: ![17, 0, -1, 6].includes(r.status) && !r.attente && !!SCENARIOS[r.scenario].steps[r.step] }));
    },
  };
  return svc;
}

module.exports = { createS2lowSimulateur, SCENARIOS, STATUS, DOC_TYPE, NUMERO, TYPES_PJ };
