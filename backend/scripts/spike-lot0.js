/**
 * Spike d'intégration du lot 0 (jetable) — LOT0.md §4.
 * Ne consigne QUE des statuts, des noms de champs et des comptages : aucune donnée personnelle.
 *   node scripts/spike-lot0.js            (lit ../.env)
 * Variables facultatives : SPIKE_AD_QUERY (défaut « machevalier »), SPIKE_AD_USER / SPIKE_AD_PASS (S1).
 */
const path = require('path');
const https = require('https');
const axios = require('axios');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const allowSelfSigned = String(process.env.VILLE_ALLOW_SELF_SIGNED_CERTS).toLowerCase() === 'true';
const httpsAgent = new https.Agent({ rejectUnauthorized: !allowSelfSigned });
const http = axios.create({ timeout: 15000, httpsAgent, validateStatus: () => true });

const out = [];
const log = (id, ok, detail) => { out.push({ id, ok, detail }); console.log(`${ok ? 'OK ' : 'KO '} ${id} — ${detail}`); };
const keysOf = (o) => (o && typeof o === 'object') ? Object.keys(Array.isArray(o) ? (o[0] || {}) : o).slice(0, 25).join(', ') : typeof o;
const timed = async (fn) => { const t = Date.now(); const r = await fn(); return [r, Date.now() - t]; };

async function s5() {
  const c = new Client({
    host: process.env.POSTGRES_HOST, port: process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, connectionTimeoutMillis: 10000,
  });
  try {
    const [, ms] = await timed(() => c.connect());
    const v = (await c.query("select split_part(version(),' ',2) v, current_user u, has_database_privilege(current_user, current_database(), 'CREATE') can_create, (select rolsuper from pg_roles where rolname=current_user) su")).rows[0];
    await c.query('create schema if not exists ivrydelib_spike');
    await c.query('create table ivrydelib_spike.t (id int)');
    await c.query('drop schema ivrydelib_spike cascade');
    const ext = (await c.query("select name from pg_available_extensions where name in ('pgcrypto','unaccent','pg_trgm','vector') order by 1")).rows.map(r => r.name);
    const sch = (await c.query("select count(*)::int n from information_schema.schemata where schema_name='ivrydelib'")).rows[0].n;
    log('S5', true, `PostgreSQL ${v.v}, connexion ${ms} ms, superuser=${v.su}, CREATE=${v.can_create}, schéma test créé/supprimé, schéma ivrydelib existant=${sch === 1}, extensions disponibles: ${ext.join(', ')}`);
  } catch (e) { log('S5', false, e.message); } finally { await c.end().catch(() => {}); }
}

async function apm() {
  const base = process.env.APM_API_URL.replace(/\/+$/, ''); const h = { 'X-API-KEY': process.env.APM_API_KEY };
  const [st, ms] = await timed(() => http.get(`${base}/api/status`));
  log('S6-apm', st.status === 200, `GET /api/status → ${st.status} en ${ms} ms`);
  const q = process.env.SPIKE_AD_QUERY || 'machevalier';
  const [r, ms2] = await timed(() => http.get(`${base}/api/v1/ad/search`, { headers: h, params: { q } }));
  const d = r.data; const list = Array.isArray(d) ? d : (d?.data || d?.users || d?.results || []);
  log('S2-ad-search', r.status === 200, `GET /api/v1/ad/search → ${r.status} en ${ms2} ms, ${Array.isArray(list) ? list.length : '?'} résultat(s), champs: ${keysOf(list)}`);
  const first = Array.isArray(list) ? list[0] : null;
  const ident = first && (first.sAMAccountName || first.username || first.login || first.mail);
  if (ident) {
    const [u, ms3] = await timed(() => http.get(`${base}/api/v1/ad/user`, { headers: h, params: { identifier: ident } }));
    log('S2-ad-user', u.status === 200, `GET /api/v1/ad/user → ${u.status} en ${ms3} ms, champs: ${keysOf(u.data?.data || u.data)}`);
  }
  if (process.env.SPIKE_AD_USER && process.env.SPIKE_AD_PASS) {
    for (const name of [process.env.SPIKE_AD_USER, process.env.SPIKE_AD_USER.toUpperCase()]) {
      const a = await http.post(`${base}/api/v1/ad/authenticate`, { username: name, password: process.env.SPIKE_AD_PASS }, { headers: h });
      log('S1-' + (name === process.env.SPIKE_AD_USER ? 'casse-origine' : 'casse-majuscule'), a.status === 200 && a.data?.success, `POST ad/authenticate → ${a.status}`);
    }
  } else log('S1', false, 'non exécuté : SPIKE_AD_USER / SPIKE_AD_PASS absents');
  const [ai, ms4] = await timed(() => http.get(`${base}/api/v1/ai/models`, { headers: h }));
  log('IA-models', ai.status === 200, `GET /api/v1/ai/models → ${ai.status} en ${ms4} ms`);
}

async function hub() {
  const base = process.env.HUBDSI_API_URL.replace(/\/+$/, ''); const h = { 'X-API-Key': process.env.HUBDSI_API_KEY };
  for (const p of ['/api/ville/config', '/api/ville/elus', '/api/directions-services', '/api/admin/rh/services-tree', '/api/admin/rh/organisation-chart']) {
    const [r, ms] = await timed(() => http.get(base + p, { headers: h }));
    const d = r.data; const n = Array.isArray(d) ? d.length : (d && typeof d === 'object' ? Object.keys(d).length : '-');
    log('S4-hub ' + p, r.status === 200, `→ ${r.status} en ${ms} ms, éléments/clés: ${n}, champs: ${keysOf(d)}`);
  }
}

async function studio() {
  const base = process.env.STUDIORH_API_URL.replace(/\/+$/, ''); const h = { 'x-api-key': process.env.STUDIORH_API_KEY, Accept: 'application/json' };
  const [r, ms] = await timed(() => http.get(`${base}/agents/search`, { headers: h, params: { q: 'chevalier' }, maxRedirects: 0 }));
  const list = Array.isArray(r.data?.data) ? r.data.data : (Array.isArray(r.data) ? r.data : []);
  log('S3-studio agents/search', r.status === 200, `→ ${r.status} en ${ms} ms, ${list.length} résultat(s), champs: ${keysOf(list)}`);
  const paths = ['/agents/presence?email=x@ivry94.fr', '/organisation', '/organisation/tree', '/organisation/directions', '/directions', '/services', '/api/organisation', '/organigramme', '/structure'];
  for (const p of paths) {
    const [x] = await timed(() => http.get(base + p, { headers: h, maxRedirects: 0 }));
    const d = x.data; const isJson = d && typeof d === 'object';
    log('S4-studio ' + p, x.status === 200 && isJson, `→ ${x.status}${isJson ? `, champs: ${keysOf(d)}` : ' (non JSON)'}`);
  }
}

(async () => {
  await s5();
  for (const f of [apm, hub, studio]) { try { await f(); } catch (e) { log(f.name, false, e.message); } }
  require('fs').mkdirSync(path.resolve(__dirname, '../docs'), { recursive: true });
  const md = ['# Spike lot 0 — résultats', '', `Exécuté le ${new Date().toISOString()} (aucune donnée personnelle consignée)`, '', '| Test | Résultat | Détail |', '|---|---|---|',
    ...out.map(o => `| ${o.id} | ${o.ok ? 'OK' : 'KO'} | ${String(o.detail).replace(/\|/g, '/')} |`), ''].join('\n');
  require('fs').writeFileSync(path.resolve(__dirname, '../docs/spike-lot0.auto.md'), md);
})();
