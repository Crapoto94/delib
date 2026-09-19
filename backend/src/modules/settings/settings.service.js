/**
 * Paramètres hiérarchiques (MOR-10, MOR-11) : plateforme -> organisme -> instance -> type d'acte.
 * La valeur la plus spécifique l'emporte ; la réponse indique l'ORIGINE de chaque valeur (« hérité de : plateforme »).
 * Le préfixe d'organisme des portées instance / type d'acte est imposé par le serveur : un paramètre ne peut jamais
 * relever de deux organismes (isolation).
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const ORDER = ['platform', 'organisme', 'instance', 'type_acte']; // du plus général au plus spécifique

function scopeId(scope, organismeId, subId) {
  if (scope === 'platform') return '';
  if (scope === 'organisme') return String(requireOrg(organismeId));
  const sub = Number(subId);
  if (!Number.isInteger(sub) || sub <= 0) throw E.badRequest(`Identifiant de ${scope} requis`);
  return `${requireOrg(organismeId)}:${sub}`;
}

function createSettings({ db, audit }) {
  const value = (r) => r.value;

  async function resolve(organismeId, { instanceId, typeActeId } = {}) {
    const org = requireOrg(organismeId);
    const rows = await db.all(
      `SELECT scope, scope_id, key, value FROM settings
       WHERE scope = 'platform'
          OR (scope = 'organisme' AND scope_id = $1)
          OR (scope = 'instance'  AND scope_id = $2)
          OR (scope = 'type_acte' AND scope_id = $3)`,
      [String(org), instanceId ? `${org}:${instanceId}` : '-', typeActeId ? `${org}:${typeActeId}` : '-']);
    const out = {};
    for (const r of rows.sort((a, b) => ORDER.indexOf(a.scope) - ORDER.indexOf(b.scope))) out[r.key] = { value: value(r), origin: r.scope };
    return out;
  }

  async function put(ctx, { scope, organismeId, subId, key, val }) {
    const sid = scopeId(scope, organismeId, subId);
    const before = await db.get('SELECT value FROM settings WHERE scope = $1 AND scope_id = $2 AND key = $3', [scope, sid, key]);
    await db.run(
      `INSERT INTO settings (scope, scope_id, key, value, updated_by) VALUES ($1,$2,$3,$4::jsonb,$5)
       ON CONFLICT (scope, scope_id, key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [scope, sid, key, JSON.stringify(val), ctx.username]);
    await audit.log(ctx, { organismeId: scope === 'platform' ? null : Number(organismeId), action: 'setting.set', entity: 'settings',
      entityId: `${scope}:${sid}:${key}`, before: before ? { value: before.value } : null, after: { value: val } });
    return { key, scope, value: val };
  }

  async function remove(ctx, { scope, organismeId, subId, key }) {
    const sid = scopeId(scope, organismeId, subId);
    const r = await db.get('DELETE FROM settings WHERE scope = $1 AND scope_id = $2 AND key = $3 RETURNING value', [scope, sid, key]);
    if (!r) throw E.notFound('Paramètre introuvable à ce niveau');
    await audit.log(ctx, { organismeId: scope === 'platform' ? null : Number(organismeId), action: 'setting.unset', entity: 'settings',
      entityId: `${scope}:${sid}:${key}`, before: { value: r.value } });
  }

  async function listPlatform() {
    const rows = await db.all("SELECT key, value FROM settings WHERE scope = 'platform' ORDER BY key");
    return Object.fromEntries(rows.map((r) => [r.key, { value: value(r), origin: 'platform' }]));
  }

  return { resolve, put, remove, listPlatform };
}

module.exports = { createSettings, ORDER };
