-- 0010 — lot 3 : circuit de validation (graphe versionné, éditable), instances d'étapes, historique, délégations.
CREATE TABLE circuit_definitions (
  id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id       integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  code               text NOT NULL CHECK (code ~ '^[a-z0-9_-]{2,40}$'),
  nom                text NOT NULL,
  type_acte_id       integer REFERENCES ref_items(id),
  direction_code     text,
  active_version_id  integer,
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisme_id, code)
);

CREATE TABLE circuit_versions (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  definition_id integer NOT NULL REFERENCES circuit_definitions(id) ON DELETE CASCADE,
  version_no    integer NOT NULL,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  graph         jsonb NOT NULL,
  comment       text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  published_by  text,
  UNIQUE (definition_id, version_no)
);
ALTER TABLE circuit_definitions ADD CONSTRAINT circuit_active_version_fk FOREIGN KEY (active_version_id) REFERENCES circuit_versions(id);

ALTER TABLE actes
  ADD COLUMN adhoc_steps   jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN trail         jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN resume_step   text,
  ADD COLUMN return_from   text,
  ADD COLUMN circuit_round integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT actes_circuit_version_fk FOREIGN KEY (circuit_version_id) REFERENCES circuit_versions(id);

-- Une ligne par passage dans une étape (jamais supprimée : l'historique du circuit est conservé).
CREATE TABLE step_instances (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  acte_id       integer NOT NULL REFERENCES actes(id) ON DELETE CASCADE,
  step_key      text NOT NULL,
  label         text NOT NULL,
  round         integer NOT NULL DEFAULT 1,
  status        text NOT NULL CHECK (status IN ('current', 'done', 'skipped', 'returned')),
  holders       jsonb NOT NULL DEFAULT '[]'::jsonb,
  mode          text NOT NULL DEFAULT 'one',
  quorum        integer,
  approvals     jsonb NOT NULL DEFAULT '[]'::jsonb,
  arrived_at    timestamptz NOT NULL DEFAULT now(),
  acted_at      timestamptz,
  acted_by      text,
  on_behalf_of  text,
  decision      text,
  comment       text,
  reason        text,
  sla_days      numeric,
  due_at        timestamptz,
  adhoc         boolean NOT NULL DEFAULT false
);
CREATE INDEX step_instances_acte_idx ON step_instances (acte_id, id);
CREATE UNIQUE INDEX step_instances_one_current ON step_instances (acte_id) WHERE status = 'current';
CREATE INDEX step_instances_holders_idx ON step_instances USING gin (holders);

CREATE TABLE step_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  acte_id       integer NOT NULL REFERENCES actes(id) ON DELETE CASCADE,
  at            timestamptz NOT NULL DEFAULT now(),
  actor         text NOT NULL,
  on_behalf_of  text,
  action        text NOT NULL,
  from_step     text,
  to_step       text,
  comment       text,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX step_events_acte_idx ON step_events (acte_id, id);

-- Délégations de validation (CIR-30 à CIR-39).
CREATE TABLE validation_delegations (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id   integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  delegant       text NOT NULL CHECK (delegant = lower(delegant)),
  delegue        text NOT NULL CHECK (delegue = lower(delegue)),
  scope          text NOT NULL CHECK (scope IN ('all', 'step', 'type_acte', 'direction', 'acte')),
  scope_value    text,
  rights         jsonb NOT NULL DEFAULT '{"validate": true, "refuse": true, "comment": true, "edit": false}'::jsonb,
  starts_at      timestamptz NOT NULL DEFAULT now(),
  ends_at        timestamptz,
  motif          text,
  revoked_at     timestamptz,
  revoked_by     text,
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (delegant <> delegue),
  CHECK ((scope = 'all') = (scope_value IS NULL))
);
CREATE INDEX validation_delegations_org_idx ON validation_delegations (organisme_id, delegant) WHERE revoked_at IS NULL;
CREATE INDEX validation_delegations_delegue_idx ON validation_delegations (organisme_id, delegue) WHERE revoked_at IS NULL;
