/**
 * Moteur de circuit (section 9). Le circuit est une DONNÉE (graphe versionné, graph.js) ; ce moteur l'exécute :
 *  - submit : contrôle de complétude, choix du circuit, projection du parcours (les personnes du circuit voient l'acte dès
 *    l'envoi, VIS-01), démarrage du suivi des modifications, passage à la première étape ;
 *  - validate : le détenteur (ou son délégué, co-détention) valide ; modes un / tous / quorum ; étapes sans titulaire
 *    sautées si optionnelles ; auto-validation du rédacteur interdite ;
 *  - refuse : vers l'étape précédente RÉELLEMENT traversée (pile `trail`, pas le graphe statique), la première, ou
 *    n'importe quelle étape antérieure ; reprise « directe » (retour au refuseur) ou « complète », au choix du refuseur ;
 *  - recompute : le changement d'un champ qui pilote le circuit (incidence financière) recalcule la suite (CIR-14) ;
 *  - toute transition est atomique (verrou de ligne) et historisée (step_events), jamais détruite.
 */
const { E } = require('../../shared/errors');
const G = require('./graph');
const normLabel = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const { addBusinessDays } = require('../../shared/time');

/** Statuts où l'acte parcourt le circuit ; « en_attente_scc » = étape SCC en cours (l'acte y reste une fois le circuit terminé). */
const IN_CIRCUIT = ['en_circuit', 'modification_demandee', 'en_attente_scc'];
// Actes qui ne sont pas encore passés au conseil (rédaction → prêts), pour la vue « Tous les actes ».
const EN_COURS_ACTIFS = ['brouillon', 'modification_demandee', 'en_circuit', 'valide_dgs', 'en_attente_scc', 'mis_a_disposition', 'avis_rendu', 'inscrit_odj', 'texte_definitif_pret', 'pret_a_transmettre', 'a_signer', 'signe', 'signature_refusee'];
// Actes dont le circuit est terminé (plus d'étape courante) mais pas encore passés en séance, pour la rubrique « dans le circuit ».
const POST_CIRCUIT = ['valide_dgs', 'en_attente_scc', 'mis_a_disposition', 'avis_rendu', 'inscrit_odj', 'texte_definitif_pret', 'pret_a_transmettre', 'a_signer', 'signe', 'signature_refusee'];
// Libellé d'étape pour les actes sortis du circuit (plus d'étape courante) : chacun a sa rupture.
const ETAPE_HORS_CIRCUIT = {
  valide_dgs: 'Validé DGS', en_attente_scc: 'En attente SCC', mis_a_disposition: 'Mis à disposition', avis_rendu: 'Avis rendu',
  inscrit_odj: 'Inscrit au conseil', texte_definitif_pret: 'Texte définitif prêt', pret_a_transmettre: 'Prêt à transmettre',
  a_signer: 'À signer', signe: 'Signé', signature_refusee: 'Signature refusée',
};

function createEngine({ db, audit, actes, acl, titulaires, delegations, comments, settings, bus, late }) {
  const graphCache = new Map();
  const graphOf = async (versionId) => {
    if (!graphCache.has(versionId)) {
      const v = await db.get('SELECT graph FROM circuit_versions WHERE id = $1', [versionId]);
      if (!v) throw E.conflict('Version de circuit introuvable');
      graphCache.set(versionId, v.graph);
    }
    return graphCache.get(versionId);
  };
  const typeCodeOf = async (typeId) => (await db.get('SELECT code FROM ref_items WHERE id = $1', [typeId]))?.code || null;
  const typeMetaOf = async (typeId) => (await db.get('SELECT meta FROM ref_items WHERE id = $1', [typeId]))?.meta || {};

  const factsOf = async (a) => ({
    incidenceFinanciere: a.incidence_financiere, montant: a.montant === null || a.montant === undefined ? null : Number(a.montant),
    typeCode: await typeCodeOf(a.type_id), urgence: a.urgence, directionCode: a.direction_code, serviceCode: a.service_code,
    hasCommission: late.commissions ? await late.commissions.count(a.id) > 0 : false, custom: a.custom || {},
  });

  /** Définition d'une étape : graphe, ou étape ponctuelle ajoutée à cet acte seul (CIR-68). */
  const defOf = (graph, a, key) => G.stepOf(graph, key) || (a.adhoc_steps || []).find((s) => s.key === key) || null;
  /** Étape dont on n'affiche pas les noms, seulement l'étape de validation (paramétrable dans le circuit : `masquerNoms`) ; par défaut, les étapes tenues par un groupe (financier, juridique, SCC…). */
  const masqueNoms = (def) => (def?.masquerNoms !== undefined ? !!def.masquerNoms : def?.resolver?.kind === 'groupe');
  const baseKeyOf = (a, key) => (a.adhoc_steps || []).find((s) => s.key === key)?.afterKey || key;
  /** Clé de l'étape « direction » du circuit (titulaire directeur), pour le retour proposé aux DGA. */
  const directionStepKey = (graph) => (graph.steps.find((s) => s.resolver?.kind === 'titulaire' && s.resolver?.fonction === 'directeur') || {}).key || null;

  /** Titulaires d'une étape (CIR-20). Le rédacteur ne valide jamais sa propre étape (CIR-24). */
  async function resolveStep(a, step, cfg) {
    const org = a.organisme_id; const r = step.resolver || {};
    // Responsable intermédiaire : fonction facultative, désactivée par défaut (paramètre `circuit.resp_intermediaire`, D56)
    if (r.kind === 'titulaire' && r.fonction === 'responsable_intermediaire' && cfg['circuit.resp_intermediaire']?.value !== true) return { holders: [], skipped: true, reason: 'desactive' };
    let holders = []; let via = null;
    if (r.kind === 'redacteur') holders = [a.redacteur, ...(a.co_redacteurs || [])];
    else if (r.kind === 'titulaire') {
      // service qui porte le nom de sa direction : le responsable de service est le directeur (D68)
      const same = !!a.service_label && !!a.direction_label && normLabel(a.service_label) === normLabel(a.direction_label);
      const t = await titulaires.resolveFor(org, r.fonction, { directionCode: a.direction_code, serviceCode: a.service_code, serviceSameAsDirection: same });
      if (t.direct === 'dgs') return { holders: [], skipped: true, reason: 'dgs_direct', via: 'rattachement' }; // direction rattachée directement à la DGS : pas d'étape DGA (D66)
      if (t.vacant && r.fonction !== 'dgs') return { holders: [], skipped: true, reason: 'vacant', via: t.via }; // poste vacant : étape contournée (D67)
      holders = t.holders; via = t.via;
    }
    else if (r.kind === 'groupe') holders = await titulaires.groupMembers(org, r.code);
    else if (r.kind === 'agent') holders = [r.username];
    holders = [...new Set(holders.map((h) => h.toLowerCase()))];
    // L'étape SCC ne se contourne jamais du fait de l'auto-validation : un acte rédigé par un membre du SCC
    // (sa directrice, par exemple) passe quand même par le SCC. Le rédacteur est écarté s'il reste d'autres
    // membres pour valider ; s'il est seul, il valide son propre acte à cette étape.
    const forceScc = r.kind === 'groupe' && r.code === 'scc';
    if (r.kind !== 'redacteur' && cfg['circuit.autovalidation']?.value !== true) {
      const self = new Set([a.redacteur, ...(a.co_redacteurs || [])]);
      const others = holders.filter((h) => !self.has(h));
      if (holders.length && !others.length && !forceScc) return { holders: [], skipped: true, reason: 'auto_validation', via };
      holders = others.length || !forceScc ? others : holders;
    }
    if (!holders.length && r.kind !== 'redacteur') return step.optional ? { holders: [], skipped: true, reason: 'sans_titulaire' } : { holders: [], missing: true };
    return { holders, via };
  }

  /** Parcours complet : étapes déjà franchies (pile) + projection à partir de l'étape courante. */
  async function buildPath(a, graph, { fromKey = null } = {}) {
    const cfg = await settings.resolve(a.organisme_id);
    const facts = await factsOf(a);
    const resolve = (step) => resolveStep(a, step, cfg);
    const proj = await G.projectPath(graph, facts, resolve, { fromKey: fromKey || graph.start });
    for (const ad of a.adhoc_steps || []) {
      const i = proj.findIndex((p) => p.key === ad.afterKey);
      if (i >= 0 && !proj.some((p) => p.key === ad.key)) proj.splice(i + 1, 0, { key: ad.key, label: ad.label, ...(await resolve(ad)), optional: !!ad.optional, canEdit: !!ad.canEdit, nonDelegable: false, slaDays: ad.slaDays ?? null, mode: 'one', adhoc: true });
    }
    return proj;
  }

  async function fullPath(runner, a, graph) {
    const trail = a.trail || [];
    const cur = a.current_step_key;
    const done = [];
    for (const k of trail) {
      if (k === cur) break;
      const inst = await runner.get("SELECT label, holders FROM step_instances WHERE acte_id = $1 AND step_key = $2 ORDER BY id DESC LIMIT 1", [a.id, k]);
      const def = defOf(graph, a, k);
      done.push({ key: k, label: inst?.label || def?.label || k, holders: inst?.holders || [], optional: !!def?.optional, skipped: false, canEdit: !!def?.canEdit, nonDelegable: !!def?.nonDelegable, slaDays: def?.slaDays ?? null, mode: def?.mode || 'one', adhoc: !!def?.key && !G.stepOf(graph, k), traversed: true });
    }
    const future = a.statut === 'brouillon' || !cur ? await buildPath(a, graph) : await buildPath(a, graph, { fromKey: cur });
    if (cur) {
      // l'étape courante garde ses détenteurs réels (réaffectation, départ), pas ceux recalculés
      const inst = await runner.get("SELECT holders FROM step_instances WHERE acte_id = $1 AND status = 'current'", [a.id]);
      const head = future.find((p) => p.key === cur);
      if (inst && head) { head.holders = inst.holders; head.missing = inst.holders.length === 0; }
    }
    return [...done, ...(cur || a.statut === 'brouillon' ? future : [])];
  }

  async function participantsOf(a, path) {
    const holders = new Set(path.flatMap((p) => p.holders));
    const delegs = await delegations.activeFromDelegants(a.organisme_id, [...holders]);
    return [...new Set([a.redacteur, ...(a.co_redacteurs || []), ...holders, ...delegs.map((d) => d.delegue)])];
  }

  async function refreshPath(q, a, graph) {
    const path = await fullPath(q, a, graph);
    const participants = await participantsOf(a, path);
    await q.run('UPDATE actes SET path = $2::jsonb, participants = $3::jsonb WHERE id = $1', [a.id, JSON.stringify(path), JSON.stringify(participants)]);
    return { path, participants };
  }

  const event = (q, a, ctx, action, extra = {}) => q.run(
    'INSERT INTO step_events (acte_id, actor, on_behalf_of, action, from_step, to_step, comment, meta) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
    [a.id, ctx?.username || 'system', extra.onBehalfOf || null, action, extra.from || null, extra.to || null, extra.comment || null, JSON.stringify(extra.meta || {})]);

  async function lock(q, organismeId, id) {
    const a = await q.get('SELECT * FROM actes WHERE id = $1 AND organisme_id = $2 FOR UPDATE', [id, organismeId]);
    if (!a) throw E.notFound('Acte introuvable');
    return a;
  }

  /** Qui a la main sur l'étape courante ? Détenteur, ou délégué (avec le droit demandé). */
  async function actorOf(ctx, a, inst, need) {
    if (inst.holders.includes(ctx.username)) return { ok: true, onBehalfOf: null };
    const graph = await graphOf(a.circuit_version_id);
    const d = await delegations.delegationFor(ctx, a, inst, await typeCodeOf(a.type_id), defOf(graph, a, inst.step_key));
    return d && d.rights?.[need] ? { ok: true, onBehalfOf: d.onBehalfOf } : { ok: false };
  }

  /** Passe à l'étape suivante ; renvoie { acte, events } à émettre après validation de la transaction. */
  async function moveNext(q, a0, fromKey, ctx) {
    let a = a0; const events = [];
    const graph = await graphOf(a.circuit_version_id);
    const cfg = await settings.resolve(a.organisme_id);
    const facts = await factsOf(a);
    const trail = [...(a.trail || [])]; let statut = a.statut === 'modification_demandee' ? 'en_circuit' : a.statut;
    let resume = a.resume_step;
    const applyDone = (def) => {
      if (def?.onDone?.statut) statut = def.onDone.statut;
      if (def?.onDone?.event) events.push([def.onDone.event, { organismeId: a.organisme_id, acteId: a.id }]);
    };
    applyDone(defOf(graph, a, fromKey));
    let cur = fromKey;
    for (let guard = 0; guard < 80; guard++) {
      let key;
      const adhoc = (a.adhoc_steps || []).find((x) => x.afterKey === baseKeyOf(a, cur) && !trail.includes(x.key) && x.key !== cur);
      if (adhoc) key = adhoc.key;
      else if (resume && defOf(graph, a, resume) && !trail.includes(resume)) { key = resume; resume = null; }
      else key = G.nextKey(graph, baseKeyOf(a, cur), facts);
      if (!key) {
        let end = ['en_circuit', 'modification_demandee'].includes(statut) ? 'en_attente_scc' : statut;
        if (end === 'en_attente_scc') {
          // Acte signé par le maire (décision, arrêté) : au lieu d'aller au conseil, il part en signature du maire.
          if ((await typeMetaOf(a.type_id))?.signature) end = 'a_signer';
          else if (a.seance_id) end = 'inscrit_odj'; // déjà inscrit à l'ordre du jour avant la fin du circuit (D57)
        }
        await q.run('UPDATE actes SET current_step_key = NULL, statut = $2, trail = $3::jsonb, resume_step = NULL, return_from = NULL WHERE id = $1', [a.id, end, JSON.stringify(trail)]);
        await event(q, a, ctx, 'complete', { from: cur });
        events.push(['circuit.completed', { organismeId: a.organisme_id, acteId: a.id }]);
        a = await q.get('SELECT * FROM actes WHERE id = $1', [a.id]);
        return { acte: a, events };
      }
      const def = defOf(graph, a, key);
      const r = await resolveStep(a, def, cfg);
      if (r.skipped) {
        await q.run("INSERT INTO step_instances (acte_id, step_key, label, round, status, holders, reason, acted_at) VALUES ($1,$2,$3,$4,'skipped','[]'::jsonb,$5, now())", [a.id, key, def.label, a.circuit_round, r.reason]);
        await event(q, a, ctx, 'skip', { to: key, comment: r.reason });
        events.push(['step.skipped', { organismeId: a.organisme_id, acteId: a.id, stepKey: key, reason: r.reason }]);
        cur = key; continue;
      }
      // Quand la même personne doit valider plusieurs étapes de suite (chef de service puis directeur, par exemple), elle ne valide
      // qu'une fois : les étapes suivantes sont validées implicitement (D69). Désactivable : `circuit.dedupe = false`.
      // L'étape SCC en est exclue : elle reste obligatoire même si son détenteur a validé l'étape précédente.
      const stepScc = def.resolver?.kind === 'groupe' && def.resolver?.code === 'scc';
      if (cfg['circuit.dedupe']?.value !== false && !r.missing && !stepScc && ctx?.username && (def.mode || 'one') === 'one' && r.holders.includes(ctx.username) && fromKey !== graph.start) {
        await q.run("INSERT INTO step_instances (acte_id, step_key, label, round, status, holders, decision, acted_by, acted_at) VALUES ($1,$2,$3,$4,'done',$5::jsonb,'auto',$6, now())", [a.id, key, def.label, a.circuit_round, JSON.stringify(r.holders), ctx.username]);
        trail.push(key); applyDone(def);
        await event(q, a, ctx, 'auto_validate', { to: key });
        cur = key; continue;
      }
      const due = def.slaDays ? addBusinessDays(new Date(), def.slaDays, await holidaysOf(a.organisme_id)) : null;
      await q.run(
        `INSERT INTO step_instances (acte_id, step_key, label, round, status, holders, mode, quorum, sla_days, due_at, adhoc)
         VALUES ($1,$2,$3,$4,'current',$5::jsonb,$6,$7,$8,$9,$10)`,
        [a.id, key, def.label, a.circuit_round, JSON.stringify(r.holders), def.mode || 'one', def.quorum || null, def.slaDays ?? null, due, !G.stepOf(graph, key)]);
      trail.push(key);
      if (def.onEnter?.statut) statut = def.onEnter.statut;
      await q.run("UPDATE actes SET current_step_key = $2, statut = $3, trail = $4::jsonb, resume_step = $5, return_from = CASE WHEN $5::text IS NULL THEN NULL ELSE return_from END WHERE id = $1",
        [a.id, key, statut, JSON.stringify(trail), resume]);
      a = await q.get('SELECT * FROM actes WHERE id = $1', [a.id]);
      await refreshPath(q, a, graph);
      await event(q, a, ctx, 'enter', { from: fromKey, to: key, meta: { holders: r.holders } });
      events.push(['step.entered', { organismeId: a.organisme_id, acteId: a.id, stepKey: key, holders: r.holders, label: def.label, dueAt: due, from: fromKey }]);
      // Événements dédiés pour les directions « en info » : arrivée au SCC et arrivée au DGA (leur homologue).
      if (def.resolver?.kind === 'groupe' && def.resolver?.code === 'scc') events.push(['acte.arrive_scc', { organismeId: a.organisme_id, acteId: a.id, stepKey: key, label: def.label }]);
      if (def.resolver?.kind === 'titulaire' && def.resolver?.fonction === 'dga') events.push(['acte.arrive_dga', { organismeId: a.organisme_id, acteId: a.id, stepKey: key, label: def.label }]);
      if (r.missing) events.push(['circuit.blocked', { organismeId: a.organisme_id, acteId: a.id, stepKey: key, label: def.label }]);
      return { acte: await q.get('SELECT * FROM actes WHERE id = $1', [a.id]), events };
    }
    throw E.conflict('Circuit trop long ou bouclé : vérifiez le graphe');
  }

  const holidaysOf = async (orgId) => {
    const rows = await db.all('SELECT to_char(day, \'YYYY-MM-DD\') AS d FROM holidays WHERE organisme_id IS NULL OR organisme_id = $1', [orgId]).catch(() => []);
    return new Set(rows.map((r) => r.d));
  };

  const emit = async (events) => { for (const [t, p] of events) await bus.emit(t, p); };
  const IS_DRAFTER = (ctx, a) => a.redacteur === ctx.username || (a.co_redacteurs || []).includes(ctx.username);

  const svc = {
    IN_CIRCUIT, graphOf, resolveStep, buildPath, factsOf,

    /** Circuit applicable : le plus spécifique publié (type + direction > type > direction > défaut). */
    async selectCircuit(organismeId, typeId, directionCode) {
      const rows = await db.all(
        `SELECT d.*, v.graph FROM circuit_definitions d JOIN circuit_versions v ON v.id = d.active_version_id
         WHERE d.organisme_id = $1 AND (d.type_acte_id IS NULL OR d.type_acte_id = $2) AND (d.direction_code IS NULL OR d.direction_code = $3)`, [organismeId, typeId, directionCode]);
      rows.sort((x, y) => ((y.type_acte_id ? 2 : 0) + (y.direction_code ? 1 : 0)) - ((x.type_acte_id ? 2 : 0) + (x.direction_code ? 1 : 0)));
      return rows[0] || null;
    },

    async submit(ctx, organismeId, acteId) {
      const a0 = await actes.load(ctx, organismeId, acteId);
      if (!IS_DRAFTER(ctx, a0) && !acl.isAdmin(ctx, a0.organisme_id)) throw E.forbidden("Seul le rédacteur envoie l'acte au circuit");
      if (a0.custom?.entrainement) throw E.conflict('Ceci est un dossier d’entraînement : il ne s’envoie pas au circuit. Créez un vrai dossier pour envoyer.');
      if (!['brouillon', 'modification_demandee'].includes(a0.statut)) throw E.conflict(`Un acte « ${a0.statut} » ne peut pas être envoyé au circuit`);
      const graph0 = a0.circuit_version_id ? await graphOf(a0.circuit_version_id) : null;
      const returned = a0.statut === 'modification_demandee';
      if (returned && a0.current_step_key !== graph0.start) throw E.conflict("L'acte est chez un valideur : il reprend le circuit quand celui-ci valide");
      const comp = await actes.completeness(a0);
      if (!comp.complete) throw E.incomplete('Dossier incomplet : complétez la fiche avant l\'envoi au circuit', comp.missing);
      if (late.deadlines) await late.deadlines.assertCanSubmit(ctx, a0);

      let versionId = a0.circuit_version_id;
      if (!returned) {
        const c = await svc.selectCircuit(a0.organisme_id, a0.type_id, a0.direction_code);
        if (!c) throw E.conflict("Aucun circuit publié pour ce type d'acte et cette direction : demandez à l'administrateur d'en publier un");
        versionId = c.active_version_id;
      }
      const graph = await graphOf(versionId);
      // étapes obligatoires sans titulaire : on refuse l'envoi plutôt que de bloquer l'acte (CIR-21)
      const preview = await buildPath({ ...a0, circuit_version_id: versionId }, graph);
      const missing = preview.filter((p) => p.missing);
      if (missing.length) {
        await bus.emit('circuit.missing_holders', { organismeId: a0.organisme_id, acteId: a0.id, steps: missing.map((m) => ({ key: m.key, label: m.label })) });
        throw E.conflict(`Étape(s) sans titulaire : ${missing.map((m) => m.label).join(', ')} — l'administrateur doit désigner un titulaire`, { steps: missing.map((m) => ({ key: m.key, label: m.label })) });
      }
      if (!returned) await late.texts.startTracking(a0.id, ctx);

      const out = await db.tx(async (q) => {
        const a = await lock(q, a0.organisme_id, a0.id);
        if (!['brouillon', 'modification_demandee'].includes(a.statut)) throw E.conflict('Acte déjà envoyé');
        if (returned) await q.run("UPDATE step_instances SET status = 'done', acted_by = $2, acted_at = now(), decision = 'renvoi' WHERE acte_id = $1 AND status = 'current'", [a.id, ctx.username]);
        else await q.run("INSERT INTO step_instances (acte_id, step_key, label, round, status, holders, acted_by, acted_at, decision) VALUES ($1,$2,$3,$4,'done',$5::jsonb,$6, now(),'envoi')",
          [a.id, graph.start, defOf(graph, a, graph.start)?.label || 'Rédaction', a.circuit_round + 1, JSON.stringify([a.redacteur]), ctx.username]);
        await q.run("UPDATE actes SET statut = 'en_circuit', circuit_version_id = $2, circuit_round = circuit_round + CASE WHEN $3 THEN 0 ELSE 1 END, submitted_at = COALESCE(submitted_at, now()), trail = CASE WHEN $3 THEN trail ELSE $4::jsonb END, current_step_key = $5 WHERE id = $1",
          [a.id, versionId, returned, JSON.stringify([graph.start]), graph.start]);
        const a2 = await q.get('SELECT * FROM actes WHERE id = $1', [a.id]);
        await event(q, a2, ctx, returned ? 'resubmit' : 'submit', { to: graph.start });
        return moveNext(q, a2, graph.start, ctx);
      });
      await audit.log(ctx, { organismeId: a0.organisme_id, action: returned ? 'circuit.resubmit' : 'circuit.submit', entity: 'actes', entityId: a0.id, after: { statut: out.acte.statut, etape: out.acte.current_step_key } });
      await bus.emit('acte.submitted', { organismeId: a0.organisme_id, acteId: a0.id, resubmit: returned, ctx });
      await emit(out.events);
      return svc.view(ctx, organismeId, a0.id);
    },

    async validate(ctx, organismeId, acteId, { comment } = {}) {
      const a0 = await actes.load(ctx, organismeId, acteId);
      const out = await db.tx(async (q) => {
        const a = await lock(q, a0.organisme_id, a0.id);
        if (!IN_CIRCUIT.includes(a.statut) || !a.current_step_key) throw E.conflict("Cet acte n'est pas en attente de validation");
        const graph = await graphOf(a.circuit_version_id);
        if (a.current_step_key === graph.start) throw E.conflict('Renvoyé au rédacteur : il doit le renvoyer au circuit (POST /envoi)');
        const inst = await q.get("SELECT * FROM step_instances WHERE acte_id = $1 AND status = 'current'", [a.id]);
        const who = await actorOf(ctx, a, inst, 'validate');
        if (!who.ok) throw E.forbidden("Ce n'est pas à vous de valider cette étape");
        const actor = who.onBehalfOf || ctx.username;
        // modes « tous » / « quorum » : l'étape ne se ferme que lorsque le seuil est atteint
        if (inst.mode !== 'one') {
          const approvals = (inst.approvals || []).filter((x) => x.holder !== actor);
          approvals.push({ holder: actor, by: ctx.username, at: new Date().toISOString() });
          const need = inst.mode === 'all' ? inst.holders.length : (inst.quorum || 1);
          if (approvals.length < need) {
            await q.run('UPDATE step_instances SET approvals = $2::jsonb WHERE id = $1', [inst.id, JSON.stringify(approvals)]);
            await event(q, a, ctx, 'approve', { from: inst.step_key, onBehalfOf: who.onBehalfOf, comment });
            return { awaiting: { approved: approvals.length, needed: need }, events: [], acte: a };
          }
        }
        await q.run("UPDATE step_instances SET status = 'done', acted_by = $2, on_behalf_of = $3, acted_at = now(), decision = 'validation', comment = $4 WHERE id = $1", [inst.id, ctx.username, who.onBehalfOf, comment || null]);
        await event(q, a, ctx, 'validate', { from: inst.step_key, onBehalfOf: who.onBehalfOf, comment });
        const moved = await moveNext(q, a, inst.step_key, ctx);
        moved.events.unshift(['acte.validated', { organismeId: a.organisme_id, acteId: a.id, stepKey: inst.step_key, by: ctx.username, onBehalfOf: who.onBehalfOf }]);
        return moved;
      });
      if (out.awaiting) return { awaiting: out.awaiting };
      if (comment) await comments.insert({ acteId: a0.id, author: ctx.username, body: comment, stepKey: a0.current_step_key });
      await audit.log(ctx, { organismeId: a0.organisme_id, action: 'circuit.validate', entity: 'actes', entityId: a0.id, before: { etape: a0.current_step_key }, after: { etape: out.acte.current_step_key, statut: out.acte.statut } });
      await emit(out.events);
      return svc.view(ctx, organismeId, a0.id);
    },

    /** Validation par lot (CIR-50) : un échec n'arrête pas les autres. */
    async validateBatch(ctx, organismeId, ids, comment) {
      const results = [];
      for (const id of ids) {
        try { await svc.validate(ctx, organismeId, id, { comment }); results.push({ acteId: id, ok: true }); }
        catch (e) { results.push({ acteId: id, ok: false, error: e.message, code: e.code }); }
      }
      return { results, validated: results.filter((r) => r.ok).length };
    },

    /** Refus : cible « previous » | « first » | clé d'étape antérieure ; reprise « direct » | « complet » choisie par le refuseur. */
    async refuse(ctx, organismeId, acteId, { target, resume, motif }) {
      const a0 = await actes.load(ctx, organismeId, acteId);
      const cfg = await settings.resolve(a0.organisme_id);
      const out = await db.tx(async (q) => {
        const a = await lock(q, a0.organisme_id, a0.id);
        if (!IN_CIRCUIT.includes(a.statut) || !a.current_step_key) throw E.conflict("Cet acte n'est pas en attente de validation");
        const graph = await graphOf(a.circuit_version_id);
        if (a.current_step_key === graph.start) throw E.conflict("L'acte est déjà chez le rédacteur");
        const inst = await q.get("SELECT * FROM step_instances WHERE acte_id = $1 AND status = 'current'", [a.id]);
        const who = await actorOf(ctx, a, inst, 'refuse');
        if (!who.ok) throw E.forbidden("Ce n'est pas à vous de traiter cette étape");
        const trail = a.trail || [];
        const idx = trail.lastIndexOf(a.current_step_key);
        const earlier = trail.slice(0, idx);
        if (!earlier.length) throw E.conflict('Aucune étape antérieure vers laquelle renvoyer');
        let to;
        // sans choix explicite : l'étape de refus définie pour cette étape (D71), à défaut l'étape précédente (-1)
        if (!target) { const cfgTarget = defOf(graph, a, a.current_step_key)?.refusTo; target = cfgTarget && earlier.includes(cfgTarget) ? cfgTarget : 'previous'; }
        if (target === 'previous') to = earlier[earlier.length - 1];
        else if (target === 'first') { if (cfg['circuit.retour_premiere']?.value === false) throw E.forbidden('Le retour à la première étape est désactivé'); to = earlier[0]; }
        else {
          const dk = directionStepKey(graph);
          // Retour à la direction demandé par un DGA : l'étape du directeur peut ne pas avoir été traversée (sautée).
          if (dk && target === dk) to = dk;
          else {
            if (cfg['circuit.refus_cible_libre']?.value === false) throw E.forbidden('Le refus vers une étape au choix est désactivé : « previous » ou « first »');
            if (!earlier.includes(target)) throw E.badRequest(`Étape cible invalide : « ${target} » (étapes antérieures : ${earlier.join(', ')})`);
            to = target;
          }
        }
        const mode = resume || cfg['circuit.reprise']?.value || 'direct';
        const def = defOf(graph, a, to);
        await q.run("UPDATE step_instances SET status = 'returned', acted_by = $2, on_behalf_of = $3, acted_at = now(), decision = 'refus', comment = $4 WHERE id = $1", [inst.id, ctx.username, who.onBehalfOf, motif]);
        let newTrail;
        if (trail.includes(to)) newTrail = trail.slice(0, trail.lastIndexOf(to) + 1);
        else { const proj = await buildPath(a, graph); const idx = proj.findIndex((p) => p.key === to); newTrail = idx >= 0 ? proj.slice(0, idx + 1).map((p) => p.key) : [to]; }
        const r = to === graph.start ? { holders: [a.redacteur, ...(a.co_redacteurs || [])] } : await resolveStep(a, def, cfg);
        const due = def?.slaDays ? addBusinessDays(new Date(), def.slaDays, await holidaysOf(a.organisme_id)) : null;
        await q.run("INSERT INTO step_instances (acte_id, step_key, label, round, status, holders, mode, quorum, sla_days, due_at, adhoc) VALUES ($1,$2,$3,$4,'current',$5::jsonb,$6,$7,$8,$9,$10)",
          [a.id, to, def?.label || to, a.circuit_round, JSON.stringify(r.holders || []), def?.mode || 'one', def?.quorum || null, def?.slaDays ?? null, due, !G.stepOf(graph, to)]);
        await q.run("UPDATE actes SET statut = 'modification_demandee', current_step_key = $2, trail = $3::jsonb, return_from = $4, resume_step = $5 WHERE id = $1",
          [a.id, to, JSON.stringify(newTrail), inst.step_key, mode === 'direct' ? inst.step_key : null]);
        const a2 = await q.get('SELECT * FROM actes WHERE id = $1', [a.id]);
        await refreshPath(q, a2, graph);
        await event(q, a2, ctx, 'refuse', { from: inst.step_key, to, onBehalfOf: who.onBehalfOf, comment: motif, meta: { resume: mode, target } });
        return { acte: a2, to, mode, from: inst.step_key, holders: r.holders || [], onBehalfOf: who.onBehalfOf };
      });
      await comments.insert({ acteId: a0.id, author: ctx.username, body: motif, title: 'Modification demandée', kind: 'refus', stepKey: out.from });
      await audit.log(ctx, { organismeId: a0.organisme_id, action: 'circuit.refuse', entity: 'actes', entityId: a0.id, before: { etape: out.from }, after: { retourA: out.to, reprise: out.mode, motif } });
      await bus.emit('acte.refused', { organismeId: a0.organisme_id, acteId: a0.id, from: out.from, to: out.to, motif, by: ctx.username, holders: out.holders, resume: out.mode });
      return svc.view(ctx, organismeId, a0.id);
    },

    /**
     * Rouvre un acte signé pour modification (décision, arrêté) : la signature est abandonnée, l'acte revient à la
     * dernière étape réellement traversée du circuit (celle qui précédait la signature) pour correction. Une fois
     * cette étape validée de nouveau, le circuit se termine et l'acte repart en signature du maire.
     */
    async reopen(ctx, organismeId, acteId, { motif } = {}) {
      const a0 = await actes.load(ctx, organismeId, acteId);
      if (a0.statut !== 'signe') throw E.conflict('Seul un acte signé peut être rouvert pour modification');
      if (!a0.circuit_version_id) throw E.conflict("Cet acte n'a pas de circuit : impossible de le rouvrir");
      const graph = await graphOf(a0.circuit_version_id);
      const cfg = await settings.resolve(a0.organisme_id);
      const trail = a0.trail || [];
      const to = trail.length ? trail[trail.length - 1] : graph.start;
      const out = await db.tx(async (q) => {
        const a = await lock(q, organismeId, acteId);
        if (a.statut !== 'signe') throw E.conflict('Acte déjà rouvert');
        const def = defOf(graph, a, to);
        const r = to === graph.start ? { holders: [a.redacteur, ...(a.co_redacteurs || [])] } : await resolveStep(a, def, cfg);
        const due = def?.slaDays ? addBusinessDays(new Date(), def.slaDays, await holidaysOf(a.organisme_id)) : null;
        await q.run("INSERT INTO step_instances (acte_id, step_key, label, round, status, holders, mode, quorum, sla_days, due_at, adhoc) VALUES ($1,$2,$3,$4,'current',$5::jsonb,$6,$7,$8,$9,$10)",
          [a.id, to, def?.label || to, a.circuit_round, JSON.stringify(r.holders || []), def?.mode || 'one', def?.quorum || null, def?.slaDays ?? null, due, !G.stepOf(graph, to)]);
        await q.run("UPDATE actes SET statut = 'modification_demandee', current_step_key = $2, signe_at = NULL, signe_par = NULL, parapheur_envoi_id = NULL, return_from = 'signe', resume_step = NULL WHERE id = $1", [a.id, to]);
        const a2 = await q.get('SELECT * FROM actes WHERE id = $1', [a.id]);
        await refreshPath(q, a2, graph);
        await event(q, a2, ctx, 'reopen', { from: 'signe', to, comment: motif, meta: { target: 'previous' } });
        return { acte: a2, to, holders: r.holders || [] };
      });
      if (motif) await comments.insert({ acteId, author: ctx.username, body: motif, title: 'Acte rouvert après signature', kind: 'refus', stepKey: out.to });
      await audit.log(ctx, { organismeId, action: 'circuit.reopen', entity: 'actes', entityId: acteId, before: { statut: 'signe' }, after: { retourA: out.to, motif } });
      await bus.emit('acte.reopened', { organismeId, acteId, to: out.to, motif, by: ctx.username, holders: out.holders });
      return svc.view(ctx, organismeId, acteId);
    },

    /** Recalcule la suite du parcours quand un champ pilote change (CIR-14) ; l'étape courante n'est jamais retirée sous les pieds de son détenteur. */
    async recompute(acteId, ctx) {
      const a = await db.get('SELECT * FROM actes WHERE id = $1', [acteId]);
      if (!a || !IN_CIRCUIT.includes(a.statut) || !a.circuit_version_id || !a.current_step_key) return null;
      const graph = await graphOf(a.circuit_version_id);
      const before = (a.path || []).filter((p) => !p.traversed).map((p) => p.key);
      const { path } = await refreshPath(db, a, graph);
      const after = path.filter((p) => !p.traversed).map((p) => p.key);
      const added = after.filter((k) => !before.includes(k)); const removed = before.filter((k) => !after.includes(k));
      if (added.length || removed.length) {
        await db.run('INSERT INTO step_events (acte_id, actor, action, meta) VALUES ($1,$2,$3,$4::jsonb)', [a.id, ctx?.username || 'system', 'recompute', JSON.stringify({ added, removed })]);
        await bus.emit('circuit.recalculated', { organismeId: a.organisme_id, acteId: a.id, added, removed, labels: path.filter((p) => added.includes(p.key)).map((p) => p.label) });
      }
      return { added, removed, path };
    },

    /** Réaffecte les détenteurs de l'étape courante (départ, absence) — admin, SCC ou directeur (CIR-32). */
    async reassign(ctx, organismeId, acteId, { holders, motif }) {
      const a = await actes.load(ctx, organismeId, acteId);
      const okRole = acl.isAdmin(ctx, a.organisme_id) || (await titulaires.canManage(ctx, a.organisme_id, { directionCode: a.direction_code, serviceCode: null }));
      if (!okRole) throw E.forbidden('Réservé à l\'administrateur, au SCC ou au directeur');
      const inst = await db.get("SELECT * FROM step_instances WHERE acte_id = $1 AND status = 'current'", [a.id]);
      if (!inst) throw E.conflict("Aucune étape en cours");
      const list = [...new Set(holders.map((h) => h.toLowerCase()))];
      if (list.includes(a.redacteur)) throw E.badRequest('Le rédacteur ne peut pas valider son propre acte');
      await db.run('UPDATE step_instances SET holders = $2::jsonb WHERE id = $1', [inst.id, JSON.stringify(list)]);
      const fresh = await db.get('SELECT * FROM actes WHERE id = $1', [a.id]);
      await refreshPath(db, fresh, await graphOf(a.circuit_version_id));
      await db.run('INSERT INTO step_events (acte_id, actor, action, from_step, comment, meta) VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [a.id, ctx.username, 'reassign', inst.step_key, motif, JSON.stringify({ from: inst.holders, to: list })]);
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'circuit.reassign', entity: 'actes', entityId: a.id, before: { holders: inst.holders }, after: { holders: list, motif } });
      await bus.emit('step.entered', { organismeId: a.organisme_id, acteId: a.id, stepKey: inst.step_key, holders: list, label: inst.label, reassigned: true });
      return svc.view(ctx, organismeId, a.id);
    },

    /** Étape ponctuelle pour CET acte seul (ex. avis juridique complémentaire), avec motif tracé (CIR-68). */
    async addAdhocStep(ctx, organismeId, acteId, { afterKey, label, resolver, canEdit = true, slaDays, motif }) {
      const a = await actes.load(ctx, organismeId, acteId);
      const dgs = await titulaires.resolve(a.organisme_id, 'dgs', {});
      if (!acl.isAdmin(ctx, a.organisme_id) && !dgs.some((d) => d.username === ctx.username)) throw E.forbidden('Réservé à l\'administrateur, au SCC ou au DGS');
      if (!IN_CIRCUIT.includes(a.statut) || !a.current_step_key) throw E.conflict("L'acte n'est pas en circuit");
      const graph = await graphOf(a.circuit_version_id);
      if (!defOf(graph, a, afterKey)) throw E.badRequest(`Étape inconnue : ${afterKey}`);
      const key = `adhoc_${(a.adhoc_steps || []).length + 1}`;
      const step = { key, label, resolver, canEdit, slaDays, afterKey };
      await db.run('UPDATE actes SET adhoc_steps = adhoc_steps || $2::jsonb WHERE id = $1', [a.id, JSON.stringify([step])]);
      const fresh = await db.get('SELECT * FROM actes WHERE id = $1', [a.id]);
      await refreshPath(db, fresh, graph);
      await db.run('INSERT INTO step_events (acte_id, actor, action, from_step, comment, meta) VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [a.id, ctx.username, 'adhoc_step', afterKey, motif, JSON.stringify({ step })]);
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'circuit.adhoc', entity: 'actes', entityId: a.id, after: { step, motif } });
      return svc.view(ctx, organismeId, a.id);
    },

    /** Vue du circuit d'un acte : parcours, état de chaque étape, actions possibles pour moi, historique. */
    async view(ctx, organismeId, acteId) {
      const a = await actes.load(ctx, organismeId, acteId);
      if (!a.circuit_version_id) {
        const c = await svc.selectCircuit(a.organisme_id, a.type_id, a.direction_code);
        const path = c ? await buildPath({ ...a, circuit_version_id: c.active_version_id }, c.graph) : [];
        return { acteId: a.id, statut: a.statut, submitted: false, circuit: c ? { definitionId: c.id, nom: c.nom, versionId: c.active_version_id } : null, path: path.map((p) => ({ ...p, ...(!acl.isAdmin(ctx, a.organisme_id) && masqueNoms(G.stepOf(c.graph, p.key)) ? { holders: [], masque: true } : {}), state: 'pending' })), actions: { submit: IS_DRAFTER(ctx, a) || acl.isAdmin(ctx, a.organisme_id), validate: false, refuse: false }, refuseTargets: [], events: [] };
      }
      const graph = await graphOf(a.circuit_version_id);
      const inst = await db.get("SELECT * FROM step_instances WHERE acte_id = $1 AND status = 'current'", [a.id]);
      const stored = a.path && a.path.length ? a.path : await fullPath(db, a, graph);
      const trail = a.trail || []; const curIdx = trail.indexOf(a.current_step_key);
      const instances = await db.all('SELECT * FROM step_instances WHERE acte_id = $1 ORDER BY id', [a.id]);
      let path = stored.map((p) => {
        const mine = instances.filter((i) => i.step_key === p.key);
        const last = mine[mine.length - 1];
        let state = 'pending';
        if (p.key === a.current_step_key) state = 'current';
        else if (trail.includes(p.key) && trail.indexOf(p.key) < (curIdx < 0 ? trail.length : curIdx)) state = 'done';
        else if (last?.status === 'skipped') state = 'skipped';
        if (p.skipped && state === 'pending') state = 'skipped';
        return { ...p, state, instance: last ? { status: last.status, arrivedAt: last.arrived_at, actedAt: last.acted_at, actedBy: last.acted_by, onBehalfOf: last.on_behalf_of, decision: last.decision, dueAt: last.due_at, approvals: last.approvals } : null };
      });
      const masques = acl.isAdmin(ctx, a.organisme_id) ? new Set() : new Set(path.filter((p) => masqueNoms(defOf(graph, a, p.key))).map((p) => p.key));
      path = path.map((p) => (masques.has(p.key) ? { ...p, holders: [], masque: true, instance: p.instance ? { ...p.instance, actedBy: null, onBehalfOf: null } : p.instance } : p));
      const events = (await db.all('SELECT * FROM step_events WHERE acte_id = $1 ORDER BY id', [a.id])).map((e) => ({ id: Number(e.id), at: e.at, actor: e.actor, onBehalfOf: e.on_behalf_of, action: e.action, from: e.from_step, to: e.to_step, comment: e.comment, meta: e.meta }))
        .map((e) => (masques.has(e.from) || masques.has(e.to) ? { ...e, actor: masques.has(e.from) ? null : e.actor, onBehalfOf: null, masque: true, meta: e.meta ? { ...e.meta, holders: undefined } : e.meta } : e));
      let canValidate = false; let canRefuse = false; let onBehalfOf = null;
      if (inst && IN_CIRCUIT.includes(a.statut) && a.current_step_key !== graph.start) {
        const v = await actorOf(ctx, a, inst, 'validate'); const r = await actorOf(ctx, a, inst, 'refuse');
        canValidate = v.ok; canRefuse = r.ok; onBehalfOf = v.onBehalfOf || r.onBehalfOf;
      }
      const returnedToMe = a.statut === 'modification_demandee' && a.current_step_key === graph.start && (IS_DRAFTER(ctx, a) || acl.isAdmin(ctx, a.organisme_id));
      const baseTargets = curIdx > 0 && canRefuse ? trail.slice(0, curIdx).map((k) => ({ key: k, label: path.find((p) => p.key === k)?.label || k, first: k === trail[0] })) : [];
      let targets = baseTargets;
      // Le DGA peut aussi renvoyer l'acte à la direction (étape du directeur), même si elle a été sautée.
      const curDef = a.current_step_key ? defOf(graph, a, a.current_step_key) : null;
      if (canRefuse && curDef?.resolver?.kind === 'titulaire' && curDef.resolver.fonction === 'dga') {
        const dk = directionStepKey(graph);
        if (dk) targets = targets.some((t) => t.key === dk) ? targets.map((t) => (t.key === dk ? { ...t, label: 'Direction' } : t)) : [...targets, { key: dk, label: 'Direction', first: false }];
      }
      const prevKey = baseTargets.length ? baseTargets[baseTargets.length - 1].key : null;
      return {
        acteId: a.id, statut: a.statut, submitted: true, versionId: a.circuit_version_id, currentStepKey: a.current_step_key, round: a.circuit_round,
        blocked: !!inst && inst.holders.length === 0, resume: a.resume_step ? { step: a.resume_step, from: a.return_from } : null,
        path, refuseTargets: targets, previous: prevKey,
        refuseDefault: (() => { const c = defOf(graph, a, a.current_step_key)?.refusTo; return c && targets.some((x) => x.key === c) ? c : prevKey; })(),
        actions: { submit: returnedToMe, validate: canValidate, refuse: canRefuse, onBehalfOf },
        due: inst?.due_at || null, late: !!inst?.due_at && new Date(inst.due_at) < new Date(), events,
      };
    },

    /** Ma file de travail : actes en attente de MA validation (titulaire ou délégué) et actes renvoyés à mon attention. */
    async todo(ctx, organismeId) {
      const org = organismeId;
      const delegants = (await delegations.activeForDelegue(org, ctx.username)).map((d) => d.delegant);
      const rows = await db.all(
        `SELECT a.*, i.step_key, i.label AS step_label, i.holders AS holders, i.arrived_at, i.due_at, i.mode, i.id AS inst_id, i.approvals, i.sla_days, t.code AS type_code, t.libelle AS type_libelle
         FROM step_instances i JOIN actes a ON a.id = i.acte_id LEFT JOIN ref_items t ON t.id = a.type_id
         WHERE i.status = 'current' AND a.organisme_id = $1 AND a.statut IN ('en_circuit', 'modification_demandee', 'en_attente_scc') AND i.holders ?| $2::text[]
         ORDER BY i.due_at NULLS LAST, i.arrived_at`, [org, [ctx.username, ...delegants]]);
      const items = [];
      for (const r of rows) {
        const graph = await graphOf(r.circuit_version_id);
        if (r.step_key === graph.start && !IS_DRAFTER(ctx, r)) continue;
        const inst = { step_key: r.step_key, holders: r.holders };
        const who = r.step_key === graph.start ? { ok: IS_DRAFTER(ctx, r) } : await actorOf(ctx, r, inst, 'validate');
        if (!who.ok) continue;
        const already = (r.approvals || []).some((x) => x.holder === (who.onBehalfOf || ctx.username));
        if (already) continue;
        items.push({ acte: actes.toActe(r), step: { key: r.step_key, label: r.step_label, arrivedAt: r.arrived_at, dueAt: r.due_at, late: !!r.due_at && new Date(r.due_at) < new Date(), onBehalfOf: who.onBehalfOf || null, returned: r.statut === 'modification_demandee' } });
      }
      const returned = await db.all("SELECT a.* FROM actes a WHERE a.organisme_id = $1 AND a.statut = 'modification_demandee' AND (a.redacteur = $2 OR a.co_redacteurs ? $2)", [org, ctx.username]);
      for (const r of returned) if (!items.some((i) => i.acte.id === r.id)) items.push({ acte: actes.toActe(r), step: { key: r.current_step_key, label: 'À modifier', returned: true } });
      await actes.attachSeance(items.map((i) => i.acte));
      return items;
    },

    /**
     * Suivi du tableau de bord : (1) les actes que mes collaborateurs (N-x, selon mes fonctions de titulaire) rédigent ou font
     * valider ; (2) les actes que J'AI validés et qui poursuivent leur circuit.
     */
    async tracking(ctx, organismeId) {
      const org = organismeId;
      const step = (r) => (r.cur_key ? { key: r.cur_key, label: r.cur_label, holders: r.cur_holders, dueAt: r.cur_due, late: !!r.cur_due && new Date(r.cur_due) < new Date() } : null);
      // étape en cours ; les noms des détenteurs sont retirés pour les étapes réglées « sans noms » (juridique, financier, SCC par défaut)
      const shape = async (r, extra = {}) => {
        const st = step(r);
        if (st && r.circuit_version_id) { const g = await graphOf(r.circuit_version_id); if (masqueNoms(defOf(g, r, st.key))) { st.holders = []; st.masque = true; } }
        return { acte: actes.toActe(r), step: st, ...extra };
      };
      const validated = (await db.all(
        `SELECT DISTINCT ON (a.id) a.*, i.step_key AS cur_key, i.label AS cur_label, i.holders AS cur_holders, i.due_at AS cur_due, my.acted_at AS my_at, my.label AS my_label, t.code AS type_code, t.libelle AS type_libelle
         FROM actes a JOIN step_instances my ON my.acte_id = a.id AND (my.acted_by = $2 OR my.on_behalf_of = $2) AND my.decision IN ('validation', 'auto')
              LEFT JOIN step_instances i ON i.acte_id = a.id AND i.status = 'current'
              LEFT JOIN ref_items t ON t.id = a.type_id
         WHERE a.organisme_id = $1 AND a.current_step_key IS NOT NULL AND a.statut IN ('en_circuit', 'modification_demandee', 'en_attente_scc')
           AND NOT (COALESCE(i.holders, '[]'::jsonb) ? $2)
         ORDER BY a.id, my.acted_at DESC`, [org, ctx.username]))
        .sort((x, y) => new Date(y.my_at) - new Date(x.my_at));
      const validatedShaped = await Promise.all(validated.map((r) => shape(r, { validatedAt: r.my_at, validatedStep: r.my_label })));

      const h = await titulaires.hierarchyScope(ctx.username, org);
      const isDgs = (await titulaires.resolve(org, 'dgs', {})).some((t) => t.username === ctx.username || t.suppleant === ctx.username);
      let team = [];
      if (isDgs || h.dgaOrganisme || h.directions.length || h.services.length) {
        const p = [org, ctx.username]; const or = [];
        if (isDgs || h.dgaOrganisme) or.push('TRUE');
        if (h.directions.length) { p.push(h.directions); or.push(`a.direction_code = ANY($${p.length}::text[])`); }
        for (const [d, sv] of h.services) { p.push(d, sv); or.push(`(a.direction_code = $${p.length - 1} AND a.service_code = $${p.length})`); }
        team = (await db.all(
          `SELECT a.*, i.step_key AS cur_key, i.label AS cur_label, i.holders AS cur_holders, i.due_at AS cur_due, t.code AS type_code, t.libelle AS type_libelle
           FROM actes a LEFT JOIN step_instances i ON i.acte_id = a.id AND i.status = 'current'
           LEFT JOIN ref_items t ON t.id = a.type_id
           WHERE a.organisme_id = $1 AND a.redacteur <> $2 AND (${or.join(' OR ')})
             AND ((a.statut IN ('brouillon', 'modification_demandee', 'en_circuit') ) OR (a.statut = 'en_attente_scc' AND a.current_step_key IS NOT NULL))
             AND NOT (COALESCE(i.holders, '[]'::jsonb) ? $2)
           ORDER BY a.updated_at DESC LIMIT 200`, p));
        team = await Promise.all(team.map((r) => shape(r, { phase: r.statut === 'brouillon' ? 'redaction' : r.statut === 'modification_demandee' ? 'correction' : 'validation' })));
      }
      await actes.attachSeance([...team, ...validatedShaped].map((t) => t.acte));
      return { equipe: team, valides: validatedShaped };
    },

    /**
     * Mon portefeuille : TOUS les actes non encore passés au conseil qui me concernent —
     * action attendue de moi, rédaction/validation par mon équipe, acte que j'ai validé et qui poursuit son circuit,
     * acte qui n'est plus à mon étape (encore en circuit chez un autre, ou circuit terminé sans être passé en séance).
     * Le retard est distingué (étape courante dépassée) ; `valide` signale un circuit entièrement validé.
     */
    async portefeuille(ctx, organismeId) {
      const org = organismeId;
      const [todos, suivi] = await Promise.all([svc.todo(ctx, org), svc.tracking(ctx, org)]);
      const map = new Map();
      const put = (acte, raison, step) => {
        const e = map.get(acte.id) || { acte, raisons: new Set(), step: null };
        e.raisons.add(raison);
        if (step?.dueAt && (!e.step?.dueAt || new Date(step.dueAt) < new Date(e.step.dueAt))) e.step = step;
        else if (step && !e.step) e.step = step;
        map.set(acte.id, e);
      };
      for (const t of todos) put(t.acte, 'action', t.step);
      // Mes propres brouillons en rédaction (non encore envoyés) : ils me concernent au premier chef, y compris
      // une décision qui ne vise aucune séance (elle ne passera pas au conseil).
      const mesBrouillons = await db.all(
        `SELECT a.*, t.code AS type_code, t.libelle AS type_libelle FROM actes a LEFT JOIN ref_items t ON t.id = a.type_id
         WHERE a.organisme_id = $1 AND a.statut = 'brouillon' AND (a.redacteur = $2 OR a.co_redacteurs ? $2)`,
        [org, ctx.username]);
      for (const r of mesBrouillons) put(actes.toActe(r), 'mes_brouillons', { key: 'redaction', label: 'Rédaction' });
      for (const t of suivi.equipe) put(t.acte, t.phase ?? 'validation', t.step);
      for (const t of suivi.valides) put(t.acte, 'valide', t.step);
      // « Plus à moi » (rubrique « Dans le circuit » de l'écran « Mes actes ») : les actes que je suis qui ne sont plus à mon étape — encore en circuit chez un autre,
      // ou circuit terminé/validé sans être encore passé en séance (périmètre : moi et mon équipe hiérarchique).
      const h = await titulaires.hierarchyScope(ctx.username, org);
      const isDgs = (await titulaires.resolve(org, 'dgs', {})).some((t) => t.username === ctx.username || t.suppleant === ctx.username);
      const p = [org, ctx.username]; const or = ['a.redacteur = $2', 'a.co_redacteurs ? $2'];
      if (isDgs || h.dgaOrganisme) or.push('TRUE');
      if (h.directions.length) { p.push(h.directions); or.push(`a.direction_code = ANY($${p.length}::text[])`); }
      for (const [d, sv] of h.services) { p.push(d, sv); or.push(`(a.direction_code = $${p.length - 1} AND a.service_code = $${p.length})`); }
      p.push(IN_CIRCUIT, POST_CIRCUIT);
      const poursuite = await db.all(
        `SELECT a.*, i.label AS cur_label, i.step_key AS cur_key, i.holders AS cur_holders, i.due_at AS cur_due, t.code AS type_code, t.libelle AS type_libelle
         FROM actes a LEFT JOIN step_instances i ON i.acte_id = a.id AND i.status = 'current'
         LEFT JOIN ref_items t ON t.id = a.type_id
         WHERE a.organisme_id = $1 AND (${or.join(' OR ')})
           AND ((a.statut = ANY($${p.length - 1}::text[]) AND a.current_step_key IS NOT NULL)
             OR (a.statut = ANY($${p.length}::text[]) AND a.current_step_key IS NULL))
           AND NOT (COALESCE(i.holders, '[]'::jsonb) ? $2)`, p);
      for (const r of poursuite) {
        const step = r.current_step_key
          ? { key: r.cur_key, label: r.cur_label || r.cur_key, holders: r.cur_holders, dueAt: r.cur_due, late: !!r.cur_due && new Date(r.cur_due) < new Date() }
          : { key: r.statut, label: ETAPE_HORS_CIRCUIT[r.statut] || r.statut };
        put(actes.toActe(r), 'poursuite', step);
      }
      const items = [...map.values()].map((e) => ({
        acte: e.acte, raisons: [...e.raisons], step: e.step,
        enRetard: !!(e.step?.dueAt && new Date(e.step.dueAt) < new Date()),
        valide: !e.acte.currentStepKey && e.acte.statut !== 'brouillon',
      }));
      items.sort((x, y) => (Number(y.enRetard) - Number(x.enRetard)) || ((x.step?.dueAt ? new Date(x.step.dueAt) : Infinity) - (y.step?.dueAt ? new Date(y.step.dueAt) : Infinity)) || (y.acte.id - x.acte.id));
      await actes.attachSeance(items.map((i) => i.acte));
      return { items };
    },

    /** Tous les actes non encore passés au conseil, avec leur état courant (étape) et la séance pressentie — pour la vue admin/SCC. */
    async enCours(ctx, organismeId) {
      const org = organismeId;
      const rows = await db.all(
        `SELECT a.*, i.label AS cur_label, i.step_key AS cur_key, i.holders AS cur_holders, i.due_at AS cur_due, t.code AS type_code, t.libelle AS type_libelle
         FROM actes a LEFT JOIN step_instances i ON i.acte_id = a.id AND i.status = 'current'
         LEFT JOIN ref_items t ON t.id = a.type_id
         WHERE a.organisme_id = $1 AND a.statut = ANY($2::text[])
         ORDER BY a.updated_at DESC LIMIT 1000`, [org, EN_COURS_ACTIFS]);
      const items = rows.map((r) => {
        const etape = r.statut === 'brouillon' ? { key: 'redaction', label: 'Rédaction' }
          : r.statut === 'modification_demandee' ? { key: 'correction', label: 'À corriger' }
            : r.cur_key ? { key: r.cur_key, label: r.cur_label || r.cur_key, holders: r.cur_holders, dueAt: r.cur_due, late: !!r.cur_due && new Date(r.cur_due) < new Date() }
              : { key: r.statut, label: ETAPE_HORS_CIRCUIT[r.statut] || r.statut };
        return { acte: actes.toActe(r), etape, enRetard: !!etape.late };
      });
      await actes.attachSeance(items.map((i) => i.acte));
      return { items };
    },

    async lateActes(ctx, organismeId) {
      const rows = await db.all(
        `SELECT a.*, i.step_key, i.label AS step_label, i.holders, i.due_at, t.code AS type_code, t.libelle AS type_libelle FROM step_instances i JOIN actes a ON a.id = i.acte_id LEFT JOIN ref_items t ON t.id = a.type_id
         WHERE i.status = 'current' AND a.organisme_id = $1 AND i.due_at < now() ORDER BY i.due_at`, [organismeId]);
      const out = [];
      for (const r of rows) if (await acl.canView(ctx, r)) out.push({ acte: actes.toActe(r), step: { key: r.step_key, label: r.step_label, holders: r.holders, dueAt: r.due_at } });
      return out;
    },

    /** Simulation d'un parcours (CIR-62) : qui serait désigné à chaque étape pour ce cas ? */
    async simulate(organismeId, graph, { typeCode, directionCode, serviceCode, redacteur = 'simulation', facts = {} }) {
      const pseudo = { id: 0, organisme_id: organismeId, direction_code: directionCode, service_code: serviceCode || null, redacteur, co_redacteurs: [], adhoc_steps: [], custom: {} };
      const cfg = await settings.resolve(organismeId);
      const path = await G.projectPath(graph, { typeCode, directionCode, serviceCode, custom: {}, ...facts }, (step) => resolveStep(pseudo, step, cfg));
      return { path, blocked: path.filter((p) => p.missing).map((p) => ({ key: p.key, label: p.label })) };
    },
  };

  // le détenteur d'une étape éditable modifie l'acte pendant qu'il l'a (et son délégué si le droit « edit » est transmis)
  acl.registerEditHook(async (ctx, a) => {
    if (!IN_CIRCUIT.includes(a.statut) || !a.current_step_key || !a.circuit_version_id) return false;
    const graph = await graphOf(a.circuit_version_id);
    const def = defOf(graph, a, a.current_step_key);
    if (!def?.canEdit || a.current_step_key === graph.start) return false;
    const inst = await db.get("SELECT * FROM step_instances WHERE acte_id = $1 AND status = 'current'", [a.id]);
    if (!inst) return false;
    return (await actorOf(ctx, a, inst, 'edit')).ok || inst.holders.includes(ctx.username);
  });
  bus.on('acte.driver_changed', (p) => svc.recompute(p.acteId, p.ctx));
  bus.on('delegation.created', async (p) => { await refreshHolderActes(p.organismeId, p.delegation.delegant); });
  bus.on('delegation.revoked', async (p) => { await refreshHolderActes(p.organismeId, p.delegation.delegant); });
  async function refreshHolderActes(orgId, delegant) {
    const rows = await db.all("SELECT a.* FROM actes a WHERE a.organisme_id = $1 AND a.statut IN ('en_circuit','modification_demandee','en_attente_scc') AND a.current_step_key IS NOT NULL AND a.path::text LIKE $2", [orgId, `%"${delegant}"%`]);
    for (const a of rows) await refreshPath(db, a, await graphOf(a.circuit_version_id));
  }

  return svc;
}

module.exports = { createEngine, IN_CIRCUIT };
