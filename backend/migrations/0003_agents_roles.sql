-- 0003 — cache d'agents, rôles par organisme, sessions, compte de secours local.
CREATE TABLE agent_ref (
  username         text PRIMARY KEY CHECK (username = lower(username)),
  matricule        text,
  nom              text,
  prenom           text,
  display_name     text,
  email            text,
  direction_code   text,
  direction_label  text,
  service_label    text,
  poste            text,
  actif            boolean NOT NULL DEFAULT true,
  source           text NOT NULL DEFAULT 'ad',
  first_login_at   timestamptz,
  last_login_at    timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_ref_direction_idx ON agent_ref (direction_code);
CREATE INDEX agent_ref_email_idx ON agent_ref (lower(email));

CREATE TABLE user_org_roles (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      text NOT NULL CHECK (username = lower(username)),
  organisme_id  integer REFERENCES organismes(id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('platform_admin', 'org_admin', 'scc', 'teletransmission', 'lecteur')),
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- platform_admin n'a pas d'organisme ; tous les autres rôles en ont un
  CHECK ((role = 'platform_admin') = (organisme_id IS NULL))
);
CREATE UNIQUE INDEX user_org_roles_uq ON user_org_roles (username, COALESCE(organisme_id, 0), role);
CREATE INDEX user_org_roles_org_idx ON user_org_roles (organisme_id);

CREATE TABLE sessions (
  jti         uuid PRIMARY KEY,
  username    text NOT NULL,
  kind        text NOT NULL DEFAULT 'ad' CHECK (kind IN ('ad', 'local')),
  started_at  timestamptz NOT NULL,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  ip          text
);
CREATE INDEX sessions_username_idx ON sessions (username);

CREATE TABLE local_accounts (
  username       text PRIMARY KEY CHECK (username = lower(username)),
  password_hash  text NOT NULL,
  disabled       boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);
