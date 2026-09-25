/**
 * Adaptateur GedPort — ALFRESCO, API REST publique v1 (D86).
 *   GET  /alfresco/api/discovery                                 version et édition du dépôt (sert de test d'authentification)
 *   GET  /nodes/{id}?relativePath=…                              résolution du dossier racine et des dossiers existants
 *   POST /nodes/{parent}/children  (JSON)                        création d'un dossier (nodeType cm:folder)
 *   POST /nodes/{parent}/children  (multipart : filedata, name…) dépôt d'un document
 *   PUT  /nodes/{id}/content?majorVersion=true                   nouvelle version d'un document existant
 *   GET  /nodes/{id}/children · GET /nodes/{id}/content          exploration et lecture
 * Authentification HTTP Basic (compte technique). L'appelant fournit `cfg` = { url, utilisateur, motDePasse, racine } ;
 * `http` (axios-like) est injectable pour les tests. Les identifiants ne sont jamais journalisés.
 */
const { createHttpClient } = require('./http-client');
const { E } = require('../shared/errors');

const API = '/alfresco/api/-default-/public/alfresco/versions/1';

function createAlfresco({ tls, http: injected } = {}) {
  const clientOf = (cfg) => injected || createHttpClient({
    baseURL: String(cfg.url || '').replace(/\/+$/, ''), tls, timeoutMs: 30000,
    headers: { Authorization: `Basic ${Buffer.from(`${cfg.utilisateur}:${cfg.motDePasse}`).toString('base64')}`, Accept: 'application/json' },
  });
  const explain = (r) => {
    if (r.status === 401 || r.status === 403) return 'Identifiants refusés par Alfresco (compte technique ou droits insuffisants)';
    if (r.status === 404) return 'Ressource introuvable (URL du serveur ou dossier racine erroné ?)';
    return `Alfresco a répondu HTTP ${r.status}${r.data?.error?.briefSummary ? ` : ${r.data.error.briefSummary}` : ''}`;
  };
  const failNet = (e) => E.upstream(`Alfresco injoignable : ${e.code || e.message}`);

  /** Racine : identifiant de nœud, ou chemin relatif à Company Home (« /Sites/archives/documentLibrary »). */
  async function racineId(http, cfg) {
    const r = cfg.racine && cfg.racine !== '-root-' ? String(cfg.racine) : '-root-';
    if (r === '-root-' || /^[0-9a-f-]{36}$/i.test(r)) return r;
    const res = await http.get(`${API}/nodes/-root-`, { params: { relativePath: r.replace(/^\/+/, ''), fields: 'id,name,isFolder' } });
    if (res.status !== 200 || !res.data?.entry?.isFolder) throw E.conflict(`Dossier racine « ${r} » introuvable dans Alfresco`);
    return res.data.entry.id;
  }

  return {
    mode: 'alfresco',

    async testConnexion(cfg) {
      const t = Date.now();
      try {
        const http = clientOf(cfg);
        const d = await http.get('/alfresco/api/discovery');
        if (d.status !== 200) return { ok: false, message: explain(d), details: { etape: 'authentification', http: d.status } };
        const repo = d.data?.entry?.repository || {};
        let racine = null;
        try { const id = await racineId(http, cfg); const n = await http.get(`${API}/nodes/${id}`, { params: { fields: 'id,name,isFolder' } }); racine = n.status === 200 ? { id: n.data.entry.id, nom: n.data.entry.name } : null; } catch (e) { return { ok: false, message: e.message, details: { etape: 'dossier racine' } }; }
        if (!racine) return { ok: false, message: 'Dossier racine illisible (droits insuffisants ?)', details: { etape: 'dossier racine' } };
        return { ok: true, message: 'Connexion à Alfresco réussie', details: { serveur: 'Alfresco', version: repo.version?.display || repo.version?.major || null, edition: repo.edition || null, racine, ms: Date.now() - t } };
      } catch (e) { return { ok: false, message: `Alfresco injoignable : ${e.code || e.message}`, details: { etape: 'réseau' } }; }
    },

    async ensurePath(cfg, segments) {
      const http = clientOf(cfg); let cur = await racineId(http, cfg).catch((e) => { throw e; }); const crees = []; const chemin = [];
      for (const seg of segments) {
        chemin.push(seg.nom);
        let existant = await http.get(`${API}/nodes/${cur}`, { params: { relativePath: seg.nom, fields: 'id,isFolder' } }).catch((e) => { throw failNet(e); });
        if (existant.status === 200 && existant.data?.entry?.isFolder) { cur = existant.data.entry.id; continue; }
        const c = await http.post(`${API}/nodes/${cur}/children`, { name: seg.nom, nodeType: 'cm:folder', properties: { 'cm:title': seg.nom, ...(seg.description ? { 'cm:description': seg.description } : {}) } }, { params: { autoRename: false } }).catch((e) => { throw failNet(e); });
        if (c.status === 409) { existant = await http.get(`${API}/nodes/${cur}`, { params: { relativePath: seg.nom } }); cur = existant.data.entry.id; continue; }
        if (c.status !== 201) throw E.upstream(`Création du dossier « ${seg.nom} » : ${explain(c)}`);
        cur = c.data.entry.id; crees.push(chemin.join(' / '));
      }
      return { id: cur, crees };
    },

    async deposer(cfg, dossierId, { nom, buffer, mime = 'application/pdf', titre, description, auteur, proprietes }) {
      const http = clientOf(cfg);
      const form = new FormData();
      form.append('filedata', new Blob([buffer], { type: mime }), nom);
      form.append('name', nom); form.append('nodeType', 'cm:content'); form.append('autoRename', 'false');
      form.append('cm:title', String(titre || nom.replace(/\.[^.]+$/, '')).slice(0, 250));
      const desc = [description, auteur ? `Déposé par : ${auteur}` : null].filter(Boolean).join('\n');
      if (desc) form.append('cm:description', desc.slice(0, 4000));
      for (const [k, v] of Object.entries(proprietes || {})) if (v !== undefined && v !== null) form.append(k, String(v));
      const r = await http.post(`${API}/nodes/${dossierId}/children`, form, { maxBodyLength: Infinity, maxContentLength: Infinity }).catch((e) => { throw failNet(e); });
      if (r.status === 201) return { nodeId: r.data.entry.id, versionLabel: r.data.entry.properties?.['cm:versionLabel'] || '1.0', nouveau: true, nouvelleVersion: false };
      if (r.status === 409) { // le document existe : nouvelle VERSION du même nœud (jamais de doublon)
        const ex = await http.get(`${API}/nodes/${dossierId}`, { params: { relativePath: nom, fields: 'id' } });
        if (ex.status !== 200) throw E.upstream(`Dépôt de « ${nom} » : ${explain(ex)}`);
        const id = ex.data.entry.id;
        const u = await http.put(`${API}/nodes/${id}/content`, buffer, { params: { majorVersion: true, comment: 'Nouvelle version déposée par VibeDélib' }, headers: { 'Content-Type': mime }, maxBodyLength: Infinity }).catch((e) => { throw failNet(e); });
        if (u.status !== 200) throw E.upstream(`Nouvelle version de « ${nom} » : ${explain(u)}`);
        return { nodeId: id, versionLabel: u.data?.entry?.properties?.['cm:versionLabel'] || null, nouveau: false, nouvelleVersion: true };
      }
      throw E.upstream(`Dépôt de « ${nom} » : ${explain(r)}`);
    },

    /** Déplace un nœud sous un autre parent (les enfants suivent ; l'identifiant du nœud ne change pas). */
    async deplacer(cfg, nodeId, parentId) {
      const http = clientOf(cfg);
      const r = await http.post(`${API}/nodes/${nodeId}/move`, { targetParentId: parentId }, { headers: { 'Content-Type': 'application/json' } }).catch((e) => { throw failNet(e); });
      if (r.status !== 200) throw E.upstream(`Déplacement du nœud ${nodeId} : ${explain(r)}`);
      return r.data.entry.id;
    },

    /** Met à jour le nom et/ou les propriétés d'un nœud (cm:title, cm:description). */
    async majNode(cfg, nodeId, { name, titre, description } = {}) {
      const http = clientOf(cfg);
      const body = {};
      if (name) body.name = name;
      const properties = {};
      if (titre !== undefined) properties['cm:title'] = String(titre).slice(0, 250);
      if (description !== undefined) properties['cm:description'] = String(description).slice(0, 4000);
      if (Object.keys(properties).length) body.properties = properties;
      if (!Object.keys(body).length) return null;
      const r = await http.put(`${API}/nodes/${nodeId}`, body, { headers: { 'Content-Type': 'application/json' } }).catch((e) => { throw failNet(e); });
      if (r.status !== 200) throw E.upstream(`Mise à jour du nœud ${nodeId} : ${explain(r)}`);
      return r.data.entry;
    },

    /** État d'un nœud (nom et nom du parent), pour savoir s'il est déjà classé. */
    async nodeInfo(cfg, nodeId) {
      const http = clientOf(cfg);
      const r = await http.get(`${API}/nodes/${nodeId}`, { params: { include: 'path' }, fields: 'id,name,path' }).catch((e) => { throw failNet(e); });
      if (r.status !== 200) return null;
      const path = r.data.entry.path?.elements || [];
      return { id: r.data.entry.id, nom: r.data.entry.name, parentNom: path.length ? path[path.length - 1].name : null };
    },

    async enfants(cfg, nodeId) {
      const http = clientOf(cfg); const parent = nodeId || (await racineId(http, cfg));
      const r = await http.get(`${API}/nodes/${parent}/children`, { params: { maxItems: 500, orderBy: 'name', include: 'properties', fields: 'id,name,isFolder,content,modifiedAt,properties' } }).catch((e) => { throw failNet(e); });
      if (r.status !== 200) throw E.upstream(explain(r));
      return (r.data?.list?.entries || []).map(({ entry: n }) => ({ id: n.id, nom: n.name, dossier: !!n.isFolder, taille: n.content?.sizeInBytes ?? null, version: n.properties?.['cm:versionLabel'] ?? null, modifieLe: n.modifiedAt, description: n.properties?.['cm:description'] ?? null }));
    },

    /** Supprime un nœud (stockage applicatif : nettoyage à la demande, jamais par défaut). */
    async supprimer(cfg, nodeId) {
      const http = clientOf(cfg);
      const r = await http.delete(`${API}/nodes/${nodeId}`, { params: { permanent: true } }).catch((e) => { throw failNet(e); });
      if (![204, 404].includes(r.status)) throw E.upstream(explain(r));
    },

    /** Le nœud existe-t-il encore dans la GED ? (vérification, sans télécharger le contenu) */
    async existe(cfg, nodeId) {
      const http = clientOf(cfg);
      const r = await http.get(`${API}/nodes/${nodeId}`, { params: { fields: 'id' } }).catch((e) => { throw failNet(e); });
      if (r.status === 200) return true;
      if (r.status === 404) return false;
      throw E.upstream(explain(r));
    },

    async contenu(cfg, nodeId) {
      const http = clientOf(cfg);
      const r = await http.get(`${API}/nodes/${nodeId}/content`, { responseType: 'arraybuffer' }).catch((e) => { throw failNet(e); });
      if (r.status !== 200) throw E.upstream(explain(r));
      return Buffer.from(r.data);
    },
  };
}

module.exports = { createAlfresco, API };
