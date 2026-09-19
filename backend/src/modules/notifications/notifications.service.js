/**
 * Notifications, relances et échéances (section 22).
 *  - règles éditables (plateforme → surcharge par organisme), gabarits à variables, destinataires par résolveurs ;
 *  - événements (bus) et relances temporelles (paliers en jours ouvrés, arrêt dès que l'action est faite) ;
 *  - une ligne de journal par (destinataire, message), idempotente par clé ; envoi différé dans la plage 8 h – 18 h ;
 *  - anti-spam : regroupement par destinataire, plafond quotidien, synthèse quotidienne ; préférences et sourdine ;
 *  - centre de notifications dans l'outil ; simulateur « à la date D, qui recevrait quoi ? » sans rien envoyer.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const { addBusinessDays, parisParts, nextSendWindow, isBusinessDay } = require('../../shared/time');
const { FAMILIES, RULES } = require('./defaults');
const G = require('../circuit/graph');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ESC[c]);
const render = (tpl, vars) => String(tpl).replace(/\{([a-z_]+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));
const HIERARCHY = ['responsable_intermediaire', 'chef_service', 'directeur', 'dga', 'dgs'];
const MAX_ATTEMPTS = 6;
const fmtDate = (d) => (d ? new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long' }).format(new Date(d)) : 'non définie');

const toRule = (r) => ({
  id: r.id, code: r.code, nom: r.nom, family: r.family, kind: r.kind, trigger: r.trigger, condition: r.condition, recipients: r.recipients, channels: r.channels,
  palliers: r.palliers, subject: r.subject, body: r.body, mandatory: r.mandatory, enabled: r.enabled, origin: r.organisme_id ? 'organisme' : 'plateforme', updatedBy: r.updated_by, updatedAt: r.updated_at,
});

function createNotifications({ db, audit, mail, engine, titulaires, delegations, settings, bus, config, log, actes, acl, late }) {
  const linkOf = (orgId, acteId) => `${config.publicBaseUrl}/organismes/${orgId}/actes/${acteId}`;

  // ---------------------------------------------------------------------------------------------------- règles
  async function effectiveRules(orgId) {
    const rows = await db.all('SELECT * FROM notification_rules WHERE organisme_id IS NULL OR organisme_id = $1', [orgId]);
    const byCode = new Map();
    for (const r of rows.sort((a, b) => (a.organisme_id ? 1 : 0) - (b.organisme_id ? 1 : 0))) byCode.set(r.code, r); // la surcharge d'organisme l'emporte
    return [...byCode.values()].map(toRule);
  }

  const holidaysOf = async (orgId) => new Set((await db.all("SELECT to_char(day, 'YYYY-MM-DD') AS d FROM holidays WHERE organisme_id IS NULL OR organisme_id = $1", [orgId])).map((r) => r.d));

  // ----------------------------------------------------------------------------------------- destinataires
  async function usersWithRole(orgId, role) {
    return (await db.all('SELECT DISTINCT username FROM user_org_roles WHERE organisme_id = $1 AND role = $2', [orgId, role])).map((r) => r.username);
  }
  const fonctionUsers = async (orgId, fonction, a) => (await titulaires.resolve(orgId, fonction, { directionCode: a.direction_code, serviceCode: a.service_code })).flatMap((t) => [t.username, t.suppleant].filter(Boolean));

  /** Résout une liste de résolveurs en identifiants. `ctx` : { acte, inst, payload }. */
  async function resolveRecipients(orgId, resolvers, { acte, inst, payload = {} }) {
    const out = new Set();
    for (const r of resolvers) {
      let list = [];
      if (r === 'redacteur') list = [acte.redacteur, ...(acte.co_redacteurs || [])];
      else if (r === 'holders') list = inst?.holders || payload.holders || [];
      else if (r === 'delegues') list = (await delegations.activeFromDelegants(orgId, inst?.holders || payload.holders || [])).map((d) => d.delegue);
      else if (r === 'circuit') list = acte.participants || [];
      else if (r === 'mentions') list = payload.comment?.mentions || [];
      else if (r === 'delegue') list = [payload.delegation?.delegue];
      else if (r === 'grantee') list = [payload.grant?.username];
      else if (r === 'deciders') list = await late.deadlines.deciders(orgId);
      else if (r === 'demandeur') list = [payload.derogation?.demandeur];
      else if (r === 'rapporteur') list = acte.rapporteur_id ? [`elu:${acte.rapporteur_id}`] : [];
      else if (r === 'commission_membres') list = payload.commissionId ? (await late.commissions.recipients(payload.commissionId)).elus : [];
      else if (r === 'commission_secretaires') list = payload.commissionId ? (await late.commissions.recipients(payload.commissionId)).secretaires : [];
      else if (r === 'admins') list = await usersWithRole(orgId, 'org_admin');
      else if (r === 'scc') list = [...await usersWithRole(orgId, 'scc'), ...await titulaires.groupMembers(orgId, 'scc')];
      else if (r === 'superieur') {
        const graph = acte.circuit_version_id ? await engine.graphOf(acte.circuit_version_id) : null;
        const step = graph && inst ? G.stepOf(graph, inst.step_key) : null;
        const f = step?.resolver?.kind === 'titulaire' ? HIERARCHY[HIERARCHY.indexOf(step.resolver.fonction) + 1] : 'directeur';
        if (f) list = await fonctionUsers(orgId, f, acte);
      } else if (HIERARCHY.includes(r)) list = await fonctionUsers(orgId, r, acte);
      else if (r.startsWith('agent:')) list = [r.slice(6)];
      for (const u of list) if (u) out.add(String(u).toLowerCase());
    }
    return out;
  }

  const emailsOf = async (usernames) => {
    if (!usernames.length) return new Map();
    const elus = usernames.filter((u) => u.startsWith('elu:')).map((u) => Number(u.slice(4)));
    const rows = await db.all('SELECT username, email FROM agent_ref WHERE username = ANY($1::text[])', [usernames]);
    const map = new Map(rows.map((r) => [r.username, r.email]));
    if (elus.length) for (const e of await db.all('SELECT id, email FROM elus WHERE id = ANY($1::int[])', [elus])) map.set(`elu:${e.id}`, e.email);
    return map;
  };
  const nameOf = async (username) => (username.startsWith('elu:') ? (await db.get("SELECT trim(prenom || ' ' || nom) AS n FROM elus WHERE id = $1", [Number(username.slice(4))]))?.n : null) || (await db.get('SELECT display_name FROM agent_ref WHERE username = $1', [username]))?.display_name || username;

  // ------------------------------------------------------------------------------------------- livraison
  const isMuted = async (acteId, username) => !!(await db.get('SELECT 1 AS x FROM notification_mutes WHERE acte_id = $1 AND until > now() AND (username IS NULL OR username = $2) LIMIT 1', [acteId, username]));

  /**
   * Crée, pour chaque destinataire, une ligne de journal (idempotente par clé) et, selon les préférences, la notification
   * dans l'outil et le mail en attente. `dryRun` : ne fait que dire ce qui serait envoyé.
   */
  async function deliver({ orgId, rule, acte, usernames, vars, keyBase, actor, immediate = false, force = false, dryRun = false, at = new Date() }) {
    const subject = render(rule.subject, vars); const body = render(rule.body, vars);
    const list = [...usernames].filter((u) => force || rule.mandatory || u !== actor);
    const emails = await emailsOf(list);
    const holidays = await holidaysOf(orgId);
    const cap = (await settings.resolve(orgId))['notifications.plafond_quotidien']?.value ?? 20;
    const out = [];
    for (const u of list) {
      const key = keyBase ? `${keyBase}:${u}` : null;
      if (key && await db.get('SELECT 1 AS x FROM notification_log WHERE dedupe_key = $1', [key])) continue;
      const pref = force || rule.mandatory ? 'immediate' : (await db.get('SELECT mode FROM notification_prefs WHERE organisme_id = $1 AND username = $2 AND family = $3', [orgId, u, rule.family]))?.mode || 'immediate';
      const muted = !force && acte && await isMuted(acte.id, u);
      const channels = rule.channels || ['inapp', 'mail'];
      let status = 'pending'; let skip = null; const email = emails.get(u) || null;
      if (muted) { status = 'skipped'; skip = 'muted'; }
      else if (pref === 'off') { status = 'skipped'; skip = 'pref_off'; }
      else if (!channels.includes('mail')) status = 'sent';
      else if (!email) { status = 'skipped'; skip = 'no_email'; }
      else if (pref === 'digest') status = 'digest';
      const next = immediate ? at : nextSendWindow(at, holidays);
      const item = { recipient: u, email, subject, body, status, skip, rule: rule.code, acteId: acte?.id ?? null, key, sendAfter: next, capReached: false };
      out.push(item);
      if (dryRun) continue;
      const row = await db.get(
        `INSERT INTO notification_log (organisme_id, dedupe_key, rule_code, family, acte_id, recipient, email, channel, subject, body, status, skip_reason, next_attempt_at, sent_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, CASE WHEN $11 = 'sent' THEN now() END)
         ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING id`,
        [orgId, key, rule.code, rule.family, acte?.id ?? null, u, email, channels.includes('mail') ? 'mail' : 'inapp', subject, body, status, skip, next]);
      if (!row) continue;
      if (channels.includes('inapp') && !muted && pref !== 'off') {
        await db.run('INSERT INTO notifications (organisme_id, username, family, rule_code, acte_id, title, body, link) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [orgId, u, rule.family, rule.code, acte?.id ?? null, subject, body, acte ? linkOf(orgId, acte.id) : null]);
      }
      void cap;
    }
    return out;
  }

  async function varsOf(acte, extra = {}) {
    const org = await db.get('SELECT nom FROM organismes WHERE id = $1', [acte.organisme_id]);
    const inst = extra.inst;
    const due = inst?.due_at || extra.dueAt || null;
    const late = due && new Date(due) < new Date();
    return {
      titre: acte.titre, numero: acte.numero_suivi, etape: extra.etape || inst?.label || '', lien: linkOf(acte.organisme_id, acte.id), redacteur: await nameOf(acte.redacteur),
      organisme: org?.nom || '', echeance: fmtDate(due), arrivee: fmtDate(inst?.arrived_at || extra.arrivedAt), retard: due ? (late ? 'en retard' : 'dans les temps') : 'sans échéance',
      jours_restants: due ? Math.ceil((new Date(due) - new Date()) / 86400000) : '', ...extra.vars,
    };
  }

  // ------------------------------------------------------------------------------------------- événements
  const EVENT_MAP = ['step.entered', 'acte.refused', 'circuit.completed', 'circuit.recalculated', 'comment.added', 'delegation.created', 'redaction.granted', 'circuit.blocked', 'circuit.published', 'circuit.missing_holders',
  'derogation.requested', 'derogation.decided', 'commission.mise_a_disposition', 'commission.suspendue', 'commission.retiree', 'commission.avis', 'acte.seance_changed', 'odj.arrete', 'odj.modifie'];

  async function onEvent(type, p) {
    const orgId = p.organismeId; if (!orgId) return;
    const evt = type === 'circuit.missing_holders' ? 'circuit.blocked' : type;
    const rules = (await effectiveRules(orgId)).filter((r) => r.kind === 'event' && r.enabled && r.trigger.event === evt);
    if (!rules.length) return;
    const acte = p.acteId ? await db.get('SELECT * FROM actes WHERE id = $1', [p.acteId]) : null;
    const inst = acte ? await db.get("SELECT * FROM step_instances WHERE acte_id = $1 AND status = 'current' ORDER BY id DESC LIMIT 1", [acte.id]) : null;
    const actor = p.ctx?.username || p.by || p.comment?.author || p.delegation?.delegant || null;
    for (const rule of rules) {
      if (rule.condition && acte && !G.evalCondition(rule.condition, await engine.factsOf(acte))) continue;
      const payload = { ...p, holders: p.holders };
      const users = await resolveRecipients(orgId, rule.recipients, { acte: acte || {}, inst, payload });
      if (!users.size) continue;
      const actorName = actor ? await nameOf(actor) : '';
      const vars = acte ? await varsOf(acte, { inst, etape: p.label || p.steps?.map((s) => s.label).join(', '), dueAt: p.dueAt, vars: {
        acteur: actorName, motif: p.motif || p.derogation?.decisionMotif || p.derogation?.motif || p.comment?.body || (p.avis ? `avis ${p.avis}` : ''), ajoutees: (p.labels || []).join(', '),
        commission: p.commissionNom || '', numero_odj: p.numero || '', ordre_odj: p.ordre || '', decision: p.derogation?.statut === 'accordee' ? 'accordé' : p.derogation?.statut === 'refusee' ? 'refusé' : '',
      } }) : { acteur: actorName, version: p.version, circuit: p.circuitName || '', portee: p.delegation?.scope || '', direction: p.grant?.directionCode || '' };
      if (p.circuitName === undefined && type === 'circuit.published') vars.circuit = (await db.get('SELECT nom FROM circuit_definitions WHERE id = $1', [p.definitionId]))?.nom || '';
      await deliver({ orgId, rule, acte, usernames: users, vars, keyBase: null, actor, immediate: true });
    }
  }
  for (const t of EVENT_MAP) bus.on(t, (p) => onEvent(t, p).catch((e) => log.error({ err: e.message, type: t }, 'notification événementielle en erreur')));

  // ----------------------------------------------------------------------------------- relances temporelles
  /** Instant d'un palier pour un acte / une étape (jours ouvrés). */
  function palierTimes(p, { arrival, due, updated, sla, deadline }, holidays, now) {
    const at = p.at || {};
    let base;
    if (at.base === 'arrival') base = arrival ? addBusinessDays(new Date(arrival), sla && at.slaFactor ? sla * at.slaFactor : 0, holidays) : null;
    else if (at.base === 'due') base = due ? new Date(due) : null;
    else if (at.base === 'updated') base = updated ? new Date(updated) : null;
    else if (at.base === 'deadline') base = deadline ? new Date(deadline) : null;
    if (!base) return null;
    const t0 = at.days ? addBusinessDays(base, at.days, holidays) : base;
    if (!p.repeat) return { t: t0, n: 0 };
    let n = 0; let t = t0;
    while (n < (p.repeat.max ?? 1)) { const nx = addBusinessDays(t0, p.repeat.everyDays * (n + 1), holidays); if (nx > now) break; n++; t = nx; }
    return { t, n };
  }

  /** Relances dues à l'instant `now` (sans effet de bord si dryRun). */
  async function runTemporal(orgId, { now = new Date(), dryRun = false } = {}) {
    requireOrg(orgId);
    const cfg = (await effectiveRules(orgId)).filter((r) => r.kind === 'temporal' && r.enabled);
    const holidays = await holidaysOf(orgId);
    const planned = [];
    const stepRows = await db.all(
      `SELECT i.*, a.id AS a_id FROM step_instances i JOIN actes a ON a.id = i.acte_id
       WHERE i.status = 'current' AND a.organisme_id = $1 AND a.statut IN ('en_circuit','modification_demandee','en_attente_scc')`, [orgId]);
    const drafts = await db.all("SELECT * FROM actes WHERE organisme_id = $1 AND statut = 'brouillon'", [orgId]);
    const handle = async (rule, acte, inst, ctxTimes, scope) => {
      // seul le palier le plus avancé déjà atteint est émis (jamais une rafale R1+R2+R3 après une panne)
      const due = rule.palliers.map((p) => ({ p, at: palierTimes(p, ctxTimes, holidays, now) })).filter((x) => x.at && x.at.t <= now).sort((a, b) => b.at.t - a.at.t)[0];
      if (!due) return;
      const users = await resolveRecipients(orgId, due.p.recipients, { acte, inst });
      const vars = await varsOf(acte, { inst, arrivedAt: ctxTimes.arrival || ctxTimes.updated, etape: inst?.label });
      const keyBase = `${rule.code}:${acte.id}:${scope}:${due.p.id}:${due.at.n}`;
      const items = await deliver({ orgId, rule, acte, usernames: users, vars, keyBase, immediate: false, dryRun, at: now });
      for (const it of items) planned.push({ ...it, pallier: due.p.id, occurrence: due.at.n });
    };
    for (const rule of cfg) {
      if (rule.trigger.type === 'draft_deadline') {
        const rows = await db.all(`SELECT a.*, s.date_limite_redaction AS dl, s.id AS sid FROM actes a JOIN seances s ON s.id = a.seance_visee_id
          WHERE a.organisme_id = $1 AND a.statut = 'brouillon' AND s.date_limite_redaction IS NOT NULL AND s.statut IN ('planifiee','convoquee')`, [orgId]);
        for (const a of rows) {
          if (rule.condition && !G.evalCondition(rule.condition, await engine.factsOf(a))) continue;
          // la clé porte la séance ET la date limite : un changement de séance ou de date relance à neuf (NOT-05)
          await handle(rule, a, null, { deadline: a.dl, updated: a.dl }, `s${a.sid}:${new Date(a.dl).getTime()}`);
        }
        continue;
      }
      if (rule.trigger.type === 'draft_idle') {
        for (const a of drafts) { if (rule.condition && !G.evalCondition(rule.condition, await engine.factsOf(a))) continue; await handle(rule, a, null, { updated: a.updated_at }, `d${new Date(a.updated_at).getTime()}`); }
        continue;
      }
      for (const inst of stepRows) {
        const a = await db.get('SELECT * FROM actes WHERE id = $1', [inst.a_id]);
        const graph = await engine.graphOf(a.circuit_version_id);
        const isStart = inst.step_key === graph.start;
        if (!['returned', 'step_pending'].includes(rule.trigger.type)) continue;
        if ((rule.trigger.type === 'returned') !== isStart) continue;
        if (rule.trigger.type === 'returned' && a.statut !== 'modification_demandee') continue;
        if (!inst.holders.length && rule.trigger.type === 'step_pending') continue;
        if (rule.condition && !G.evalCondition(rule.condition, await engine.factsOf(a))) continue;
        await handle(rule, a, inst, { arrival: inst.arrived_at, due: inst.due_at, sla: inst.sla_days }, `i${inst.id}`);
      }
    }
    return planned;
  }

  // -------------------------------------------------------------------------------------- envoi (file)
  const footerOf = (cfg) => ({ line1: cfg['mail.footer1']?.value, line2: cfg['mail.footer2']?.value, line3: cfg['mail.footer3']?.value, color: cfg['mail.footerColor']?.value });

  const toHtml = (body) => body.split('\n').map((l) => (/^https?:\/\/\S+$/.test(l.trim()) ? `<p><a href="${esc(l.trim())}">Ouvrir dans IvryDélib</a></p>` : `<p>${esc(l)}</p>`)).join('');

  async function sendMail(orgId, to, subject, body) {
    const cfg = await settings.resolve(orgId);
    let realTo = to; let html = toHtml(body); let subj = subject;
    if (config.mailRedirectTo) { realTo = config.mailRedirectTo; subj = `[RECETTE → ${to}] ${subject}`; html = `<p><em>Mode recette : ce message était destiné à ${esc(to)}.</em></p>${html}`; }
    await mail.send({ to: realTo, subject: subj, html, footer: footerOf(cfg) });
  }

  /** Envoie les messages dus : regroupe par destinataire, applique le plafond quotidien, temporise les échecs. */
  async function processQueue({ now = new Date(), limit = 200 } = {}) {
    const stats = { sent: 0, failed: 0, retried: 0, grouped: 0, deferred: 0 };
    await db.tx(async (q) => {
      const rows = await q.all("SELECT * FROM notification_log WHERE status = 'pending' AND channel = 'mail' AND next_attempt_at <= $1 ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED", [now, limit]);
      const groups = new Map();
      for (const r of rows) { const k = `${r.organisme_id}|${r.recipient}|${r.email}`; (groups.get(k) || groups.set(k, []).get(k)).push(r); }
      for (const items of groups.values()) {
        const first = items[0];
        const cap = (await settings.resolve(first.organisme_id))['notifications.plafond_quotidien']?.value ?? 20;
        const startDay = new Date(Date.UTC(parisParts(now).y, parisParts(now).m - 1, parisParts(now).d) - 2 * 3600 * 1000);
        const today = (await q.get("SELECT count(*)::int AS n FROM notification_log WHERE organisme_id = $1 AND recipient = $2 AND status = 'sent' AND channel = 'mail' AND sent_at >= $3", [first.organisme_id, first.recipient, startDay])).n;
        if (today >= cap) { await q.run("UPDATE notification_log SET status = 'digest', skip_reason = 'plafond' WHERE id = ANY($1::bigint[])", [items.map((i) => i.id)]); stats.deferred += items.length; continue; }
        const subject = items.length === 1 ? first.subject : `${items.length} notifications IvryDélib`;
        const body = items.length === 1 ? first.body : items.map((i) => `• ${i.subject}\n${i.body}`).join('\n\n');
        try {
          await sendMail(first.organisme_id, first.email, subject, body);
          await q.run("UPDATE notification_log SET status = 'sent', sent_at = now(), attempts = attempts + 1, skip_reason = CASE WHEN $2 THEN 'grouped' END, error = NULL WHERE id = ANY($1::bigint[])", [items.map((i) => i.id), items.length > 1]);
          stats.sent += items.length; if (items.length > 1) stats.grouped += items.length;
        } catch (e) {
          for (const i of items) {
            const attempts = i.attempts + 1;
            if (attempts >= MAX_ATTEMPTS) { await q.run("UPDATE notification_log SET status = 'failed', attempts = $2, error = $3 WHERE id = $1", [i.id, attempts, e.message]); stats.failed++; } else {
              const wait = Math.min(5 * 2 ** attempts, 360); // minutes : 10, 20, 40, 80, 160
              await q.run("UPDATE notification_log SET attempts = $2, error = $3, next_attempt_at = $4 WHERE id = $1", [i.id, attempts, e.message, new Date(now.getTime() + wait * 60000)]); stats.retried++;
            }
          }
        }
      }
    });
    return stats;
  }

  // ------------------------------------------------------------------------------------------ synthèses
  async function sendDigests(orgId, { now = new Date() } = {}) {
    const p = parisParts(now);
    const holidays = await holidaysOf(orgId);
    if (!isBusinessDay(new Date(Date.UTC(p.y, p.m - 1, p.d)), holidays) || p.h * 60 + p.min < 7 * 60 + 30) return { sent: 0 };
    const users = new Set((await db.all("SELECT DISTINCT jsonb_array_elements_text(holders) AS u FROM step_instances i JOIN actes a ON a.id = i.acte_id WHERE i.status = 'current' AND a.organisme_id = $1", [orgId])).map((r) => r.u));
    for (const r of await db.all("SELECT DISTINCT recipient FROM notification_log WHERE organisme_id = $1 AND status = 'digest'", [orgId])) users.add(r.recipient);
    for (const r of await db.all("SELECT DISTINCT redacteur FROM actes WHERE organisme_id = $1 AND statut = 'modification_demandee'", [orgId])) users.add(r.redacteur);
    const emails = await emailsOf([...users]);
    let sent = 0;
    for (const u of users) {
      const key = `digest:${orgId}:${u}:${p.iso}`;
      if (!emails.get(u) || await db.get('SELECT 1 AS x FROM scheduler_runs WHERE key = $1', [key])) continue;
      const pref = (await db.get("SELECT mode FROM notification_prefs WHERE organisme_id = $1 AND username = $2 AND family = 'synthese'", [orgId, u]))?.mode;
      if (pref === 'off') continue;
      const todo = await engine.todo({ username: u }, orgId);
      const pending = await db.all("SELECT * FROM notification_log WHERE organisme_id = $1 AND recipient = $2 AND status = 'digest' ORDER BY id", [orgId, u]);
      const late = todo.filter((t) => t.step.late);
      if (!todo.length && !pending.length) continue;
      const lines = [`Bonjour ${await nameOf(u)},`, ''];
      if (todo.length) lines.push(`À traiter (${todo.length}) :`, ...todo.map((t) => `• n° ${t.acte.numeroSuivi ?? t.acte.numero_suivi ?? ''} ${t.acte.titre} — ${t.step.label}${t.step.late ? ' (EN RETARD)' : ''}`), '');
      if (late.length) lines.push(`Dont en retard : ${late.length}`, '');
      if (pending.length) lines.push('Notifications regroupées :', ...pending.map((n) => `• ${n.subject}`), '');
      lines.push(`${config.publicBaseUrl}/organismes/${orgId}`);
      await sendMail(orgId, emails.get(u), `Votre synthèse du ${p.iso.split('-').reverse().join('/')} : ${todo.length} acte(s) à traiter`, lines.join('\n'));
      if (pending.length) await db.run("UPDATE notification_log SET status = 'sent', sent_at = now(), skip_reason = 'synthese' WHERE id = ANY($1::bigint[])", [pending.map((n) => n.id)]);
      await db.run('INSERT INTO scheduler_runs (key) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
      sent++;
    }
    return { sent };
  }

  // --------------------------------------------------------------------------------------- API : centre
  const svc = {
    FAMILIES, effectiveRules, resolveRecipients, deliver, runTemporal, processQueue, sendDigests, render, sendMail,

    async seedRules() {
      let n = 0;
      for (const r of RULES) {
        const ex = await db.get('SELECT 1 AS x FROM notification_rules WHERE organisme_id IS NULL AND code = $1', [r.code]);
        if (ex) continue;
        await db.run(
          `INSERT INTO notification_rules (organisme_id, code, nom, family, kind, trigger, condition, recipients, channels, palliers, subject, body, mandatory, enabled, updated_by)
           VALUES (NULL,$1,$2,$3,$4,$5::jsonb,NULL,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,true,'system')`,
          [r.code, r.nom, r.family, r.kind, JSON.stringify(r.trigger), JSON.stringify(r.recipients), JSON.stringify(r.channels || ['inapp', 'mail']), JSON.stringify(r.palliers || []), r.subject, r.body, !!r.mandatory]);
        n++;
      }
      return n;
    },

    async center(ctx, orgId, { unread = false, limit = 50, offset = 0 } = {}) {
      const w = 'organisme_id = $1 AND username = $2' + (unread ? ' AND read_at IS NULL' : '');
      const items = await db.all(`SELECT * FROM notifications WHERE ${w} ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`, [orgId, ctx.username, limit, offset]);
      const n = (await db.get('SELECT count(*)::int AS n FROM notifications WHERE organisme_id = $1 AND username = $2 AND read_at IS NULL', [orgId, ctx.username])).n;
      return { unread: n, items: items.map((r) => ({ id: Number(r.id), family: r.family, acteId: r.acte_id, title: r.title, body: r.body, link: r.link, createdAt: r.created_at, read: !!r.read_at })) };
    },
    async markRead(ctx, orgId, id) {
      const r = await db.get('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND organisme_id = $2 AND username = $3 RETURNING id', [id, orgId, ctx.username]);
      if (!r) throw E.notFound('Notification introuvable');
      return { id: Number(r.id), read: true };
    },
    async markAllRead(ctx, orgId) {
      const r = await db.all('UPDATE notifications SET read_at = now() WHERE organisme_id = $1 AND username = $2 AND read_at IS NULL RETURNING id', [orgId, ctx.username]);
      return { marked: r.length };
    },

    async preferences(ctx, orgId) {
      const rows = await db.all('SELECT family, mode FROM notification_prefs WHERE organisme_id = $1 AND username = $2', [orgId, ctx.username]);
      const m = Object.fromEntries(rows.map((r) => [r.family, r.mode]));
      return { items: Object.entries(FAMILIES).map(([family, f]) => ({ family, label: f.label, mandatory: f.mandatory, mode: f.mandatory ? 'immediate' : (m[family] || 'immediate') })) };
    },
    async setPreference(ctx, orgId, family, mode) {
      if (!FAMILIES[family]) throw E.badRequest('Famille inconnue');
      if (FAMILIES[family].mandatory && mode !== 'immediate') throw E.badRequest('Cette famille est obligatoire : elle ne peut pas être désactivée ni regroupée');
      await db.run('INSERT INTO notification_prefs (organisme_id, username, family, mode) VALUES ($1,$2,$3,$4) ON CONFLICT (organisme_id, username, family) DO UPDATE SET mode = EXCLUDED.mode', [orgId, ctx.username, family, mode]);
      return svc.preferences(ctx, orgId);
    },

    // ---- sourdine et suspension
    async mute(ctx, organismeId, acteId, { days, scope = 'me', reason }) {
      const a = await actes.load(ctx, organismeId, acteId);
      const cfg = await settings.resolve(a.organisme_id);
      const max = cfg['notifications.sourdine_max_jours']?.value ?? 14;
      const privileged = acl.isAdmin(ctx, a.organisme_id) || (await titulaires.canManage(ctx, a.organisme_id, { directionCode: a.direction_code, serviceCode: null }));
      if (scope === 'all' && !privileged) throw E.forbidden("Seuls l'administrateur, le SCC et le directeur suspendent les notifications d'un acte");
      if (scope === 'me' && days > max) throw E.badRequest(`Une sourdine personnelle est limitée à ${max} jours`);
      const until = new Date(Date.now() + days * 86400000);
      const r = await db.get('INSERT INTO notification_mutes (acte_id, username, until, reason, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *', [a.id, scope === 'all' ? null : ctx.username, until, reason || null, ctx.username]);
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'notification.mute', entity: 'actes', entityId: a.id, after: { scope, until, reason } });
      return { id: r.id, acteId: a.id, scope, until, reason: r.reason };
    },
    async mutes(ctx, organismeId, acteId) {
      const a = await actes.load(ctx, organismeId, acteId);
      return (await db.all('SELECT * FROM notification_mutes WHERE acte_id = $1 AND until > now() ORDER BY id', [a.id])).map((m) => ({ id: m.id, scope: m.username ? 'me' : 'all', username: m.username, until: m.until, reason: m.reason, createdBy: m.created_by }));
    },
    async unmute(ctx, organismeId, acteId, muteId) {
      const a = await actes.load(ctx, organismeId, acteId);
      const m = await db.get('SELECT * FROM notification_mutes WHERE id = $1 AND acte_id = $2', [muteId, a.id]);
      if (!m) throw E.notFound('Sourdine introuvable');
      if (m.created_by !== ctx.username && !acl.isAdmin(ctx, a.organisme_id)) throw E.forbidden();
      await db.run('DELETE FROM notification_mutes WHERE id = $1', [muteId]);
      return { removed: true };
    },

    /** Relance manuelle (NOT-13) : directeur, SCC, DGS, administrateur ; passe outre la sourdine et la plage horaire. */
    async remind(ctx, organismeId, acteId, { message, to = 'holders' }) {
      const a = await actes.load(ctx, organismeId, acteId);
      const dgs = (await titulaires.resolve(a.organisme_id, 'dgs', {})).map((t) => t.username);
      const ok = acl.isAdmin(ctx, a.organisme_id) || dgs.includes(ctx.username) || await titulaires.canManage(ctx, a.organisme_id, { directionCode: a.direction_code, serviceCode: null });
      if (!ok) throw E.forbidden('Réservé au directeur, au SCC, au DGS et à l\'administrateur');
      const inst = await db.get("SELECT * FROM step_instances WHERE acte_id = $1 AND status = 'current' ORDER BY id DESC LIMIT 1", [a.id]);
      const users = await resolveRecipients(a.organisme_id, to === 'redacteur' ? ['redacteur'] : ['holders', 'delegues'], { acte: a, inst });
      if (!users.size) throw E.conflict('Aucun destinataire pour cette relance');
      const rule = { code: 'relance.manuelle', family: 'validation', mandatory: true, channels: ['inapp', 'mail'],
        subject: 'Relance : {titre}', body: "{acteur} vous relance au sujet de l'acte n° {numero} « {titre} » (étape « {etape} »).\n{message}\n{lien}" };
      const vars = await varsOf(a, { inst, vars: { acteur: await nameOf(ctx.username), message: message || '' } });
      const items = await deliver({ orgId: a.organisme_id, rule, acte: a, usernames: users, vars, keyBase: null, immediate: true, force: true, actor: ctx.username });
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'notification.remind', entity: 'actes', entityId: a.id, after: { to: [...users], message } });
      return { recipients: items.map((i) => i.recipient) };
    },

    // ---- règles (administration)
    async listRules(orgId) { return { items: await effectiveRules(orgId), families: FAMILIES }; },
    async putRule(ctx, orgId, code, body) {
      const cur = (await effectiveRules(orgId)).find((r) => r.code === code);
      if (!cur) throw E.notFound('Règle inconnue');
      const merged = { ...cur, ...body };
      if (cur.mandatory && body.enabled === false) throw E.badRequest('Cette règle est obligatoire : elle ne peut pas être désactivée');
      const before = cur;
      await db.run(
        `INSERT INTO notification_rules (organisme_id, code, nom, family, kind, trigger, condition, recipients, channels, palliers, subject, body, mandatory, enabled, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15)
         ON CONFLICT (COALESCE(organisme_id, 0), code) DO UPDATE SET nom = EXCLUDED.nom, condition = EXCLUDED.condition, recipients = EXCLUDED.recipients, channels = EXCLUDED.channels,
           palliers = EXCLUDED.palliers, subject = EXCLUDED.subject, body = EXCLUDED.body, enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [orgId, code, merged.nom, cur.family, cur.kind, JSON.stringify(cur.trigger), merged.condition ? JSON.stringify(merged.condition) : null, JSON.stringify(merged.recipients), JSON.stringify(merged.channels),
          JSON.stringify(merged.palliers), merged.subject, merged.body, cur.mandatory, merged.enabled, ctx.username]);
      await audit.log(ctx, { organismeId: orgId, action: 'notification.rule.update', entity: 'notification_rules', entityId: code, before, after: merged });
      return (await effectiveRules(orgId)).find((r) => r.code === code);
    },
    async resetRule(ctx, orgId, code) {
      const r = await db.get('DELETE FROM notification_rules WHERE organisme_id = $1 AND code = $2 RETURNING code', [orgId, code]);
      if (!r) throw E.notFound('Aucune surcharge pour cette règle');
      await audit.log(ctx, { organismeId: orgId, action: 'notification.rule.reset', entity: 'notification_rules', entityId: code });
      return (await effectiveRules(orgId)).find((x) => x.code === code);
    },
    async preview(ctx, orgId, code, { acteId } = {}) {
      const rule = (await effectiveRules(orgId)).find((r) => r.code === code);
      if (!rule) throw E.notFound('Règle inconnue');
      const a = acteId ? await db.get('SELECT * FROM actes WHERE id = $1 AND organisme_id = $2', [acteId, orgId]) : null;
      const vars = a ? await varsOf(a, { vars: { acteur: await nameOf(ctx.username), motif: 'Exemple de motif' } }) : {
        titre: "Attribution d'une subvention", numero: 42, etape: 'Directeur', lien: `${config.publicBaseUrl}/organismes/${orgId}/actes/0`, redacteur: 'Alice Dupont', acteur: await nameOf(ctx.username),
        motif: 'Exemple de motif', organisme: '', echeance: fmtDate(new Date()), arrivee: fmtDate(new Date()), retard: 'dans les temps', jours_restants: 3, ajoutees: 'Service financier', version: 2, circuit: 'Circuit Ivry', portee: 'all', direction: 'A1',
      };
      return { subject: render(rule.subject, vars), body: render(rule.body, vars), html: toHtml(render(rule.body, vars)), variables: Object.keys(vars) };
    },
    async sendTest(ctx, orgId, code, input = {}) {
      const p = await svc.preview(ctx, orgId, code, input);
      const email = (await emailsOf([ctx.username])).get(ctx.username);
      if (!email) throw E.conflict("Votre adresse e-mail n'est pas connue de l'annuaire");
      await sendMail(orgId, email, `[TEST] ${p.subject}`, p.body);
      return { sentTo: config.mailRedirectTo ? `${config.mailRedirectTo} (mode recette)` : email };
    },

    /** Simulateur (NOT-17) : « à la date D, qui recevrait quoi ? » — n'écrit rien et n'envoie rien. */
    async simulate(orgId, { at }) {
      const planned = await runTemporal(orgId, { now: new Date(at), dryRun: true });
      return { at, count: planned.length, items: planned.map((i) => ({ rule: i.rule, pallier: i.pallier, acteId: i.acteId, recipient: i.recipient, email: i.email, subject: i.subject, willSend: i.status === 'pending', status: i.status, reason: i.skip, sendAfter: i.sendAfter })) };
    },

    async journal(orgId, f = {}) {
      const w = ['organisme_id = $1']; const p = [orgId];
      const add = (v) => { p.push(v); return `$${p.length}`; };
      if (f.acteId) w.push(`acte_id = ${add(f.acteId)}`);
      if (f.recipient) w.push(`recipient = ${add(f.recipient.toLowerCase())}`);
      if (f.rule) w.push(`rule_code = ${add(f.rule)}`);
      if (f.status) w.push(`status = ${add(f.status)}`);
      const where = w.join(' AND ');
      const total = (await db.get(`SELECT count(*)::int AS n FROM notification_log WHERE ${where}`, p)).n;
      const rows = await db.all(`SELECT * FROM notification_log WHERE ${where} ORDER BY id DESC LIMIT ${add(f.limit || 50)} OFFSET ${add(f.offset || 0)}`, p);
      return { total, items: rows.map((r) => ({ id: Number(r.id), rule: r.rule_code, family: r.family, acteId: r.acte_id, recipient: r.recipient, email: r.email, subject: r.subject, status: r.status, reason: r.skip_reason, attempts: r.attempts, error: r.error, createdAt: r.created_at, sentAt: r.sent_at })) };
    },

    /** Tableau de bord d'administration (NOT-23). */
    async dashboard(orgId) {
      const byStatus = await db.all("SELECT status, count(*)::int AS n FROM notification_log WHERE organisme_id = $1 AND created_at > now() - interval '7 days' GROUP BY status", [orgId]);
      const blocked = await db.all("SELECT a.id, a.titre, i.step_key, i.label, i.arrived_at FROM step_instances i JOIN actes a ON a.id = i.acte_id WHERE i.status = 'current' AND a.organisme_id = $1 AND jsonb_array_length(i.holders) = 0", [orgId]);
      const stuck = await db.all("SELECT a.id, a.titre, i.label, i.arrived_at FROM step_instances i JOIN actes a ON a.id = i.acte_id WHERE i.status = 'current' AND a.organisme_id = $1 AND i.arrived_at < now() - interval '10 days' ORDER BY i.arrived_at", [orgId]);
      const laziest = await db.all("SELECT h AS username, count(*)::int AS n FROM step_instances i JOIN actes a ON a.id = i.acte_id, jsonb_array_elements_text(i.holders) h WHERE i.status = 'current' AND a.organisme_id = $1 AND i.due_at < now() GROUP BY h ORDER BY n DESC LIMIT 10", [orgId]);
      const counts = Object.fromEntries(byStatus.map((r) => [r.status, r.n]));
      const total = Object.values(counts).reduce((s, n) => s + n, 0);
      return { last7Days: counts, failureRate: total ? (counts.failed || 0) / total : 0, blocked, stuckMoreThan10Days: stuck, latestHolders: laziest };
    },

    /** Alerte l'administrateur si le taux d'échec des envois dépasse le seuil (NOT-22). */
    async checkFailureRate(orgId, now = new Date()) {
      const cfg = await settings.resolve(orgId);
      const threshold = cfg['notifications.seuil_echec']?.value ?? 0.3;
      const r = await db.get("SELECT count(*) FILTER (WHERE status = 'failed')::int AS f, count(*) FILTER (WHERE status IN ('failed','sent'))::int AS t FROM notification_log WHERE organisme_id = $1 AND created_at > now() - interval '24 hours'", [orgId]);
      if (r.t < 5 || r.f / r.t <= threshold) return false;
      const rule = { code: 'admin.taux_echec', family: 'admin', mandatory: true, channels: ['inapp'], subject: "Envois de mails en échec ({echecs}/{total})", body: "Plus de {seuil} % des mails des dernières 24 h ont échoué : vérifiez l'API APM." };
      await deliver({ orgId, rule, acte: null, usernames: new Set(await usersWithRole(orgId, 'org_admin')), vars: { echecs: r.f, total: r.t, seuil: Math.round(threshold * 100) }, keyBase: `admin.taux_echec:${orgId}:${parisParts(now).iso}`, immediate: true });
      return true;
    },

    // ---- calendrier
    async listHolidays(orgId) { return { items: (await db.all("SELECT id, organisme_id, to_char(day,'YYYY-MM-DD') AS day, label FROM holidays WHERE organisme_id IS NULL OR organisme_id = $1 ORDER BY day", [orgId])).map((h) => ({ id: h.id, day: h.day, label: h.label, origin: h.organisme_id ? 'organisme' : 'plateforme' })) }; },
    async addHoliday(ctx, orgId, { day, label }) {
      const r = await db.get('INSERT INTO holidays (organisme_id, day, label) VALUES ($1,$2,$3) ON CONFLICT (COALESCE(organisme_id, 0), day) DO UPDATE SET label = EXCLUDED.label RETURNING id', [orgId, day, label || '']);
      await audit.log(ctx, { organismeId: orgId, action: 'holiday.add', entity: 'holidays', entityId: r.id, after: { day, label } });
      return { id: r.id, day, label: label || '' };
    },
    async removeHoliday(ctx, orgId, id) {
      const r = await db.get('DELETE FROM holidays WHERE id = $1 AND organisme_id = $2 RETURNING day', [id, orgId]);
      if (!r) throw E.notFound('Jour introuvable (les jours de la plateforme ne se suppriment pas ici)');
      await audit.log(ctx, { organismeId: orgId, action: 'holiday.remove', entity: 'holidays', entityId: id });
    },
    /** Jours fériés français d'une année (fixes + Pâques, Ascension, Pentecôte). */
    async generateHolidays(ctx, orgId, year) {
      const easter = (() => { const a = year % 19; const b = Math.floor(year / 100); const c = year % 100; const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25); const g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30; const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7; const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31); const day = ((h + l - 7 * m + 114) % 31) + 1; return new Date(Date.UTC(year, month - 1, day)); })();
      const plus = (n) => new Date(easter.getTime() + n * 86400000);
      const list = [[`${year}-01-01`, "Jour de l'an"], [plus(1), 'Lundi de Pâques'], [`${year}-05-01`, 'Fête du travail'], [`${year}-05-08`, 'Victoire 1945'], [plus(39), 'Ascension'], [plus(50), 'Lundi de Pentecôte'],
        [`${year}-07-14`, 'Fête nationale'], [`${year}-08-15`, 'Assomption'], [`${year}-11-01`, 'Toussaint'], [`${year}-11-11`, 'Armistice 1918'], [`${year}-12-25`, 'Noël']];
      for (const [d, label] of list) await svc.addHoliday(ctx, orgId, { day: typeof d === 'string' ? d : d.toISOString().slice(0, 10), label });
      return svc.listHolidays(orgId);
    },
  };
  void late; void RULES;
  return svc;
}

module.exports = { createNotifications };
