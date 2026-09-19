/**
 * Service d'annuaire : orchestre l'adaptateur DirectoryPort (annuaire commun à tous les organismes) et le cache local
 * `agent_ref`. Une panne du Hub ne bloque jamais la lecture de ce qui est déjà connu (INT-01).
 *
 * L'annuaire renvoie la direction d'un agent en LIBELLÉ ; on la résout en CODE grâce à l'organigramme RH
 * (les libellés sont comparés sans accents, ni casse, ni espaces multiples).
 */
const normLabel = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

function createDirectoryService({ db, adapter, config, log }) {
  let dirCache = { at: 0, list: null };

  async function directions({ force = false } = {}) {
    const fresh = dirCache.list && Date.now() - dirCache.at < config.directoryCacheMs;
    if (fresh && !force) return dirCache.list;
    try {
      const list = await adapter.listDirections();
      dirCache = { at: Date.now(), list };
      return list;
    } catch (e) {
      if (dirCache.list) { log.warn({ err: e.message }, 'annuaire indisponible : organigramme servi depuis le cache'); return dirCache.list; }
      throw e;
    }
  }

  async function resolveDirection(label) {
    if (!label) return null;
    try {
      const n = normLabel(label);
      const hit = (await directions()).find((d) => normLabel(d.label) === n || d.code === label);
      return hit ? { code: hit.code, label: hit.label } : null;
    } catch { return null; }
  }

  /** Service (code) d'un agent : recherché par libellé dans les services de sa direction. */
  async function resolveService(directionCode, label) {
    if (!directionCode || !label) return null;
    try {
      const d = (await directions()).find((x) => x.code === directionCode);
      const n = normLabel(label);
      const hit = d?.services.find((x) => normLabel(x.label) === n || x.code === label);
      return hit ? { code: hit.code, label: hit.label } : null;
    } catch { return null; }
  }

  /**
   * Intitulé de poste à afficher : si l'agent est le RESPONSABLE de sa direction ou de son service dans l'organigramme RH,
   * on prend l'intitulé du poste d'organigramme (« Directeur des systèmes d'information »), plus parlant que la
   * fonction de la fiche RH (« Directeur et expertise informatique »).
   */
  async function posteOrganigramme(card, dir, svc) {
    if (!card || !dir?.code) return null;
    try {
      const chart = await adapter.getOrganisationChart();
      const node = chart.find((d) => d.code === dir.code);
      if (!node) return null;
      const me = [normLabel(`${card.prenom} ${card.nom}`), normLabel(`${card.nom} ${card.prenom}`)];
      const sn = svc?.code ? (node.services || []).find((x) => x.code === svc.code) : null;
      for (const n of [sn, node]) {
        if (n?.poste && n.responsable && me.includes(normLabel(n.responsable))) return sentence(n.poste);
      }
    } catch { /* organigramme indisponible : on garde la fonction de la fiche RH */ }
    return null;
  }
  const sentence = (t) => { const s = String(t).toLowerCase().replace(/\s+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

  async function upsertAgent(a) {
    await db.run(
      `INSERT INTO agent_ref (username, matricule, nom, prenom, display_name, email, direction_code, direction_label,
                              service_label, poste, actif, source, first_login_at, last_login_at, updated_at, service_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, $13, $13, now(), $14)
       ON CONFLICT (username) DO UPDATE SET
         matricule       = COALESCE(EXCLUDED.matricule, agent_ref.matricule),
         nom             = COALESCE(EXCLUDED.nom, agent_ref.nom),
         prenom          = COALESCE(EXCLUDED.prenom, agent_ref.prenom),
         display_name    = COALESCE(EXCLUDED.display_name, agent_ref.display_name),
         email           = COALESCE(EXCLUDED.email, agent_ref.email),
         direction_code  = COALESCE(EXCLUDED.direction_code, agent_ref.direction_code),
         direction_label = COALESCE(EXCLUDED.direction_label, agent_ref.direction_label),
         service_label   = COALESCE(EXCLUDED.service_label, agent_ref.service_label),
         service_code    = COALESCE(EXCLUDED.service_code, agent_ref.service_code),
         poste           = COALESCE(EXCLUDED.poste, agent_ref.poste),
         actif           = EXCLUDED.actif,
         first_login_at  = COALESCE(agent_ref.first_login_at, EXCLUDED.first_login_at),
         last_login_at   = COALESCE(EXCLUDED.last_login_at, agent_ref.last_login_at),
         updated_at      = now()`,
      [a.username, a.matricule ?? null, a.nom ?? null, a.prenom ?? null, a.displayName ?? null, a.email ?? null,
        a.directionCode ?? null, a.directionLabel ?? null, a.serviceLabel ?? null, a.poste ?? null,
        a.actif !== false, a.source || 'ad', a.loginAt ?? null, a.serviceCode ?? null],
    );
    return db.get('SELECT * FROM agent_ref WHERE username = $1', [a.username]);
  }

  const toAgent = (r) => (r && {
    username: r.username, displayName: r.display_name, nom: r.nom, prenom: r.prenom, email: r.email, matricule: r.matricule,
    direction: r.direction_code || r.direction_label ? { code: r.direction_code, label: r.direction_label } : null,
    service: r.service_label, poste: r.poste, actif: r.actif, updatedAt: r.updated_at,
  });

  return {
    directions,
    organisationChart: () => adapter.getOrganisationChart(),
    searchAgents: (q) => adapter.searchAgents(q),

    /**
     * Autocomplétion d'un agent (« @nom ») : identifiant de connexion, nom, direction. Les agents déjà connectés d'abord, puis
     * l'annuaire RH. L'identifiant AD est la partie locale de l'e-mail (l'identifiant interne du Hub n'est pas un login).
     */
    async searchLogins(q, limit = 12) {
      const text = String(q || '').trim().replace(/^@/, '');
      if (text.length < 2) return [];
      const like = `%${text.replace(/[%_]/g, '\\$&')}%`;
      const local = (await db.all(
        `SELECT username, display_name, email, direction_label, service_label, poste FROM agent_ref
         WHERE actif AND (username ILIKE $1 OR display_name ILIKE $1 OR email ILIKE $1 OR nom ILIKE $1 OR prenom ILIKE $1)
         ORDER BY (username ILIKE $2) DESC, display_name NULLS LAST LIMIT $3`, [like, `${text.replace(/[%_]/g, '')}%`, limit]))
        .map((r) => ({ username: r.username, displayName: r.display_name || r.username, email: r.email, direction: r.direction_label, service: r.service_label, poste: r.poste, knownLocally: true }));
      const seen = new Set(local.map((a) => a.username));
      let remote = [];
      try {
        remote = (await adapter.searchAgents(text)).map((a) => ({ a, login: ((a.email || '').split('@')[0] || '').toLowerCase() })).filter(({ login }) => login && !seen.has(login))
          .map(({ a, login }) => ({ username: login, displayName: a.displayName, email: a.email, direction: a.direction, service: a.service, poste: a.poste, knownLocally: false }));
      } catch (e) { log.warn({ err: e.message }, 'autocomplétion : annuaire RH indisponible, résultats locaux seulement'); }
      return [...local, ...remote].slice(0, limit);
    },
    toAgent,

    /**
     * À la connexion : fusionne l'identité AD et la fiche RH (direction, service, poste) dans agent_ref.
     * Si l'annuaire RH est indisponible, la connexion aboutit avec ce qui est déjà connu.
     */
    /**
     * Fiche RH à la connexion. L'AD ne renvoie pas toujours l'adresse e-mail : à défaut on essaie `<identifiant>@<domaine>`
     * (EMAIL_DOMAIN) puis une recherche dans l'annuaire RH, pour retrouver nom, prénom, direction et service.
     */
    async syncOnLogin(adUser) {
      let card = null; let email = adUser.email || null;
      const tryEmail = async (addr) => {
        try { const c = await adapter.getAgentByEmail(addr); if (c) { card = c; email = c.email || addr; } } catch (e) { log.warn({ err: e.message }, 'fiche RH indisponible à la connexion'); }
      };
      if (email) await tryEmail(email);
      if (!card && config.emailDomain) await tryEmail(`${adUser.username}@${config.emailDomain}`);
      if (!card) {
        try {
          const hit = (await adapter.searchAgents(adUser.username)).find((a) => (a.email || '').split('@')[0].toLowerCase() === adUser.username);
          if (hit?.email) await tryEmail(hit.email);
        } catch { /* annuaire indisponible : on continue sans fiche */ }
      }
      const dir = await resolveDirection(card?.direction);
      const svcHit = await resolveService(dir?.code, card?.service);
      const cap = (s) => String(s || '').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
      const fromCard = card && (card.prenom || card.nom) ? `${cap(card.prenom)} ${cap(card.nom)}`.trim() : null;
      const displayName = adUser.displayName && adUser.displayName !== adUser.username ? adUser.displayName : (fromCard || adUser.displayName);
      return upsertAgent({
        username: adUser.username, displayName, email,
        nom: card?.nom ?? adUser.surname, prenom: card?.prenom ?? adUser.givenName, matricule: card?.matricule,
        directionCode: dir?.code, directionLabel: dir?.label || card?.direction, serviceLabel: svcHit?.label || card?.service, serviceCode: svcHit?.code, poste: (await posteOrganigramme(card, dir, svcHit)) || card?.fonction,
        actif: card ? card.present : true, loginAt: new Date(),
      });
    },

    async getAgent(username) { return toAgent(await db.get('SELECT * FROM agent_ref WHERE username = $1', [String(username).toLowerCase()])); },
    /** L'agent existe-t-il ? (déjà connecté à l'application, ou trouvé dans l'annuaire RH) */
    async agentExists(username) {
      const u = String(username).toLowerCase();
      if (await db.get('SELECT 1 AS x FROM agent_ref WHERE username = $1 AND actif', [u])) return true;
      try { return (await adapter.searchAgents(u)).some((a) => a.username === u || (a.email || '').split('@')[0].toLowerCase() === u); } catch { return false; }
    },
    resolveDirection,
    resolveService,
    normLabel,
  };
}

module.exports = { createDirectoryService, normLabel };
