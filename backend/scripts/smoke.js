/**
 * Test de fumée contre un backend DÉJÀ démarré (par défaut http://localhost:3021) avec les vrais services.
 * Utilise le compte de secours du .env (jamais affiché). Ne consigne que des statuts et des comptages.
 *   node scripts/smoke.js [urlDeBase]
 */
const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const base = process.argv[2] || `http://localhost:${process.env.PORT || 3021}`;
const http = axios.create({ baseURL: base, timeout: 20000, validateStatus: () => true });
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`); };

(async () => {
  const st = await http.get('/api/status');
  check('GET /api/status', st.status === 200, `${st.data.status}; base ${st.data.dependencies?.database?.ms} ms, migrations ${st.data.dependencies?.database?.migrations}; APM ${st.data.dependencies?.apm?.ok ? 'ok' : 'KO'}; Hub ${st.data.dependencies?.hub?.ok ? 'ok' : 'KO'}`);

  const bad = await http.post('/api/v1/auth/login-local', { username: process.env.LOCAL_ADMIN_USERNAME, password: 'mauvais-mot-de-passe' });
  check('mauvais mot de passe de secours -> 401', bad.status === 401);

  const lg = await http.post('/api/v1/auth/login-local', { username: process.env.LOCAL_ADMIN_USERNAME, password: process.env.LOCAL_ADMIN_PASSWORD });
  check('connexion du compte de secours', lg.status === 200 && !!lg.data.token, `HTTP ${lg.status}`);
  if (lg.status !== 200) return process.exit(1);
  const auth = { headers: { Authorization: `Bearer ${lg.data.token}` } };

  const me = await http.get('/api/v1/me', auth);
  check('GET /me', me.status === 200 && me.data.isPlatformAdmin === true, `administrateur de plateforme=${me.data.isPlatformAdmin}, organismes=${me.data.organismes?.map((o) => o.code).join(',')}, tutoriel à proposer=${me.data.onboarding?.toShow?.length}`);

  const orgs = await http.get('/api/v1/organismes', auth);
  check('GET /organismes', orgs.status === 200 && orgs.data.items.some((o) => o.isDefault), `${orgs.data.items?.length} organisme(s)`);

  const dirs = await http.get('/api/v1/directory/directions', auth);
  const ccas = dirs.data.items?.find((d) => /CCAS/i.test(d.label));
  check('GET /directory/directions (Hub réel)', dirs.status === 200 && dirs.data.items.length > 5, `${dirs.data.items?.length} directions, direction CCAS trouvée=${!!ccas}${ccas ? ` (code ${ccas.code})` : ''}`);

  const chart = await http.get('/api/v1/directory/organisation', auth);
  check('GET /directory/organisation (Hub réel)', chart.status === 200 && chart.data.items.length > 5, `${chart.data.items?.length} directions avec responsables`);

  const q = process.env.SPIKE_AD_QUERY || 'chevalier';
  const ag = await http.get('/api/v1/directory/agents/search', { ...auth, params: { q } });
  check('GET /directory/agents/search (RH Studio via Hub)', ag.status === 200, `${ag.data.items?.length} résultat(s)`);

  const docs = await http.get('/swagger.json');
  check('GET /swagger.json', docs.status === 200, `${Object.keys(docs.data.paths).length} chemins documentés`);

  const out = await http.post('/api/v1/auth/logout', {}, auth);
  const after = await http.get('/api/v1/me', auth);
  check('déconnexion puis jeton refusé', out.status === 204 && after.status === 401);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERREUR', e.message); process.exit(1); });
