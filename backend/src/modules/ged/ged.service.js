/**
 * Archivage en GED Alfresco (section 19.5 bis, D86). Tous les documents d'une séance sont déposés dans un PLAN DE CLASSEMENT créé selon
 * les bonnes pratiques d'archivage (arborescence numérotée par année / séance / nature de pièce, noms homogènes sans caractère interdit,
 * finalité et durée de conservation indicative portées par chaque dossier, versionnement plutôt que doublons).
 *
 * Deux adaptateurs derrière le même port : Alfresco (API REST v1) et un simulateur persistant (mode par défaut). Un échec d'archivage
 * n'empêche jamais le travail de l'agent : il est journalisé et REJOUABLE (le dépôt est idempotent : un document inchangé n'est pas redéposé,
 * un document modifié devient une nouvelle version du même nœud). Le mot de passe est chiffré au repos et jamais renvoyé.
 */
const crypto = require('crypto');
const { createSecretBox } = require('../../shared/secretbox');
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const sha = (x) => crypto.createHash('sha256').update(typeof x === 'string' || Buffer.isBuffer(x) ? x : JSON.stringify(x)).digest('hex');
const day = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
/** Nom sûr pour un dossier ou un fichier Alfresco : ni caractère interdit (\ / : * ? " < > |), ni point final, ni espaces multiples. */
const sur = (x, max = 110) => Array.from(String(x || '').normalize('NFC'), (c) => (c.charCodeAt(0) < 32 ? '-' : c)).join('').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').replace(/^[.\s-]+|[.\s]+$/g, '').slice(0, max).trim() || 'sans nom';

/** Finalité et conservation indicatives par dossier du plan (à faire valider par le service des archives). */
const DUA = {
  seances: 'Dossiers de séance classés par année. Pièces préparatoires : durée d’utilité administrative puis tri par le service des archives.',
  convocation: 'Convocation et ordre du jour envoyés aux élus : preuve du respect du délai de convocation. Conservation : durée d’utilité administrative (à valider par les archives).',
  dossiers: 'Un dossier par point de l’ordre du jour : exposé des motifs, projet de délibération, annexes. Conservation : durée d’utilité administrative, puis tri.',
  cahier: 'Cahier de séance : compilation des dossiers du conseil. Conservation : durée d’utilité administrative, puis tri.',
  suivi: 'Procès-verbal et liste des délibérations. Le procès-verbal approuvé est conservé définitivement.',
  legalite: 'Accusés de réception, bordereaux et courriers de la préfecture (contrôle de légalité). Conservation : durée d’utilité administrative.',
  registre: 'Registre des délibérations : extraits des délibérations votées. Conservation DÉFINITIVE (archives définitives).',
};

function createGed({ db, audit, config, log, adapters, render, tenue, pv, tlt, storage, cahier }) {
  const box = createSecretBox(config.jwt.secret, 'ged'); // même clé qu'avant : les mots de passe déjà enregistrés restent lisibles
  const { chiffre, dechiffre } = box;
  const SYS = (org, by = 'ged') => ({ username: by, kind: 'system', isPlatformAdmin: true, organismes: [], roles: [], orgIds: [org], agent: null, displayName: 'GED' });

  const row = async (org) => db.get('SELECT * FROM ged_config WHERE organisme_id = $1', [org]);
  const view = (r) => ({ actif: !!r?.actif, mode: r?.mode || 'simulation', url: r?.url || '', utilisateur: r?.utilisateur || '', motDePasseDefini: !!r?.mot_de_passe_chiffre, racine: r?.racine || '-root-', autoArchivage: !!r?.auto_archivage, planCreeLe: r?.plan_cree_le || null, stockage: r?.stockage || 'local' });
  /** Configuration d'exécution (avec le mot de passe déchiffré : ne quitte jamais le serveur). */
  const cfgOf = async (org) => { const r = await row(org); return { organismeId: org, mode: r?.mode || 'simulation', actif: !!r?.actif, url: r?.url, utilisateur: r?.utilisateur, motDePasse: r?.mot_de_passe_chiffre ? dechiffre(r.mot_de_passe_chiffre) : '', racine: r?.racine || '-root-', autoArchivage: !!r?.auto_archivage, stockage: r?.stockage || 'local' }; };
  const adapterOf = (cfg) => (cfg.mode === 'alfresco' ? adapters.alfresco : adapters.simulateur);
  const prerequis = (cfg) => { if (cfg.mode === 'alfresco' && (!cfg.url || !cfg.utilisateur || !cfg.motDePasse)) throw E.conflict('Renseignez l’URL, le compte et le mot de passe d’Alfresco (Paramétrages / GED) avant d’archiver'); };

  async function racineSegments(org) {
    const o = await db.get('SELECT nom FROM organismes WHERE id = $1', [org]);
    return [{ nom: sur(`VibeDélib — ${o?.nom || 'Collectivité'}`) }];
  }
  const dossierSeance = async (org, s) => {
    const an = day(s.date_seance).slice(0, 4);
    return [...(await racineSegments(org)), { nom: '01 Séances', description: DUA.seances }, { nom: an }, { nom: sur(`${day(s.date_seance)} ${s.instance_nom}`) }];
  };
  const SOUS = { convocation: '01 Convocation et ordre du jour', dossiers: '02 Dossiers des délibérations', cahier: '03 Cahier de séance', suivi: '04 Suivi de séance et procès-verbal', legalite: '05 Contrôle de légalité' };

  const dossiersStockage = new Map();
  let migration = null; // { organismeId, sens, total, faits, echecs, debut, fin, promesse }

  const svc = {
    sur, DUA,

    // ------------------------------------------------------------------------------------------------ paramétrage
    async config(organismeId) { return view(await row(requireOrg(organismeId))); },
    async setConfig(ctx, organismeId, b) {
      const org = requireOrg(organismeId); const cur = await row(org);
      const v = {
        actif: b.actif ?? cur?.actif ?? false, mode: b.mode ?? cur?.mode ?? 'simulation', url: b.url !== undefined ? b.url.trim().replace(/\/+$/, '') : cur?.url ?? null,
        utilisateur: b.utilisateur !== undefined ? b.utilisateur.trim() : cur?.utilisateur ?? null, racine: b.racine !== undefined ? (b.racine.trim() || '-root-') : cur?.racine ?? '-root-',
        auto: b.autoArchivage ?? cur?.auto_archivage ?? false, stockage: b.stockage ?? cur?.stockage ?? 'local',
        mdp: b.motDePasse ? chiffre(b.motDePasse) : cur?.mot_de_passe_chiffre ?? null, // vide : on garde l'ancien
      };
      if (v.mode === 'alfresco' && v.actif && !(v.url && v.utilisateur && v.mdp)) throw E.badRequest('Pour activer l’archivage Alfresco, renseignez l’URL, le compte et le mot de passe');
      if (v.stockage === 'alfresco') { // basculer le stockage exige une GED active ET un test d'écriture / relecture réussi (GED-09)
        if (!v.actif) throw E.badRequest('Activez la GED avant de lui confier le stockage des fichiers');
        const essai = await svc.sonder({ organismeId: org, mode: v.mode, actif: true, url: v.url, utilisateur: v.utilisateur, motDePasse: b.motDePasse || (cur?.mot_de_passe_chiffre ? dechiffre(cur.mot_de_passe_chiffre) : ''), racine: v.racine });
        if (!essai.ok) throw E.conflict(`Le stockage dans la GED n'a pas pu être validé : ${essai.message}`);
      }
      await db.run(`INSERT INTO ged_config (organisme_id, actif, mode, url, utilisateur, mot_de_passe_chiffre, racine, auto_archivage, updated_by, stockage) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                    ON CONFLICT (organisme_id) DO UPDATE SET actif = EXCLUDED.actif, mode = EXCLUDED.mode, url = EXCLUDED.url, utilisateur = EXCLUDED.utilisateur, mot_de_passe_chiffre = EXCLUDED.mot_de_passe_chiffre,
                      racine = EXCLUDED.racine, auto_archivage = EXCLUDED.auto_archivage, updated_by = EXCLUDED.updated_by, stockage = EXCLUDED.stockage, updated_at = now()`, [org, v.actif, v.mode, v.url, v.utilisateur, v.mdp, v.racine, v.auto, ctx.username, v.stockage]);
      if (cur?.stockage !== v.stockage) await audit.log(ctx, { organismeId: org, action: 'ged.stockage', entity: 'ged_config', entityId: org, before: { stockage: cur?.stockage || 'local' }, after: { stockage: v.stockage } });
      await audit.log(ctx, { organismeId: org, action: 'ged.config', entity: 'ged_config', entityId: org, after: { actif: v.actif, mode: v.mode, url: v.url, utilisateur: v.utilisateur, racine: v.racine, autoArchivage: v.auto, motDePasseModifie: !!b.motDePasse } });
      return view(await row(org));
    },

    /** Bouton de test : joint le serveur avec la configuration ENREGISTRÉE (ou celle proposée, sans l'enregistrer) et renvoie un diagnostic lisible. */
    async tester(ctx, organismeId, essai = null) {
      const org = requireOrg(organismeId); const cfg = { ...(await cfgOf(org)), ...(essai ? Object.fromEntries(Object.entries({ mode: essai.mode, url: essai.url?.trim().replace(/\/+$/, ''), utilisateur: essai.utilisateur?.trim(), racine: essai.racine?.trim() || undefined, motDePasse: essai.motDePasse || undefined }).filter(([, v]) => v !== undefined)) : {}) };
      if (cfg.mode === 'alfresco' && (!cfg.url || !cfg.utilisateur || !cfg.motDePasse)) return { ok: false, message: 'Renseignez l’URL, le compte et le mot de passe d’Alfresco pour tester la connexion', details: { etape: 'configuration' } };
      const r = await adapterOf(cfg).testConnexion(cfg);
      await audit.log(ctx, { organismeId: org, action: 'ged.test', entity: 'ged_config', entityId: org, after: { mode: cfg.mode, ok: r.ok, message: r.message } });
      return { mode: cfg.mode, ...r };
    },

    // ------------------------------------------------------------------------------------------------ stockage des fichiers (GED-09, GED-10)
    /** Cible du stockage pour un organisme : { cfg, ad } si Alfresco est choisi ET actif, sinon null (volume local). */
    async cibleStockage(org) {
      const cfg = await cfgOf(org);
      if (!cfg.actif || cfg.stockage !== 'alfresco') return null;
      prerequis(cfg);
      return { cfg, ad: adapterOf(cfg) };
    },
    /** Cible pour LIRE un fichier déjà en GED : ne dépend pas du choix courant (un fichier reste lisible après un retour au stockage local). */
    async adapteurLecture(org) {
      const cfg = await cfgOf(org);
      if (cfg.mode === 'alfresco' && (!cfg.url || !cfg.utilisateur || !cfg.motDePasse)) return null;
      return { cfg, ad: adapterOf(cfg) };
    },
    /** Dossier technique « 90 Stockage applicatif / année / mois » (mémorisé). */
    async dossierStockage(org, cible) {
      const d = new Date(); const an = String(d.getUTCFullYear()); const mois = String(d.getUTCMonth() + 1).padStart(2, '0');
      const clef = `${org}:${cible.cfg.mode}:${cible.cfg.url}:${an}-${mois}`;
      if (dossiersStockage.has(clef)) return dossiersStockage.get(clef);
      const id = (await cible.ad.ensurePath(cible.cfg, [...(await racineSegments(org)), { nom: '90 Stockage applicatif', description: 'Fichiers de VibeDélib (annexes, pièces produites…). Noms opaques : ne pas modifier ni supprimer à la main.' }, { nom: an }, { nom: mois }])).id;
      dossiersStockage.set(clef, id);
      return id;
    },
    /** Sonde : écrit puis relit un petit fichier dans le dossier technique (validation avant de confier le stockage à la GED). */
    async sonder(cfg) {
      try {
        prerequis(cfg);
        const ad = adapterOf(cfg); const cible = { cfg, ad };
        const t = await ad.testConnexion(cfg);
        if (!t.ok) return { ok: false, message: t.message };
        const dossier = await svc.dossierStockage(cfg.organismeId, cible);
        const contenu = Buffer.from(`sonde VibeDélib ${Date.now()}`);
        const r = await ad.deposer(cfg, dossier, { nom: `sonde-${crypto.randomBytes(4).toString('hex')}.txt`, buffer: contenu, mime: 'text/plain', description: 'Sonde de validation du stockage' });
        const relu = await ad.contenu(cfg, r.nodeId);
        await ad.supprimer(cfg, r.nodeId).catch(() => undefined);
        if (!relu || !Buffer.from(relu).equals(contenu)) return { ok: false, message: 'Le fichier relu n\'est pas identique à celui écrit' };
        return { ok: true, message: 'Écriture et relecture réussies' };
      } catch (e) { return { ok: false, message: e.message }; }
    },

    async etatStockage(organismeId) {
      const org = requireOrg(organismeId); const cfg = await cfgOf(org);
      const n = async (like) => (await db.get(`SELECT count(*)::int AS n, COALESCE(sum(size), 0)::bigint AS octets FROM files WHERE organisme_id = $1 AND storage_key ${like ? '' : 'NOT'} LIKE 'alf:%'`, [org]));
      const [ged, loc] = [await n(true), await n(false)];
      const logo = await db.get("SELECT logo_path FROM organismes WHERE id = $1", [org]);
      return {
        stockage: cfg.stockage, gedActive: cfg.actif, mode: cfg.mode,
        fichiers: { local: loc.n, octetsLocal: Number(loc.octets), alfresco: ged.n, octetsAlfresco: Number(ged.octets) },
        logo: logo?.logo_path ? (String(logo.logo_path).startsWith('alf:') ? 'alfresco' : 'local') : null,
        migration: migration && migration.organismeId === org ? { sens: migration.sens, total: migration.total, faits: migration.faits, echecs: migration.echecs.length, enCours: !migration.fin, erreurs: migration.echecs.slice(0, 20), debut: migration.debut, fin: migration.fin } : null,
      };
    },

    /**
     * Migration des fichiers (GED-10), en arrière-plan : « vers_alfresco » (stockage = alfresco requis) ou « vers_local » (stockage = local requis).
     * Rejouable : ce qui est déjà au bon endroit n'est pas touché. La source n'est supprimée que sur demande expresse.
     */
    async migrerStockage(ctx, organismeId, { sens, supprimerSource = false }) {
      const org = requireOrg(organismeId); const cfg = await cfgOf(org);
      if (migration && !migration.fin) throw E.conflict('Une migration est déjà en cours');
      if (sens === 'vers_alfresco') {
        if (cfg.stockage !== 'alfresco' || !cfg.actif) throw E.conflict('Choisissez d\'abord Alfresco comme stockage (et activez la GED) : les nouveaux fichiers iront alors directement en GED');
      } else if (sens === 'vers_local') {
        if (cfg.stockage !== 'local') throw E.conflict('Repassez d\'abord le stockage en « local » : sinon les nouveaux fichiers repartiraient en GED pendant la migration');
      } else throw E.badRequest('Sens de migration inconnu');
      const lit = await svc.adapteurLecture(org);
      if (!lit) throw E.conflict('La GED n\'est pas configurée');
      const cible = sens === 'vers_alfresco' ? { cfg, ad: adapterOf(cfg) } : null;
      const lignes = sens === 'vers_alfresco'
        ? await db.all("SELECT id, storage_key, original_name FROM files WHERE organisme_id = $1 AND storage_key NOT LIKE 'alf:%' ORDER BY id", [org])
        : await db.all("SELECT id, storage_key, original_name FROM files WHERE organisme_id = $1 AND storage_key LIKE 'alf:%' ORDER BY id", [org]);
      const logo = await db.get('SELECT logo_path FROM organismes WHERE id = $1', [org]);
      const logoAMigrer = logo?.logo_path && (sens === 'vers_alfresco') !== String(logo.logo_path).startsWith('alf:');
      const etat = { organismeId: org, sens, total: lignes.length + (logoAMigrer ? 1 : 0), faits: 0, echecs: [], debut: new Date(), fin: null };
      migration = etat;
      const extDe = (nom, key) => (String(nom || key).match(/\.([a-z0-9]{2,5})$/i)?.[1] || 'bin').toLowerCase();
      const deplacer = async (cle, nom) => {
        const buffer = await storage.get(cle);
        if (sens === 'vers_alfresco') {
          const ext = extDe(nom, cle); const sha = crypto.createHash('sha256').update(buffer).digest('hex');
          const dossierId = await svc.dossierStockage(org, cible);
          const r = await cible.ad.deposer(cible.cfg, dossierId, { nom: `${sha.slice(0, 16)}-${crypto.randomBytes(4).toString('hex')}.${ext}`, buffer, mime: ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'application/octet-stream', description: 'Fichier de VibeDélib (migré depuis le stockage local)' });
          if (supprimerSource) await storage.local.remove(cle).catch(() => undefined);
          return `alf:${org}:${r.nodeId}`;
        }
        const put = await storage.local.put(buffer, { organismeId: org, ext: extDe(nom, cle) });
        if (supprimerSource) await storage.remove(cle).catch(() => undefined);
        return put.key;
      };
      etat.promesse = (async () => {
        for (const f of lignes) {
          try { const nouvelle = await deplacer(f.storage_key, f.original_name); await db.run('UPDATE files SET storage_key = $2 WHERE id = $1', [f.id, nouvelle]); etat.faits++; }
          catch (e) { etat.echecs.push({ fichier: f.original_name, erreur: String(e.message).slice(0, 200) }); }
        }
        if (logoAMigrer) {
          try { const nouvelle = await deplacer(logo.logo_path, 'logo.png'); await db.run('UPDATE organismes SET logo_path = $2 WHERE id = $1', [org, nouvelle]); etat.faits++; }
          catch (e) { etat.echecs.push({ fichier: 'logo', erreur: String(e.message).slice(0, 200) }); }
        }
        etat.fin = new Date();
        await audit.log(ctx, { organismeId: org, action: 'ged.migration_stockage', entity: 'files', after: { sens, total: etat.total, faits: etat.faits, echecs: etat.echecs.length, supprimerSource } });
      })().catch((e) => { etat.echecs.push({ fichier: '(migration)', erreur: e.message }); etat.fin = new Date(); });
      return { demarre: true, sens, total: etat.total };
    },
    async idle() { if (migration && !migration.fin) await migration.promesse; },

    // ------------------------------------------------------------------------------------------------ plan de classement
    /** Plan de classement : socle + années utiles (année en cours, années des séances). Idempotent : ce qui existe n'est jamais recréé. */
    async creerPlan(ctx, organismeId) {
      const org = requireOrg(organismeId); const cfg = await cfgOf(org); prerequis(cfg);
      const ad = adapterOf(cfg); const racine = await racineSegments(org);
      const annees = new Set([String(new Date().getFullYear())]);
      for (const r of await db.all('SELECT DISTINCT extract(year FROM date_seance AT TIME ZONE \'Europe/Paris\')::int AS an FROM seances WHERE organisme_id = $1', [org])) annees.add(String(r.an));
      const chemins = [[...racine, { nom: '01 Séances', description: DUA.seances }], [...racine, { nom: '02 Registre des délibérations', description: DUA.registre }]];
      for (const an of [...annees].sort()) { chemins.push([...racine, { nom: '01 Séances' }, { nom: an }], [...racine, { nom: '02 Registre des délibérations' }, { nom: an }]); }
      const seances = await db.all('SELECT s.date_seance, i.nom AS instance_nom FROM seances s JOIN instances i ON i.id = s.instance_id WHERE s.organisme_id = $1 AND s.statut <> \'annulee\' ORDER BY s.date_seance', [org]);
      for (const s of seances) { const base = await dossierSeance(org, { date_seance: s.date_seance, instance_nom: s.instance_nom }); for (const [k, nom] of Object.entries(SOUS)) chemins.push([...base, { nom, description: DUA[k] }]); }
      const crees = [];
      for (const c of chemins) crees.push(...(await ad.ensurePath(cfg, c)).crees);
      const uniques = [...new Set(crees)];
      await db.run('UPDATE ged_config SET plan_cree_le = now() WHERE organisme_id = $1', [org]);
      if (!(await row(org))) await db.run('INSERT INTO ged_config (organisme_id, plan_cree_le, updated_by) VALUES ($1, now(), $2)', [org, ctx.username]);
      await audit.log(ctx, { organismeId: org, action: 'ged.plan', entity: 'ged_config', entityId: org, after: { nouveaux: uniques.length } });
      return { nouveaux: uniques.length, dossiers: uniques, racine: racine[0].nom };
    },

    async explorer(ctx, organismeId, nodeId) {
      const org = requireOrg(organismeId); const cfg = await cfgOf(org); prerequis(cfg);
      return { items: await adapterOf(cfg).enfants(cfg, nodeId || null) };
    },
    async contenu(ctx, organismeId, nodeId) {
      const org = requireOrg(organismeId); const cfg = await cfgOf(org); prerequis(cfg);
      const b = await adapterOf(cfg).contenu(cfg, nodeId);
      if (!b) throw E.notFound('Document introuvable');
      return b;
    },

    // ------------------------------------------------------------------------------------------------ documents à archiver
    /** Tous les documents d'une séance, avec un chemin, un nom, une EMPREINTE de leurs sources (pour ne redéposer que ce qui change) et un producteur paresseux. */
    async documentsSeance(ctx, organismeId, seanceId) {
      const org = requireOrg(organismeId);
      const s = await db.get('SELECT s.*, i.nom AS instance_nom FROM seances s JOIN instances i ON i.id = s.instance_id WHERE s.id = $1 AND s.organisme_id = $2', [seanceId, org]);
      if (!s) throw E.notFound('Séance introuvable');
      const base = await dossierSeance(org, s); const d = day(s.date_seance); const sys = SYS(org, ctx.username);
      const sous = (k, ...plus) => [...base, { nom: SOUS[k], description: DUA[k] }, ...plus.map((nom) => ({ nom }))];
      const docs = [];
      const add = (x) => docs.push({ mime: 'application/pdf', ...x, seanceId });
      const fichier = (k) => async () => storage.get(k);

      // convocation et ordre du jour
      const c = await db.get(`SELECT c.version_no, cf.storage_key AS ck, cf.sha256 AS cs, o.storage_key AS ok, o.sha256 AS os FROM convocations c LEFT JOIN files cf ON cf.id = c.convocation_file_id LEFT JOIN files o ON o.id = c.odj_file_id
                              WHERE c.seance_id = $1 AND c.statut = 'envoyee' ORDER BY c.version_no DESC LIMIT 1`, [seanceId]);
      if (c?.ck) add({ key: `s${seanceId}:convocation`, dossier: sous('convocation'), nom: sur(`${d}_convocation_v${c.version_no}.pdf`), empreinte: c.cs, produire: fichier(c.ck), description: `Convocation (version ${c.version_no})` });
      if (c?.ok) add({ key: `s${seanceId}:odj`, dossier: sous('convocation'), nom: sur(`${d}_ordre-du-jour_v${c.version_no}.pdf`), empreinte: c.os, produire: fichier(c.ok), description: `Ordre du jour (version ${c.version_no})` });

      // dossiers des délibérations
      const items = await db.all(`SELECT it.*, a.titre AS acte_titre, a.updated_at AS acte_maj FROM seance_items it LEFT JOIN actes a ON a.id = it.acte_id WHERE it.seance_id = $1 AND it.statut = 'a_traiter' AND it.kind IN ('deliberation', 'libre') ORDER BY it.position`, [seanceId]);
      const vus = new Set();
      for (const it of items) {
        const titre = it.kind === 'deliberation' ? (await db.get('SELECT titre FROM deliberations WHERE id = $1', [it.deliberation_id]))?.titre || it.acte_titre : it.titre;
        const dossier = sous('dossiers', sur(`${it.numero || it.id} ${titre}`, 90));
        const num = sur(it.numero || String(it.id), 30);
        if (it.kind === 'deliberation' && it.acte_id) {
          const texts = await db.all('SELECT id, kind, version_no, deliberation_id FROM tracked_texts WHERE acte_id = $1 ORDER BY id', [it.acte_id]);
          const tpl = async (t) => (await db.get('SELECT version FROM render_templates WHERE organisme_id = $1 AND doc_type = $2', [org, t]))?.version ?? 0;
          if (!vus.has(it.acte_id)) {
            vus.add(it.acte_id);
            add({ key: `a${it.acte_id}:expose`, acteId: it.acte_id, dossier, nom: sur(`${d}_expose-des-motifs_${num}.pdf`), empreinte: sha({ texts: texts.filter((t) => t.kind === 'expose').map((t) => [t.id, t.version_no]), tpl: await tpl('expose'), maj: it.acte_maj }),
              produire: async () => (await render.renderActe(sys, org, it.acte_id, { cible: 'expose', mode: 'propre' })).buffer, description: `Exposé des motifs — ${titre}` });
          }
          add({ key: `i${it.id}:projet`, acteId: it.acte_id, dossier, nom: sur(`${d}_projet-de-deliberation_${num}.pdf`), empreinte: sha({ texts: texts.filter((t) => t.deliberation_id === it.deliberation_id).map((t) => [t.id, t.version_no]), tpl: await tpl('deliberation'), maj: it.acte_maj }),
            produire: async () => (await render.renderActe(sys, org, it.acte_id, { cible: 'deliberation', deliberationId: it.deliberation_id, mode: 'propre' })).buffer, description: `Projet de délibération — ${titre}` });
          for (const x of await db.all('SELECT an.id, an.titre, f.storage_key, f.sha256, f.mime, f.original_name FROM annexes an JOIN files f ON f.id = an.file_id WHERE an.acte_id = $1 ORDER BY an.ordre, an.id', [it.acte_id])) {
            add({ key: `n${x.id}:annexe`, acteId: it.acte_id, dossier, nom: sur(`${d}_annexe_${num}_${x.titre || x.original_name}${/\.[a-z0-9]{2,4}$/i.test(x.titre || '') ? '' : `.${(x.original_name.split('.').pop() || 'pdf').toLowerCase()}`}`), mime: x.mime, empreinte: x.sha256, produire: fichier(x.storage_key), description: `Annexe — ${x.titre}` });
          }
        } else {
          for (const x of await db.all('SELECT f.id, f.titre, fl.storage_key, fl.sha256, fl.mime, fl.original_name FROM seance_item_fichiers f JOIN files fl ON fl.id = f.file_id WHERE f.item_id = $1 ORDER BY f.ordre, f.id', [it.id])) {
            add({ key: `f${x.id}:piece`, dossier, nom: sur(`${d}_piece_${num}_${x.titre || x.original_name}${/\.[a-z0-9]{2,4}$/i.test(x.titre || '') ? '' : `.${(x.original_name.split('.').pop() || 'pdf').toLowerCase()}`}`), mime: x.mime, empreinte: x.sha256, produire: fichier(x.storage_key), description: `Pièce — ${titre}` });
          }
        }
      }

      // cahier de séance : dernière version terminée de chaque profil
      for (const b of await db.all(`SELECT DISTINCT ON (b.profil) b.profil, b.version_no, f.storage_key, f.sha256 FROM cahier_builds b JOIN files f ON f.id = b.file_id WHERE b.seance_id = $1 AND b.statut = 'done' ORDER BY b.profil, b.version_no DESC`, [seanceId])) {
        add({ key: `s${seanceId}:cahier:${b.profil}`, dossier: sous('cahier'), nom: sur(`${d}_cahier-de-seance_${b.profil}_v${b.version_no}.pdf`), empreinte: b.sha256, produire: fichier(b.storage_key), description: `Cahier de séance (profil ${b.profil}, version ${b.version_no})` });
      }

      // suivi de séance : procès-verbal, liste, extraits du registre
      const t = await db.get('SELECT version, statut FROM seance_tenue WHERE seance_id = $1', [seanceId]);
      if (t) {
        const tok = sha({ v: t.version, s: t.statut });
        add({ key: `s${seanceId}:pv`, dossier: sous('suivi'), nom: sur(`${d}_proces-verbal${t.statut === 'close' ? '' : '_projet'}.pdf`), empreinte: tok, produire: async () => (await pv.proces(ctx, org, seanceId, { notes: false })).buffer, description: `Procès-verbal de la séance du ${d}${t.statut === 'close' ? '' : ' (projet, séance non close)'}` });
        add({ key: `s${seanceId}:liste`, dossier: sous('suivi'), nom: sur(`${d}_liste-des-deliberations.pdf`), empreinte: tok, produire: async () => (await pv.liste(ctx, org, seanceId)).buffer, description: 'Liste des délibérations' });
        const an = day(s.date_seance).slice(0, 4);
        for (const p of await db.all("SELECT p.item_id, p.resultat, it.numero FROM seance_points p JOIN seance_items it ON it.id = p.item_id WHERE p.seance_id = $1 AND p.etat = 'traite' AND p.resultat LIKE 'adopte%' AND it.kind = 'deliberation' ORDER BY it.position", [seanceId])) {
          add({ key: `i${p.item_id}:extrait`, dossier: [...(await racineSegments(org)), { nom: '02 Registre des délibérations', description: DUA.registre }, { nom: an }], nom: sur(`${d}_extrait-du-registre_${p.numero || p.item_id}.pdf`), empreinte: sha({ tok, r: p.resultat }),
            produire: async () => (await pv.extrait(ctx, org, seanceId, p.item_id)).buffer, description: `Extrait du registre des délibérations — point ${p.numero || p.item_id}` });
        }
      }

      // contrôle de légalité : AR, bordereau, acte tamponné
      for (const x of await db.all("SELECT * FROM tlt_transactions WHERE seance_id = $1 AND etat = 'poste' AND ar_id IS NOT NULL", [seanceId])) {
        add({ key: `t${x.id}:bordereau`, acteId: x.acte_id, dossier: sous('legalite'), nom: sur(`${d}_bordereau-acquittement_${x.numero_transmis}.pdf`), empreinte: sha({ ar: x.ar_id }), produire: async () => (await tlt.bordereau(ctx, org, x.id)).buffer, description: `Bordereau d’acquittement — ${x.numero_transmis} (${x.ar_id})` });
        add({ key: `t${x.id}:acte`, acteId: x.acte_id, dossier: sous('legalite'), nom: sur(`${d}_acte-transmis_${x.numero_transmis}.pdf`), empreinte: sha({ f: x.file_id, ar: x.ar_id }), produire: async () => (await tlt.acteTamponne(ctx, org, x.id)).buffer, description: `Acte transmis et tamponné — ${x.numero_transmis}` });
      }
      return { seance: s, docs };
    },

    /** Archive (ou met à jour) tous les documents de la séance : idempotent, un échec n'arrête pas les autres et reste rejouable. */
    async archiverSeance(ctx, organismeId, seanceId) {
      const org = requireOrg(organismeId); const cfg = await cfgOf(org); prerequis(cfg);
      const ad = adapterOf(cfg); const { seance, docs } = await svc.documentsSeance(ctx, org, seanceId);
      const out = { deposes: 0, nouvellesVersions: 0, inchanges: 0, erreurs: 0, documents: [] };
      const dossiers = new Map();
      for (const doc of docs) {
        const chemin = doc.dossier.map((x) => x.nom).join(' / ');
        try {
          const ex = await db.get('SELECT * FROM ged_documents WHERE organisme_id = $1 AND doc_key = $2', [org, doc.key]);
          if (ex && ex.statut === 'ok' && ex.sha256 === doc.empreinte && ex.mode === cfg.mode && ex.chemin === chemin && ex.nom === doc.nom) { out.inchanges++; out.documents.push({ nom: doc.nom, chemin, etat: 'inchange', version: ex.version_label }); continue; }
          let dossierId = dossiers.get(chemin);
          if (!dossierId) { dossierId = (await ad.ensurePath(cfg, doc.dossier)).id; dossiers.set(chemin, dossierId); }
          const buffer = await doc.produire();
          const r = await ad.deposer(cfg, dossierId, { nom: doc.nom, buffer, mime: doc.mime, description: `${doc.description} — ${seance.instance_nom} du ${day(seance.date_seance)}`, proprietes: {} });
          await db.run(`INSERT INTO ged_documents (organisme_id, seance_id, acte_id, doc_key, nom, chemin, node_id, version_label, sha256, taille, mode, statut, erreur, archive_par, archive_le) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ok',NULL,$12, now())
                        ON CONFLICT (organisme_id, doc_key) DO UPDATE SET seance_id = EXCLUDED.seance_id, acte_id = EXCLUDED.acte_id, nom = EXCLUDED.nom, chemin = EXCLUDED.chemin, node_id = EXCLUDED.node_id, version_label = EXCLUDED.version_label,
                          sha256 = EXCLUDED.sha256, taille = EXCLUDED.taille, mode = EXCLUDED.mode, statut = 'ok', erreur = NULL, archive_par = EXCLUDED.archive_par, archive_le = now()`,
          [org, seanceId, doc.acteId ?? null, doc.key, doc.nom, chemin, r.nodeId, r.versionLabel, doc.empreinte, buffer.length, cfg.mode, ctx.username]);
          if (r.nouvelleVersion) out.nouvellesVersions++; else out.deposes++;
          out.documents.push({ nom: doc.nom, chemin, etat: r.nouvelleVersion ? 'nouvelle_version' : 'depose', version: r.versionLabel });
        } catch (e) {
          out.erreurs++; out.documents.push({ nom: doc.nom, chemin, etat: 'erreur', erreur: e.message });
          await db.run(`INSERT INTO ged_documents (organisme_id, seance_id, acte_id, doc_key, nom, chemin, mode, statut, erreur, archive_par) VALUES ($1,$2,$3,$4,$5,$6,$7,'erreur',$8,$9)
                        ON CONFLICT (organisme_id, doc_key) DO UPDATE SET statut = 'erreur', erreur = EXCLUDED.erreur, archive_par = EXCLUDED.archive_par, archive_le = now()`, [org, seanceId, doc.acteId ?? null, doc.key, doc.nom, chemin, cfg.mode, String(e.message).slice(0, 500), ctx.username]).catch(() => undefined);
          log?.warn({ err: e.message, doc: doc.nom }, 'archivage GED : échec (rejouable)');
        }
      }
      await audit.log(ctx, { organismeId: org, action: 'ged.archivage', entity: 'seances', entityId: seanceId, after: { deposes: out.deposes, nouvellesVersions: out.nouvellesVersions, inchanges: out.inchanges, erreurs: out.erreurs } });
      return out;
    },

    /** Archivage automatique à la clôture de la séance : ne lève jamais d'erreur vers l'appelant. */
    async auto(p) {
      try {
        const cfg = await cfgOf(p.organismeId);
        if (!cfg.actif || !cfg.autoArchivage) return null;
        return await svc.archiverSeance(SYS(p.organismeId, 'ged-auto'), p.organismeId, p.seanceId);
      } catch (e) { log?.error({ err: e.message, seance: p.seanceId }, 'archivage automatique GED en échec'); return null; }
    },

    // ------------------------------------------------------------------------------------------ synchronisation (GED-08, D93)
    /**
     * État comparé, séance par séance : ce que VibeDélib produit (documents locaux) face à ce qui est déposé en GED.
     * `aArchiver` : jamais déposé ; `aMettreAJour` : déposé mais modifié depuis ; `enErreur` / `manquants` : à rejouer ; `synchronises` : identique en GED.
     */
    async etatSynchro(ctx, organismeId) {
      const org = requireOrg(organismeId); const cfg = await cfgOf(org);
      const liste = await db.all(
        `SELECT s.id, s.date_seance, s.statut, i.nom AS instance_nom FROM seances s JOIN instances i ON i.id = s.instance_id
         WHERE s.organisme_id = $1 AND s.statut <> 'annulee' ORDER BY s.date_seance DESC LIMIT 60`, [org]);
      const deposes = new Map();
      for (const r of await db.all('SELECT doc_key, sha256, statut, mode, chemin, nom FROM ged_documents WHERE organisme_id = $1', [org])) deposes.set(r.doc_key, r);
      const out = [];
      for (const s of liste) {
        let docs;
        try { docs = (await svc.documentsSeance(SYS(org, ctx.username), org, s.id)).docs; } catch { docs = []; }
        const c = { aArchiver: 0, aMettreAJour: 0, enErreur: 0, manquants: 0, synchronises: 0 };
        for (const d of docs) {
          const ex = deposes.get(d.key);
          if (!ex) c.aArchiver++;
          else if (ex.statut === 'erreur') c.enErreur++;
          else if (ex.statut === 'manquant') c.manquants++;
          else if (ex.sha256 !== d.empreinte || ex.mode !== cfg.mode || ex.nom !== d.nom) c.aMettreAJour++;
          else c.synchronises++;
        }
        out.push({ seanceId: s.id, instance: s.instance_nom, dateSeance: s.date_seance, statut: s.statut, documents: docs.length, ...c, aFaire: c.aArchiver + c.aMettreAJour + c.enErreur + c.manquants });
      }
      return { mode: cfg.mode, actif: cfg.actif, autoArchivage: cfg.autoArchivage, seances: out, aFaire: out.reduce((n, x) => n + x.aFaire, 0) };
    },

    /**
     * Local → GED : dépose (ou met à jour, en nouvelle version) tout ce qui n'y est pas encore, pour les séances indiquées (toutes sinon).
     * Idempotent et rejouable ; un échec sur une séance n'arrête pas les autres.
     */
    async synchroniser(ctx, organismeId, { seanceIds } = {}) {
      const org = requireOrg(organismeId); const cfg = await cfgOf(org); prerequis(cfg);
      const etat = await svc.etatSynchro(ctx, org);
      const cibles = etat.seances.filter((x) => x.aFaire > 0 && (!seanceIds?.length || seanceIds.includes(x.seanceId)));
      const out = { seances: [], deposes: 0, nouvellesVersions: 0, erreurs: 0 };
      for (const x of cibles) {
        try {
          const r = await svc.archiverSeance(ctx, org, x.seanceId);
          out.deposes += r.deposes; out.nouvellesVersions += r.nouvellesVersions; out.erreurs += r.erreurs;
          out.seances.push({ seanceId: x.seanceId, instance: x.instance, dateSeance: x.dateSeance, deposes: r.deposes, nouvellesVersions: r.nouvellesVersions, inchanges: r.inchanges, erreurs: r.erreurs });
        } catch (e) { out.erreurs++; out.seances.push({ seanceId: x.seanceId, instance: x.instance, dateSeance: x.dateSeance, erreur: e.message }); }
      }
      await audit.log(ctx, { organismeId: org, action: 'ged.synchronisation', entity: 'ged_documents', after: { seances: cibles.length, deposes: out.deposes, nouvellesVersions: out.nouvellesVersions, erreurs: out.erreurs } });
      return out;
    },

    /**
     * GED → local : vérifie que chaque document déposé existe toujours dans la GED (supprimé ou déplacé à la main, dépôt réinitialisé…).
     * Les absents sont marqués « manquant » : la prochaine synchronisation les redépose depuis VibeDélib, qui reste la source.
     */
    async verifier(ctx, organismeId) {
      const org = requireOrg(organismeId); const cfg = await cfgOf(org); prerequis(cfg);
      const ad = adapterOf(cfg);
      const rows = await db.all("SELECT id, nom, chemin, node_id, seance_id FROM ged_documents WHERE organisme_id = $1 AND statut = 'ok' AND node_id IS NOT NULL AND mode = $2", [org, cfg.mode]);
      const out = { verifies: rows.length, manquants: [], erreurs: 0 };
      for (const r of rows) {
        try {
          if (!(await ad.existe(cfg, r.node_id))) {
            await db.run("UPDATE ged_documents SET statut = 'manquant', erreur = 'Absent de la GED lors de la vérification' WHERE id = $1", [r.id]);
            out.manquants.push({ nom: r.nom, chemin: r.chemin, seanceId: r.seance_id });
          }
        } catch { out.erreurs++; }
      }
      await audit.log(ctx, { organismeId: org, action: 'ged.verification', entity: 'ged_documents', after: { verifies: out.verifies, manquants: out.manquants.length, erreurs: out.erreurs } });
      return out;
    },

    async documents(ctx, organismeId, { seanceId } = {}) {
      const org = requireOrg(organismeId); const p = [org]; let w = '';
      if (seanceId) { p.push(seanceId); w = 'AND seance_id = $2'; }
      const rows = await db.all(`SELECT * FROM ged_documents WHERE organisme_id = $1 ${w} ORDER BY archive_le DESC LIMIT 500`, p);
      return { items: rows.map((r) => ({ id: r.id, seanceId: r.seance_id, acteId: r.acte_id, nom: r.nom, chemin: r.chemin, nodeId: r.node_id, version: r.version_label, taille: r.taille, mode: r.mode, statut: r.statut, erreur: r.erreur, archivePar: r.archive_par, archiveLe: r.archive_le })) };
    },
  };
  void cahier; void tenue;
  return svc;
}

module.exports = { createGed, sur };
