/**
 * Assistant IA — copie d'une délibération adaptée à un nouveau contexte (D40, CPY-01 à CPY-05) ; socle du niveau « autres
 * propositions » de la section 21. Règle absolue (D21) : L'IA PROPOSE, L'AGENT VALIDE — rien n'est appliqué sans une action
 * explicite, proposition par proposition (pas de « tout accepter »).
 *  - chaque proposition est un couple « passage exact du texte » → « remplacement », avec la raison ;
 *  - une proposition dont le passage n'existe pas mot pour mot dans le texte est écartée (l'IA n'invente pas de cible) ;
 *  - les points à vérifier que l'IA ne sait pas adapter (montants, dates, noms, références) sont des ALERTES, jamais des modifications ;
 *  - le contenu des textes est traité comme une DONNÉE : les consignes qu'il pourrait contenir sont ignorées.
 */
const { E } = require('../../shared/errors');
const A = require('./analyses');

const MAX_CHARS = 30000;
const MAX_CONTEXT = 3000;
const KIND_LABEL = { expose: 'exposé des motifs', visas: 'visas et considérants', dispositif: 'dispositif (« délibéré »)' };

const toS = (r) => ({
  id: r.id, acteId: r.acte_id, textId: r.text_id, kind: r.kind, categorie: r.categorie ?? null, gravite: r.gravite ?? null, analyse: r.fonction ?? null, find: r.find, replacement: r.replacement, reason: r.reason, status: r.status,
  decidedBy: r.decided_by, decidedAt: r.decided_at, appliedVersion: r.applied_version, createdAt: r.created_at,
});
const toJournal = (r) => ({
  id: Number(r.id), username: r.username, question: r.question, reponse: r.reponse, note: r.note === null ? null : Number(r.note),
  commentaire: r.commentaire, modele: r.modele, contexte: r.contexte, createdAt: r.created_at, noteeAt: r.notee_at,
});

/** Mots significatifs d'une question (sans accents, sans mots vides) : servent à interroger la base des délibérations. */
const MOTS_VIDES = new Set(['avec', 'dans', 'pour', 'plus', 'sont', 'cette', 'cettes', 'elle', 'elles', 'nous', 'vous', 'etre', 'avoir', 'fait', 'quel', 'quelle', 'quels', 'quelles', 'comment', 'quoi', 'qui', 'que', 'des', 'les', 'une', 'aux', 'sur', 'par', 'pas', 'est', 'son', 'ses', 'lui', 'ils', 'leur', 'votre', 'notre', 'tout', 'tous', 'toute', 'toutes', 'mais', 'donc', 'ou', 'et', 'en', 'au', 'du', 'de', 'la', 'le', 'un', 'il', 'je', 'tu', 'on', 'ne', 'se', 'ce', 'sa', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'ces', 'puis', 'peut', 'peuvent', 'doit', 'doivent', 'faire', 'faut', 'comme', 'aussi', 'bien', 'tres', 'sans', 'sous', 'vers', 'chez', 'existe', 'existent', 'exister', 'deliberation', 'deliberations', 'parle', 'parlent', 'parler', 'sujet', 'concernant', 'trouve', 'trouver']);
function motsCles(question) {
  const sansAccent = String(question || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return [...new Set(sansAccent.split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !MOTS_VIDES.has(w)))];
}

/** Extrait l'objet JSON d'une réponse de modèle (avec ou sans bloc de code). */
function parseJson(text) {
  const t = String(text).trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  const raw = fenced ? fenced[1] : t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
  try { return JSON.parse(raw); } catch { return null; }
}

function createAi({ db, audit, ai, actes, textes, acl, log, queue, prompts, visas, late }) {
  /** Dépose les constats d'un rapport de références comme alertes du dossier (IA-36) : extrait dans « find », jamais appliqués automatiquement. */
  const deposer = async (a, runId, rapport, fonction) => {
    const out = [];
    for (const c of rapport.constats) {
      const src = c.source ? ` (source : ${c.source}${c.verifieLe ? `, vérifié le ${c.verifieLe}` : ''})` : '';
      out.push(await db.get("INSERT INTO ai_suggestions (organisme_id, acte_id, text_id, run_id, kind, find, reason, categorie, gravite, fonction) VALUES ($1,$2,$3,$4,'alerte',$5,$6,'visa',$7,$8) RETURNING *",
        [a.organisme_id, a.id, c.textId ?? null, runId, c.extrait ? c.extrait.slice(0, 240) : null, `${c.message}${src}`.slice(0, 600), c.gravite, fonction]));
    }
    return out;
  };

  const svc = {
    /** Copie simple (CPY-01) ; avec `adapter`, l'adaptation est DÉPOSÉE dans la file d'attente (arrière plan) — la copie est immédiate. */
    async copy(ctx, organismeId, sourceId, { contexte, adapter = false } = {}) {
      if (adapter && (!contexte || contexte.trim().length < 10)) throw E.badRequest('Décrivez le nouveau contexte (objet, bénéficiaire, montant, dates…) — au moins une phrase');
      const copy = await actes.duplicate(ctx, organismeId, sourceId);
      let job = null; let iaError = null;
      if (adapter && !(await prompts.actif(copy.organismeId, 'copie'))) iaError = 'La copie assistée par l’IA est désactivée par l’administration : copie simple';
      else if (adapter) {
        try { job = await queue.enqueue(ctx, { organismeId: copy.organismeId, acteId: copy.id, kind: 'adaptation', payload: { contexte, sourceId } }); }
        catch (e) { iaError = e.message; log.warn({ err: e.message }, "copie assistée : tâche IA refusée, copie simple conservée"); }
      }
      await audit.log(ctx, { organismeId: copy.organismeId, action: 'acte.copie', entity: 'actes', entityId: copy.id, after: { source: sourceId, assistee: adapter, job: job?.id ?? null, iaError } });
      return { acte: copy, job, iaError };
    },

    /**
     * Aide IA fondée sur le manifeste : l'interface fournit les extraits pertinents du manifeste et la question ;
     * l'IA répond STRICTEMENT à partir de ces extraits (aucune connaissance extérieure). Appel synchrone (l'agent attend la réponse).
     */
    async aideManifeste(ctx, organismeId, { question, extraits }) {
      await prompts.assertActif(organismeId, 'aide');
      const { system, modele } = await prompts.resolve(organismeId, 'aide');
      const morceaux = [];
      let total = 0;
      for (const [i, e] of extraits.slice(0, 8).entries()) {
        const texte = String(e.texte || '').slice(0, 8000);
        total += texte.length;
        if (total > 24000) break;
        morceaux.push(`### Extrait ${i + 1} — ${String(e.titre || 'Manifeste').slice(0, 300)}\n${texte}`);
      }
      if (!morceaux.length) throw E.badRequest('Aucun extrait du manifeste fourni');
      const prompt = `Question de l'agent :\n${question.trim()}\n\nExtraits du manifeste de l'application (source unique autorisée) :\n<EXTRAITS>\n${morceaux.join('\n\n')}\n</EXTRAITS>`;
      let r;
      try { r = await ai.query({ system, prompt, maxTokens: 1200, temperature: 0.1, model: modele || undefined }); }
      catch (e) { if (e?.status) throw e; throw E.upstream(`L'IA n'a pas pu répondre : ${e?.message || 'erreur inconnue'}`); }
      await audit.log(ctx, { organismeId, action: 'ia.aide_manifeste', entity: 'ia', after: { question: question.slice(0, 200), extraits: morceaux.length, modele: r.model ?? modele ?? null } });
      return { reponse: r.text, modele: r.model ?? null };
    },

    /**
     * Del-IA : question libre posée depuis le guide. La réponse s'appuie sur la documentation (extraits, jamais nommés à
     * l'agent), sur le contexte de l'agent (droits, hiérarchie) et sur une recherche dans les délibérations de
     * l'application (limités à ses droits). La question et la réponse sont journalisées ; l'agent pourra la noter.
     */
    async delIaDemander(ctx, organismeId, { question, extraits }) {
      await prompts.assertActif(organismeId, 'aide');
      const { system, modele } = await prompts.resolve(organismeId, 'aide');
      const morceaux = []; let total = 0;
      for (const e of extraits.slice(0, 8)) {
        const texte = String(e.texte || '').slice(0, 8000); total += texte.length;
        if (total > 24000) break;
        morceaux.push(`### ${String(e.titre || 'Documentation').slice(0, 300)}\n${texte}`);
      }
      if (!morceaux.length) throw E.badRequest('Aucun extrait fourni');
      const agent = ctx.agent || {};
      const hierarchie = `- Direction : ${agent.direction_label || 'non précisée'}\n- Service : ${agent.service_label || 'non précisé'}\n- Poste : ${agent.poste || 'non précisé'}\n- Administrateur de plateforme : ${ctx.isPlatformAdmin ? 'oui' : 'non'}`;
      let resultats = [];
      try {
        const clefs = motsCles(question).slice(0, 8);
        if (clefs.length && late?.recherche) {
          const r = await late.recherche.chercher(ctx, organismeId, { q: clefs.join(' OR '), limit: 5 });
          resultats = r.items.map((i) => ({ numeroSuivi: i.numeroSuivi, numero: i.numero, titre: i.titre, statut: i.statut, dateSeance: i.dateSeance, resultat: i.resultat?.libelle || null }));
        }
      } catch (e) { log?.warn?.({ err: e.message }, 'aide IA : recherche indisponible'); }
      const blocResultats = resultats.length
        ? `Délibérations trouvées dans l'application (résultats de recherche, dans la limite des droits de l'agent) :\n${resultats.map((x, i) => `${i + 1}. n° ${x.numeroSuivi} — « ${x.titre} » (${x.statut}${x.dateSeance ? `, séance du ${String(x.dateSeance).slice(0, 10)}` : ''}${x.resultat ? `, ${x.resultat}` : ''})`).join('\n')}`
        : "Aucune délibération de l'application ne correspond à cette question.";
      const prompt = `Ce que je sais de l'agent qui pose la question :\n${hierarchie}\n\n${blocResultats}\n\nExtraits de documentation interne (à utiliser sans les nommer) :\n<DOC>\n${morceaux.join('\n\n')}\n</DOC>\n\nQuestion :\n${question.trim()}`;
      let r;
      try { r = await ai.query({ system, prompt, maxTokens: 1200, temperature: 0.1, model: modele || undefined }); }
      catch (e) { if (e?.status) throw e; throw E.upstream(`L'IA n'a pas pu répondre : ${e?.message || 'erreur inconnue'}`); }
      let id = null;
      try {
        const row = await db.get(
          'INSERT INTO aide_ia_journal (organisme_id, username, question, reponse, contexte, modele) VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING id',
          [organismeId, ctx.username, question.slice(0, 2000), r.text.slice(0, 20000),
            JSON.stringify({ direction: agent.direction_label || null, service: agent.service_label || null, resultats: resultats.map((x) => x.numeroSuivi), extraits: morceaux.length }), r.model ?? modele ?? null]);
        id = Number(row.id);
        await audit.log(ctx, { organismeId, action: 'ia.aide_delia', entity: 'aide_ia_journal', entityId: id, after: { question: question.slice(0, 200) } });
      } catch (e) { log?.warn?.({ err: e.message }, 'aide IA : journalisation impossible (table aide_ia_journal absente ? migration 0055 à appliquer)'); }
      return { id, reponse: r.text };
    },

    /** Note (1 à 4) et commentaire de l'agent sur une réponse de Del-IA qu'il a reçue. */
    async delIaNoter(ctx, organismeId, id, { note, commentaire }) {
      const com = commentaire ? String(commentaire).slice(0, 2000) : null;
      const r = await db.get('UPDATE aide_ia_journal SET note = $4, commentaire = $5, notee_at = now() WHERE id = $1 AND organisme_id = $2 AND username = $3 RETURNING id', [id, organismeId, ctx.username, note, com]);
      if (!r) throw E.notFound('Réponse introuvable');
      await audit.log(ctx, { organismeId, action: 'ia.aide_note', entity: 'aide_ia_journal', entityId: id, after: { note } });
      return { id: Number(r.id), note, commentaire: com };
    },

    /** Journal des questions/réponses de Del-IA et moyenne des notes (administration). */
    async delIaJournal(organismeId, { limit = 50, offset = 0 } = {}) {
      const total = (await db.get('SELECT count(*)::int AS n FROM aide_ia_journal WHERE organisme_id = $1', [organismeId])).n;
      const rows = await db.all('SELECT * FROM aide_ia_journal WHERE organisme_id = $1 ORDER BY id DESC LIMIT $2 OFFSET $3', [organismeId, limit, offset]);
      const st = await db.get(
        `SELECT count(*) FILTER (WHERE note IS NOT NULL)::int AS notes, avg(note) AS moyenne,
           count(*) FILTER (WHERE note = 1)::int AS n1, count(*) FILTER (WHERE note = 2)::int AS n2,
           count(*) FILTER (WHERE note = 3)::int AS n3, count(*) FILTER (WHERE note = 4)::int AS n4
         FROM aide_ia_journal WHERE organisme_id = $1`, [organismeId]);
      return { total, limit, offset, items: rows.map(toJournal), stats: { notes: st.notes, moyenne: st.moyenne === null ? null : Math.round(Number(st.moyenne) * 100) / 100, repartition: { 1: st.n1, 2: st.n2, 3: st.n3, 4: st.n4 } } };
    },

    /** Redemande les propositions pour un brouillon : tâche en arrière plan. */
    async requestAdaptation(ctx, organismeId, acteId, { contexte }) {
      const a = await actes.load(ctx, organismeId, acteId, { edit: true });
      await prompts.assertActif(a.organisme_id, 'copie');
      if (!contexte || contexte.trim().length < 10) throw E.badRequest('Décrivez le nouveau contexte (objet, bénéficiaire, montant, dates…) — au moins une phrase');
      if (contexte.length > MAX_CONTEXT) throw E.badRequest(`Contexte trop long (maximum ${MAX_CONTEXT} caractères)`);
      return queue.enqueue(ctx, { organismeId: a.organisme_id, acteId: a.id, kind: 'adaptation', payload: { contexte } });
    },

    /** Demande à l'IA des propositions pour chaque texte non vide du dossier ; remplace les propositions en attente. */
    async suggest(ctx, organismeId, acteId, { contexte, sourceId } = {}, helpers = null) {
      const a = await actes.load(ctx, organismeId, acteId, { edit: true });
      await prompts.assertActif(a.organisme_id, 'copie');
      if (!contexte || contexte.trim().length < 10) throw E.badRequest('Décrivez le nouveau contexte (objet, bénéficiaire, montant, dates…) — au moins une phrase');
      if (contexte.length > MAX_CONTEXT) throw E.badRequest(`Contexte trop long (maximum ${MAX_CONTEXT} caractères)`);
      const list = await textes.list(ctx, a.organisme_id, a.id);
      const run = await db.get("INSERT INTO ai_runs (organisme_id, acte_id, kind, requested_by, context) VALUES ($1,$2,'copie',$3,$4) RETURNING id", [a.organisme_id, a.id, ctx.username, contexte]);
      await db.run("UPDATE ai_suggestions SET status = 'obsolete' WHERE acte_id = $1 AND status = 'pending' AND fonction = 'copie'", [a.id]);
      let promptChars = 0; let responseChars = 0; let model = null; const out = [];
      const ask = (req) => (helpers ? helpers.query(() => ai.query(req)) : ai.query(req));
      try {
        for (const [ti, t] of list.entries()) {
          if (helpers) { if (await helpers.cancelled()) break; await helpers.progress(ti, list.length, KIND_LABEL[t.kind]); }
          const v = await textes.view(ctx, a.organisme_id, a.id, t.id, { mode: 'propre' });
          const md = v.markdown || '';
          if (!md.trim()) continue;
          if (md.length > MAX_CHARS) { out.push(await svc.addAlert(a, t.id, run.id, `Texte « ${KIND_LABEL[t.kind]} » trop long pour l'analyse automatique : relisez-le entièrement.`)); continue; }
          const prompt = `Nouveau contexte décrit par l'agent :\n${contexte.trim()}\n\nFiche du dossier : titre « ${a.titre} »${a.montant ? `, montant ${Number(a.montant)} €` : ''}.\n${sourceId ? `Le texte ci-dessous provient d'un dossier existant (n° ${sourceId}).\n` : ''}\nType de texte : ${KIND_LABEL[t.kind]}.\n<TEXTE>\n${md}\n</TEXTE>`;
          const P = await prompts.resolve(a.organisme_id, 'copie');
          promptChars += prompt.length + P.system.length;
          const r = await ask({ system: P.system, prompt, model: P.modele || undefined });
          model = r.model || model; responseChars += r.text.length;
          const j = parseJson(r.text);
          if (!j) { out.push(await svc.addAlert(a, t.id, run.id, `Réponse de l'IA illisible pour « ${KIND_LABEL[t.kind]} » : aucune proposition retenue.`)); continue; }
          for (const p of Array.isArray(j.propositions) ? j.propositions.slice(0, 40) : []) {
            const find = typeof p?.find === 'string' ? p.find : ''; const rep = typeof p?.replace === 'string' ? p.replace : '';
            if (!find || find === rep || rep.length > 5000) continue;
            if (!md.includes(find)) { continue; } // passage inventé ou reformulé : écarté
            const row = await db.get("INSERT INTO ai_suggestions (organisme_id, acte_id, text_id, run_id, kind, find, replacement, reason, categorie, fonction) VALUES ($1,$2,$3,$4,'remplacement',$5,$6,$7,'copie','copie') RETURNING *",
              [a.organisme_id, a.id, t.id, run.id, find, rep, String(p.raison || p.reason || '').slice(0, 500)]);
            out.push(row);
          }
          for (const al of Array.isArray(j.alertes) ? j.alertes.slice(0, 20) : []) if (typeof al === 'string' && al.trim()) out.push(await svc.addAlert(a, t.id, run.id, al.trim().slice(0, 500)));
        }
        await db.run('UPDATE ai_runs SET model = $2, prompt_chars = $3, response_chars = $4 WHERE id = $1', [run.id, model, promptChars, responseChars]);
      } catch (e) {
        await db.run("UPDATE ai_runs SET status = 'error', error = $2 WHERE id = $1", [run.id, e.message]);
        throw e;
      }
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'ia.adaptation', entity: 'actes', entityId: a.id, after: { runId: run.id, propositions: out.filter((o) => o.kind === 'remplacement').length, alertes: out.filter((o) => o.kind === 'alerte').length } });
      return { runId: run.id, items: out.map(toS) };
    },


    // ------------------------------------------------------------------------------------------ outils de l'éditeur (IA-60)
    /** Demande une analyse (orthographe, style, visas, complet) : tâche déposée dans la file, exécutée en arrière plan. */
    async requestAnalyse(ctx, organismeId, acteId, { type, textId }) {
      const a = await actes.load(ctx, organismeId, acteId, { edit: true });
      if (!A.TYPES.includes(type)) throw E.badRequest(`Analyse inconnue : ${type}`);
      await prompts.assertActif(a.organisme_id, type);
      if (textId) { const t = await db.get('SELECT 1 AS x FROM tracked_texts WHERE id = $1 AND acte_id = $2', [textId, a.id]); if (!t) throw E.notFound('Texte introuvable'); }
      return queue.enqueue(ctx, { organismeId: a.organisme_id, acteId: a.id, kind: 'analyse', payload: { type, textId: textId ?? null } });
    },

    /**
     * Analyse d'un texte (ou de tous, pour `complet` sans textId). Les propositions en attente de la MÊME fonction sur les
     * mêmes textes sont remplacées ; les décisions déjà prises sont conservées.
     */
    async analyse(ctx, organismeId, acteId, { type, textId = null }, helpers = null) {
      const a = await actes.load(ctx, organismeId, acteId, { edit: true });
      const all = await textes.list(ctx, a.organisme_id, a.id);
      const list = textId ? all.filter((t) => t.id === textId) : all;
      await prompts.assertActif(a.organisme_id, type);
      const passes = type === 'complet' ? (await Promise.all(['orthographe', 'style', 'visas'].map(async (x) => ((await prompts.actif(a.organisme_id, x)) ? x : null)))).filter(Boolean) : [type];
      const run = await db.get('INSERT INTO ai_runs (organisme_id, acte_id, kind, requested_by, context) VALUES ($1,$2,$3,$4,$5) RETURNING id', [a.organisme_id, a.id, `analyse:${type}`, ctx.username, A.LABEL[type]]);
      const views = [];
      for (const t of list) { const v = await textes.view(ctx, a.organisme_id, a.id, t.id, { mode: 'propre' }); views.push({ t, md: v.markdown || '' }); }
      const ids = list.map((t) => t.id);
      await db.run("UPDATE ai_suggestions SET status = 'obsolete' WHERE acte_id = $1 AND status = 'pending' AND fonction = ANY($2::text[]) AND (text_id = ANY($3::int[]) OR text_id IS NULL)", [a.id, type === 'complet' ? [...passes, 'complet'] : passes, ids]);
      let promptChars = 0; let responseChars = 0; let model = null; const out = []; let alertes = 0;
      const ask = (req) => (helpers ? helpers.query(() => ai.query(req)) : ai.query(req));
      const passPrompts = Object.fromEntries(await Promise.all(passes.map(async (x) => [x, await prompts.resolve(a.organisme_id, x)])));
      const total = views.length * passes.length; let n = 0;
      const tag = type === 'complet' ? 'complet' : null;
      try {
        for (const pass of passes) {
          for (const { t, md } of views) {
            if (helpers) { if (await helpers.cancelled()) break; await helpers.progress(n, total, `${A.LABEL[pass]} — ${A.KIND_LABEL[t.kind]}`); }
            n++;
            if (!md.trim()) continue;
            if (md.length > MAX_CHARS) { out.push(await svc.addAlert(a, t.id, run.id, `Texte « ${A.KIND_LABEL[t.kind]} » trop long pour l'analyse automatique : relisez-le entièrement.`, { categorie: 'completude', gravite: 'info', analyse: tag || pass })); continue; }
            const fiche = `Fiche du dossier : titre « ${a.titre} »${a.montant ? `, montant ${Number(a.montant)} €` : ''}${a.incidence_financiere ? ', incidence financière' : ''}.`;
            const autres = pass === 'visas' ? views.filter((v) => v.t.id !== t.id && v.md.trim()).map((v) => `--- ${A.KIND_LABEL[v.t.kind]} (pour cohérence) ---\n${v.md.slice(0, 6000)}`).join('\n') : '';
            const prompt = `${fiche}\nType de texte à contrôler : ${A.KIND_LABEL[t.kind]}.\n${autres ? `${autres}\n` : ''}<TEXTE>\n${md}\n</TEXTE>`;
            const P = passPrompts[pass];
            promptChars += prompt.length + P.system.length;
            const r = await ask({ system: P.system, prompt, model: P.modele || undefined });
            model = r.model || model; responseChars += r.text.length;
            const j = parseJson(r.text);
            if (!j) { out.push(await svc.addAlert(a, t.id, run.id, `Réponse de l'IA illisible pour « ${A.KIND_LABEL[t.kind]} » (${A.LABEL[pass].toLowerCase()}) : aucune proposition retenue.`, { categorie: 'completude', gravite: 'info', analyse: tag || pass })); continue; }
            for (const p of Array.isArray(j.propositions) ? j.propositions.slice(0, 60) : []) {
              const find = typeof p?.find === 'string' ? p.find : ''; const rep = typeof p?.replace === 'string' ? p.replace : '';
              if (!find || find === rep || rep.length > 5000 || !md.includes(find)) continue; // passage inventé ou reformulé : écarté
              const cat = ['orthographe', 'typographie', 'style', 'visa', 'coherence'].includes(p.categorie) ? p.categorie : (pass === 'visas' ? 'visa' : pass);
              const grav = ['a_revoir', 'info'].includes(p.gravite) ? p.gravite : 'info';
              out.push(await db.get("INSERT INTO ai_suggestions (organisme_id, acte_id, text_id, run_id, kind, find, replacement, reason, categorie, gravite, fonction) VALUES ($1,$2,$3,$4,'remplacement',$5,$6,$7,$8,$9,$10) RETURNING *",
                [a.organisme_id, a.id, t.id, run.id, find, rep, String(p.raison || p.reason || '').slice(0, 500), cat, grav, tag || pass]));
            }
            for (const al of Array.isArray(j.alertes) ? j.alertes.slice(0, 20) : []) {
              const x = A.parseAlerte(al); if (!x.message.trim()) continue;
              alertes++; out.push(await svc.addAlert(a, t.id, run.id, x.message.trim().slice(0, 500), { categorie: pass === 'visas' ? 'visa' : pass, gravite: x.gravite, analyse: tag || pass }));
            }
          }
        }
        if (type === 'complet') {
          const nAnnexes = (await db.get('SELECT count(*)::int AS n FROM annexes WHERE acte_id = $1', [a.id])).n;
          const mds = all.map((t) => ({ id: t.id, kind: t.kind, markdown: (views.find((v) => v.t.id === t.id) || {}).md ?? '' }));
          for (const c of A.controlesDeterministes(a, mds, { annexes: nAnnexes })) {
            alertes++; out.push(await svc.addAlert(a, c.textId, run.id, c.message, { categorie: c.categorie, gravite: c.gravite, analyse: 'complet' }));
          }
          // références juridiques : vérifiées par le code contre la bibliothèque de visas (IA-31, IA-32)
          const rapport = await visas.rapport(ctx, a.organisme_id, a.id);
          for (const x of await deposer(a, run.id, rapport, 'complet')) { alertes++; out.push(x); }
        }
        await db.run('UPDATE ai_runs SET model = $2, prompt_chars = $3, response_chars = $4 WHERE id = $1', [run.id, model, promptChars, responseChars]);
      } catch (e) {
        await db.run("UPDATE ai_runs SET status = 'error', error = $2 WHERE id = $1", [run.id, e.message]);
        throw e;
      }
      await audit.log(ctx, { organismeId: a.organisme_id, action: `ia.analyse.${type}`, entity: 'actes', entityId: a.id, after: { runId: run.id, propositions: out.filter((o) => o.kind === 'remplacement').length, alertes } });
      return { runId: run.id, items: out.map(toS) };
    },

    /**
     * « Vérifier les références » (IA-30, 31, 32, 35, 36) : immédiat, sans modèle, disponible même si l'IA est désactivée.
     * Les alertes en attente de la même fonction sont remplacées ; les décisions déjà prises sont conservées.
     */
    async verifierReferences(ctx, organismeId, acteId) {
      const a = await actes.load(ctx, organismeId, acteId, { edit: true });
      const rapport = await visas.rapport(ctx, a.organisme_id, a.id);
      const run = await db.get('INSERT INTO ai_runs (organisme_id, acte_id, kind, requested_by, context) VALUES ($1,$2,$3,$4,$5) RETURNING id', [a.organisme_id, a.id, 'analyse:references', ctx.username, A.LABEL.references]);
      await db.run("UPDATE ai_suggestions SET status = 'obsolete' WHERE acte_id = $1 AND status = 'pending' AND fonction = 'references'", [a.id]);
      const items = await deposer(a, run.id, rapport, 'references');
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'ia.analyse.references', entity: 'actes', entityId: a.id, after: { runId: run.id, references: rapport.references.length, constats: rapport.constats.length } });
      return { runId: run.id, rapport, items: items.map(toS) };
    },

    /**
     * Pré-contrôle joint au dossier à l'entrée dans l'étape « Service juridique » (IA-37) : références vérifiées par le code, sans IA,
     * non bloquant. Lancé par le circuit (pas de personne derrière) : les constats remplacent ceux de la vérification précédente.
     */
    async precontroleJuridique(organismeId, acteId) {
      const a = await actes.raw(organismeId, acteId);
      const rapport = await visas.rapportDe(a);
      const run = await db.get('INSERT INTO ai_runs (organisme_id, acte_id, kind, requested_by, context) VALUES ($1,$2,$3,$4,$5) RETURNING id', [a.organisme_id, a.id, 'analyse:precontrole', 'systeme', 'Pré-contrôle du service juridique']);
      await db.run("UPDATE ai_suggestions SET status = 'obsolete' WHERE acte_id = $1 AND status = 'pending' AND fonction = 'references'", [a.id]);
      const items = await deposer(a, run.id, rapport, 'references');
      await audit.log(null, { organismeId: a.organisme_id, action: 'ia.precontrole_juridique', entity: 'actes', entityId: a.id, after: { runId: run.id, constats: rapport.constats.length, bloquants: rapport.resume.bloquant } });
      return { runId: run.id, constats: items.length, resume: rapport.resume };
    },

    /** « Tout accepter (orthographe seule) » (IA-13) : applique une à une les corrections d'orthographe et de typographie en attente. */
    async acceptAllSpelling(ctx, organismeId, acteId, { textId }) {
      const a = await actes.load(ctx, organismeId, acteId, { edit: true });
      const rows = await db.all("SELECT id FROM ai_suggestions WHERE acte_id = $1 AND text_id = $2 AND status = 'pending' AND kind = 'remplacement' AND categorie IN ('orthographe', 'typographie') ORDER BY id", [a.id, textId]);
      let accepted = 0; let skipped = 0;
      for (const r of rows) {
        try { await svc.decide(ctx, a.organisme_id, a.id, r.id, { decision: 'accept' }); accepted++; } catch (e) { if (e.status === 409) skipped++; else throw e; }
      }
      return { accepted, skipped };
    },

    async addAlert(a, textId, runId, message, { categorie, gravite, analyse } = {}) {
      return db.get("INSERT INTO ai_suggestions (organisme_id, acte_id, text_id, run_id, kind, reason, categorie, gravite, fonction) VALUES ($1,$2,$3,$4,'alerte',$5,$6,$7,$8) RETURNING *", [a.organisme_id, a.id, textId, runId, message, categorie || 'copie', gravite || null, analyse || 'copie']);
    },

    async list(ctx, organismeId, acteId, { statut, textId } = {}) {
      const a = await actes.load(ctx, organismeId, acteId);
      const rows = await db.all(`SELECT s.*, t.kind AS text_kind FROM ai_suggestions s LEFT JOIN tracked_texts t ON t.id = s.text_id WHERE s.acte_id = $1 ${statut ? 'AND s.status = $2' : "AND s.status <> 'obsolete'"} ${textId ? `AND s.text_id = $${statut ? 3 : 2}` : ''} ORDER BY s.text_id, s.id`, [a.id, ...(statut ? [statut] : []), ...(textId ? [textId] : [])]);
      return rows.map((r) => ({ ...toS(r), textKind: r.text_kind }));
    },

    /** Décision de l'agent : accepter (éventuellement en éditant le remplacement) ou refuser. Jamais automatique. */
    async decide(ctx, organismeId, acteId, suggestionId, { decision, replacement }) {
      const a = await actes.load(ctx, organismeId, acteId, { edit: true });
      const s = await db.get('SELECT * FROM ai_suggestions WHERE id = $1 AND acte_id = $2', [suggestionId, a.id]);
      if (!s) throw E.notFound('Proposition introuvable');
      if (s.status !== 'pending') throw E.conflict(`Proposition déjà traitée (${s.status})`);
      if (decision === 'reject' || s.kind === 'alerte') {
        await db.run("UPDATE ai_suggestions SET status = 'rejected', decided_by = $2, decided_at = now() WHERE id = $1", [s.id, ctx.username]);
        await audit.log(ctx, { organismeId: a.organisme_id, action: s.kind === 'alerte' ? 'ia.alerte.ecartee' : 'ia.refus', entity: 'ai_suggestions', entityId: s.id });
        return { id: s.id, status: 'rejected' };
      }
      const v = await textes.view(ctx, a.organisme_id, a.id, s.text_id, { mode: 'propre' });
      const at = v.markdown.indexOf(s.find);
      if (at < 0) {
        await db.run("UPDATE ai_suggestions SET status = 'obsolete' WHERE id = $1", [s.id]);
        throw E.conflict('Le texte a changé : le passage visé par cette proposition a disparu');
      }
      const rep = replacement !== undefined ? replacement : s.replacement;
      const next = v.markdown.slice(0, at) + rep + v.markdown.slice(at + s.find.length);
      const r = await textes.commit(ctx, a.organisme_id, a.id, s.text_id, { markdown: next, baseVersion: v.version, reason: 'Proposition IA acceptée' });
      const status = replacement !== undefined && replacement !== s.replacement ? 'edited' : 'accepted';
      await db.run('UPDATE ai_suggestions SET status = $2, decided_by = $3, decided_at = now(), applied_version = $4, replacement = $5 WHERE id = $1', [s.id, status, ctx.username, r.version, rep]);
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'ia.acceptation', entity: 'ai_suggestions', entityId: s.id, before: { find: s.find }, after: { replacement: rep, version: r.version, edited: status === 'edited' } });
      return { id: s.id, status, version: r.version };
    },
  };
  void acl;
  // le travail de fond : l'exécutant de la file appelle `suggest` pour le compte du demandeur
  queue.register('adaptation', async (job, ctx, helpers) => {
    const r = await svc.suggest(ctx, job.organisme_id, job.acte_id, job.payload, helpers);
    return { runId: r.runId, propositions: r.items.filter((i) => i.kind === 'remplacement').length, alertes: r.items.filter((i) => i.kind === 'alerte').length };
  });
  queue.register('analyse', async (job, ctx, helpers) => {
    const r = await svc.analyse(ctx, job.organisme_id, job.acte_id, job.payload, helpers);
    return { runId: r.runId, type: job.payload.type, propositions: r.items.filter((i) => i.kind === 'remplacement').length, alertes: r.items.filter((i) => i.kind === 'alerte').length };
  });
  return svc;
}

module.exports = { createAi, parseJson };
