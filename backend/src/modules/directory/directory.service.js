/**
 * Service d'annuaire : orchestre l'adaptateur DirectoryPort (annuaire commun à tous les organismes) et le cache local
 * `agent_ref`. Une panne du Hub ne bloque jamais la lecture de ce qui est déjà connu (INT-01).
 *
 * L'annuaire renvoie la direction d'un agent en LIBELLÉ ; on la résout en CODE grâce à l'organigramme RH
 * (les libellés sont comparés sans accents, ni casse, ni espaces multiples).
 */
const normLabel = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

function createDirectoryService({ db, adapter, ad = null, config, log }) {
  let dirCache = { at: 0, list: null };

  /** Organigramme du Hub seul (sans les surcharges locales), mis en cache. */
  async function hubDirections({ force = false } = {}) {
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

  /** Fusionne l'organigramme du Hub avec les entités locales (organisation_entites) : ajout ou correction de libellé. */
  async function mergeLocales(list) {
    let locaux;
    try { locaux = await db.all('SELECT type, code, label, parent_code FROM organisation_entites WHERE actif ORDER BY ordre, label'); } catch { return list; }
    if (!locaux.length) return list;
    const out = list.map((d) => ({ ...d, services: [...(d.services || [])] }));
    for (const e of locaux) {
      if (e.type === 'direction') {
        const ex = out.find((d) => d.code === e.code);
        if (ex) ex.label = e.label; else out.push({ code: e.code, label: e.label, services: [] });
      } else {
        const d = out.find((x) => x.code === e.parent_code); if (!d) continue;
        const ex = d.services.find((s) => s.code === e.code);
        if (ex) ex.label = e.label; else d.services.push({ code: e.code, label: e.label });
      }
    }
    return out;
  }

  /** Directions/services de l'organigramme, surcharges locales comprises. */
  async function directions(opts = {}) { return mergeLocales(await hubDirections(opts)); }

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

  // ---- intitulé de poste d'après l'organigramme ---------------------------------------------------------------------------
  // La fiche RH d'un agent porte un poste « métier » (« Directeur et expertise informatique ») ; l'organigramme porte l'intitulé
  // OFFICIEL du responsable d'une direction ou d'un service (« Directeur·trice des systèmes d'information »). Pour un responsable,
  // c'est l'intitulé de l'organigramme qui est affiché partout.
  let chartCache = { at: 0, list: null };
  const nameCache = new Map(); // identifiant -> { name, at } (agents connus seulement de l'annuaire RH)
  async function chart() {
    if (chartCache.list && Date.now() - chartCache.at < config.directoryCacheMs) return chartCache.list;
    try { const list = await adapter.getOrganisationChart(); chartCache = { at: Date.now(), list }; return list; } catch (e) {
      if (chartCache.list) return chartCache.list;
      throw e;
    }
  }
  // accents perdus dans l'organigramme (libellés en capitales sans accent)
  const ACCENTS = { systemes: 'systèmes', developpement: 'développement', generaux: 'généraux', general: 'général', evenementiel: 'événementiel', securite: 'sécurité', prevention: 'prévention', reglementation: 'réglementation', etat: 'état', mediatheque: 'médiathèque', ecologie: 'écologie', elections: 'élections', etudes: 'études', sante: 'santé', education: 'éducation', cooperation: 'coopération', democratie: 'démocratie', numerique: 'numérique', economique: 'économique', equipements: 'équipements', batiments: 'bâtiments', proprete: 'propreté', regie: 'régie' };
  const sentence = (t) => {
    const low = String(t).toLowerCase().replace(/\s+/g, ' ').trim().replace(/[\p{L}]+/gu, (w) => ACCENTS[w] || w);
    return low.charAt(0).toUpperCase() + low.slice(1);
  };
  /** « DIRECTEUR·TRICE » : masculin ou féminin selon la fiche RH de la personne (jamais d'après son prénom) ; sinon forme épicène. */
  function genderPoste(orgPoste, fichePoste) {
    return String(orgPoste).replace(/([\p{L}]+)·([\p{L}]+)/gu, (m, base, suf) => {
      const masc = base; const fem = /teur$/i.test(base) && /^trice$/i.test(suf) ? base.slice(0, -4) + suf : base + suf;
      const fiche = ` ${normLabel(fichePoste)} `;
      if (fiche.includes(` ${normLabel(masc)} `)) return masc;
      if (fiche.includes(` ${normLabel(fem)} `)) return fem;
      return m;
    });
  }
  /**
   * Poste à afficher pour une personne : `who` = { displayName, nom?, prenom?, direction (libellé), service (libellé), poste }.
   * Renvoie `who.poste` inchangé si la personne n'est pas le responsable de sa direction / de son service.
   */
  async function posteAffiche(who) {
    if (!who || !who.direction) return who?.poste ?? null;
    try {
      const nodes = await chart();
      const node = nodes.find((d) => normLabel(d.label) === normLabel(who.direction));
      if (!node) return who.poste ?? null;
      const key = (x) => normLabel(x).split(' ').filter(Boolean).sort().join(' '); // « nom prénom » = « prénom nom »
      const names = new Set([who.displayName, `${who.prenom || ''} ${who.nom || ''}`].filter((x) => x && x.trim()).map(key));
      const sn = who.service && normLabel(who.service) !== normLabel(node.label) ? (node.services || []).find((x) => normLabel(x.label) === normLabel(who.service)) : null;
      for (const n of [sn, node]) {
        if (n?.poste && n.responsable && names.has(key(n.responsable))) return sentence(genderPoste(n.poste, who.poste));
      }
    } catch { /* organigramme indisponible : on garde la fonction de la fiche RH */ }
    return who.poste ?? null;
  }

  const keyOf = (x) => normLabel(x).split(' ').filter(Boolean).sort().join(' '); // « nom prénom » = « prénom nom »
  /** Nom d'un compte AD en « Prénom NOM ». L'AD écrit « NOM Prénom » (« DESNEULIN France ») : les mots en capitales en tête sont le nom. */
  function adName(u, full) {
    if (u.givenName && u.surname) return full(u.givenName, u.surname);
    const w = String(u.displayName || '').trim().split(/\s+/).filter(Boolean);
    if (w.length < 2 || w.join(' ').toLowerCase() === u.username) return null;
    let i = 0; while (i < w.length - 1 && w[i] === w[i].toUpperCase()) i++;
    return full(w.slice(i).join(' ') || w[0], w.slice(0, i).join(' ') || w.slice(1).join(' '));
  }

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

  const svc = {
    directions,
    hubDirections,
    organisationChart: () => adapter.getOrganisationChart(),
    async searchAgents(q) { const list = await adapter.searchAgents(q); return Promise.all(list.map(async (a) => ({ ...a, poste: await posteAffiche(a) }))); },
    posteAffiche,

    /** Direction générale des services de l'organigramme RH : celle du code configuré, sinon celle qui porte ce nom. */
    async directionGenerale(codeConfigure) {
      const nodes = await chart();
      if (codeConfigure) { const n = nodes.find((d) => d.code === codeConfigure); if (n) return n; }
      return nodes.find((d) => normLabel(d.label) === 'DIRECTION GENERALE DES SERVICES') || nodes.find((d) => normLabel(d.label).startsWith('DIRECTION GENERALE')) || null;
    },

    /**
     * Identifiants de connexion des agents qui portent ce nom complet. Source : l'annuaire RH (identifiant = partie locale de l'adresse) ;
     * s'il ne donne aucun identifiant — fiche RH sans adresse e-mail, par exemple — l'Active Directory, qui porte l'identifiant lui-même.
     */
    async loginsByName(nom) {
      const logins = new Set();
      try { for (const h of await svc.searchByName(nom)) { const l = (h.email || '').split('@')[0].toLowerCase(); if (l) logins.add(l); } } catch (e) { log.warn({ err: e.message }, 'annuaire RH indisponible'); }
      if (!logins.size && ad) {
        const wanted = keyOf(nom);
        const tokens = [...new Set(String(nom || '').split(/\s+/).filter((t) => t.length >= 3))].sort((x, y) => y.length - x.length);
        for (const t of tokens.slice(0, 3)) {
          try {
            for (const u of await ad.searchUsers(t)) if (u.username && (keyOf(u.displayName) === wanted || keyOf(`${u.givenName || ''} ${u.surname || ''}`) === wanted)) logins.add(u.username.toLowerCase());
          } catch (e) { log.warn({ err: e.message }, 'AD indisponible'); break; }
          if (logins.size) break;
        }
      }
      return [...logins];
    },

    /** Agents de l'annuaire RH dont le nom complet est `nom` (« MERIEM KHAROUM ») : l'annuaire cherche un terme à la fois, on croise donc les termes. */
    async searchByName(nom) {
      const wanted = String(nom || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().split(/\s+/).filter(Boolean).sort().join(' ');
      const tokens = [...new Set(String(nom || '').split(/\s+/).filter((t) => t.length >= 3))].sort((a, b) => b.length - a.length);
      const seen = new Map();
      for (const t of tokens.slice(0, 3)) {
        const hits = await adapter.searchAgents(t);
        for (const h of hits) if (h.email && !seen.has(h.email.toLowerCase())) seen.set(h.email.toLowerCase(), h);
        const exact = [...seen.values()].filter((h) => String(h.displayName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().split(/\s+/).filter(Boolean).sort().join(' ') === wanted);
        if (exact.length) return exact;
      }
      return [];
    },

    /** Poste de responsable vacant dans l'organigramme RH : { direction, service } (faux si l'organigramme est indisponible). */
    async vacance(directionCode, serviceCode) {
      const node = (await chart()).find((d) => d.code === directionCode);
      const svcNode = serviceCode ? (node?.services || []).find((x) => x.code === serviceCode) : null;
      return { direction: !!node?.vacant, service: !!svcNode?.vacant };
    },

    /**
     * « Prénom NOM » d'une liste d'identifiants de connexion (affichage dans les listes à la place du login). Les agents connus
     * localement d'abord, puis l'annuaire RH pour quelques inconnus ; un identifiant introuvable est simplement absent du résultat.
     */
    async names(usernames) {
      const list = [...new Set((usernames || []).map((u) => String(u).trim().toLowerCase().replace(/^@/, '')).filter(Boolean))].slice(0, 200);
      if (!list.length) return {};
      const capName = (x) => String(x || '').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a1, b1) => a1 + b1.toUpperCase());
      const full = (prenom, nom) => `${capName(prenom)} ${String(nom || '').toUpperCase()}`.trim();
      const out = {};
      for (const r of await db.all('SELECT username, nom, prenom, display_name FROM agent_ref WHERE username = ANY($1::text[])', [list])) {
        if (r.nom && r.prenom) out[r.username] = full(r.prenom, r.nom);
        else if (r.display_name && r.display_name.toLowerCase() !== r.username) out[r.username] = r.display_name;
      }
      // agents jamais connectés à l'application : l'annuaire RH, en cherchant sur des fragments de l'identifiant (« hbourdelet » -> « bourdelet », « mmartialluit » -> « martia »)
      const inconnus = list.filter((x) => !out[x]);
      const trouve = async (u) => {
        const c = nameCache.get(u);
        if (c && Date.now() - c.at < 600000) return c.name;
        let name = null;
        if (ad) { // l'AD connaît l'identifiant exact : « DESNEULIN France » -> « France DESNEULIN » (la fiche RH n'a pas toujours d'adresse e-mail)
          try { const u2 = await ad.getUser(u); if (u2) name = adName(u2, full); } catch { /* AD indisponible : on essaie l'annuaire RH */ }
        }
        if (name) { nameCache.set(u, { name, at: Date.now() }); return name; }
        for (const q of [...new Set([u.slice(1), u.slice(2), u, u.slice(1, 7), u.slice(1, 6), u.slice(1, 5), u.slice(-5), u.slice(-4)])]) { // fragments : noms composés (« martial-luit », « le nech », « prat corona » ne contiennent pas l'identifiant entier)
          if (q.length < 3) continue;
          try {
            const hit = (await adapter.searchAgents(q)).find((h) => (h.email || '').split('@')[0].toLowerCase() === u);
            if (hit?.displayName) { const [prenom, ...reste] = hit.displayName.trim().split(/\s+/); name = full(prenom, reste.join(' ') || prenom); break; }
          } catch { break; /* annuaire indisponible */ }
        }
        nameCache.set(u, { name, at: Date.now() });
        return name;
      };
      for (let i = 0; i < inconnus.length; i += 10) {
        const lot = inconnus.slice(i, i + 10);
        (await Promise.all(lot.map(trouve))).forEach((n, k) => { if (n) out[lot[k]] = n; });
      }
      return out;
    },

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
      const all = [...local, ...remote].slice(0, limit);
      for (const a of all) a.poste = await posteAffiche(a);
      return all;
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
        directionCode: dir?.code, directionLabel: dir?.label || card?.direction, serviceLabel: svcHit?.label || card?.service, serviceCode: svcHit?.code, poste: card?.fonction, // fonction de la fiche RH telle quelle ; l'intitulé d'organigramme est calculé à l'affichage (posteAffiche)
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
  return svc;
}

module.exports = { createDirectoryService, normLabel };
