/** Sessions révocables : le JWT porte un identifiant (jti) vérifié en base à chaque requête. */
function createSessions(db) {
  return {
    create: ({ jti, username, kind, startedAt, expiresAt, ip, persistante = false }) => db.run(
      'INSERT INTO sessions (jti, username, kind, started_at, expires_at, ip, persistante) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [jti, username, kind, startedAt, expiresAt, ip || null, !!persistante],
    ),
    get: (jti) => db.get('SELECT * FROM sessions WHERE jti = $1', [jti]),
    revoke: (jti) => db.run('UPDATE sessions SET revoked_at = now() WHERE jti = $1 AND revoked_at IS NULL', [jti]),
    revokeAllFor: (username) => db.run('UPDATE sessions SET revoked_at = now() WHERE username = $1 AND revoked_at IS NULL', [username]),
    purgeExpired: () => db.run("DELETE FROM sessions WHERE expires_at < now() - interval '7 days'"),
  };
}

module.exports = { createSessions };
