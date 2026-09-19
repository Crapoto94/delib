-- 0009 — lot 2 : textes suivis (exposé, visas/considérants, dispositif), versions, brouillons, verrous, gabarits de mise en page.
CREATE TABLE tracked_texts (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id     integer NOT NULL REFERENCES organismes(id),
  acte_id          integer NOT NULL REFERENCES actes(id) ON DELETE CASCADE,
  deliberation_id  integer REFERENCES deliberations(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('expose', 'visas', 'dispositif')),
  markdown         text NOT NULL DEFAULT '',
  spans            jsonb NOT NULL DEFAULT '[]'::jsonb,
  version_no       integer NOT NULL DEFAULT 1,
  tracking         boolean NOT NULL DEFAULT false,
  lock_user        text,
  lock_until       timestamptz,
  updated_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'expose') = (deliberation_id IS NULL))
);
CREATE UNIQUE INDEX tracked_texts_uq ON tracked_texts (acte_id, COALESCE(deliberation_id, 0), kind);
CREATE INDEX tracked_texts_acte_idx ON tracked_texts (acte_id);
CREATE TRIGGER tracked_texts_touch BEFORE UPDATE ON tracked_texts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Instantané immuable à chaque enregistrement (TRK-05) : les « spans » sont une vue reconstruisible, jamais réinitialisée.
CREATE TABLE text_versions (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  text_id     integer NOT NULL REFERENCES tracked_texts(id) ON DELETE CASCADE,
  version_no  integer NOT NULL,
  markdown    text NOT NULL,
  spans       jsonb NOT NULL,
  author      text NOT NULL,
  step_key    text,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (text_id, version_no)
);

CREATE TABLE text_authors (
  text_id   integer NOT NULL REFERENCES tracked_texts(id) ON DELETE CASCADE,
  username  text NOT NULL,
  name      text NOT NULL,
  color     text NOT NULL,
  PRIMARY KEY (text_id, username)
);

CREATE TABLE text_drafts (
  text_id     integer NOT NULL REFERENCES tracked_texts(id) ON DELETE CASCADE,
  username    text NOT NULL,
  markdown    text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (text_id, username)
);

CREATE TABLE text_seen (
  text_id     integer NOT NULL REFERENCES tracked_texts(id) ON DELETE CASCADE,
  username    text NOT NULL,
  version_no  integer NOT NULL,
  seen_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (text_id, username)
);

-- Gabarits de mise en page (PDF de fond + gabarit paramétrable), par organisme et type de document (PRE-04).
CREATE TABLE render_templates (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  doc_type      text NOT NULL CHECK (doc_type IN ('expose', 'deliberation', 'dossier', 'garde', 'intercalaire', 'sommaire', 'odj', 'convocation', 'registre')),
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,
  bg_first_file_id  integer REFERENCES files(id),
  bg_next_file_id   integer REFERENCES files(id),
  version       integer NOT NULL DEFAULT 1,
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisme_id, doc_type)
);
CREATE TABLE render_template_versions (
  template_id  integer NOT NULL REFERENCES render_templates(id) ON DELETE CASCADE,
  version      integer NOT NULL,
  config       jsonb NOT NULL,
  bg_first_file_id  integer,
  bg_next_file_id   integer,
  saved_by     text,
  saved_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, version)
);
