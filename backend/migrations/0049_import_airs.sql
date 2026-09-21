-- 0049 — import de l'historique AIRS DELIB (section 25 bis, D111) : sas générique, mapping déclaratif, concordances,
-- items détectés, correspondances durables et journal du lot. Aucune donnée n'entre dans les tables métier sans publication.

-- un lot de reprise (une exécution : un import JSON ou une lecture de tables)
CREATE TABLE airs_imports (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  label         text NOT NULL,
  source_kind   text NOT NULL DEFAULT 'json' CHECK (source_kind IN ('json', 'tables')),
  mode          text NOT NULL DEFAULT 'passes' CHECK (mode IN ('passes', 'preparation')),
  statut        text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'charge', 'analyse', 'concordances', 'pret', 'publie', 'annule')),
  inventaire    jsonb NOT NULL DEFAULT '{}'::jsonb,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX airs_imports_org_idx ON airs_imports (organisme_id, statut);
CREATE TRIGGER airs_imports_touch BEFORE UPDATE ON airs_imports FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- définition déclarative des tables AIRS lues (MCD inconnu) : une ligne = une table source et son mapping de colonnes
CREATE TABLE airs_source_tables (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id  integer REFERENCES organismes(id) ON DELETE CASCADE,   -- NULL = définition commune
  table_name    text NOT NULL,
  libelle       text NOT NULL,
  entite_cible  text NOT NULL DEFAULT 'brut' CHECK (entite_cible IN ('brut', 'seance', 'acte')),
  cle_colonne   text NOT NULL DEFAULT 'id',
  colonnes      jsonb NOT NULL DEFAULT '[]'::jsonb,                    -- [{ source, cible }] : colonne AIRS -> champ canonique
  obligatoire   boolean NOT NULL DEFAULT false,
  ordre         integer NOT NULL DEFAULT 0,
  actif         boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX airs_source_tables_uq ON airs_source_tables (COALESCE(organisme_id, 0), table_name);
CREATE TRIGGER airs_source_tables_touch BEFORE UPDATE ON airs_source_tables FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- lignes brutes du sas : rien n'est interprété, tout est conservé en JSONB
CREATE TABLE airs_raw_rows (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_id     integer NOT NULL REFERENCES airs_imports(id) ON DELETE CASCADE,
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  table_name    text NOT NULL,
  source_key    text NOT NULL,
  payload       jsonb NOT NULL,
  empreinte     text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX airs_raw_rows_uq ON airs_raw_rows (import_id, table_name, source_key);
CREATE INDEX airs_raw_rows_table_idx ON airs_raw_rows (organisme_id, table_name);

-- concordances : valeur AIRS -> entité VibeDélib (référentiel, direction, service, agent, élu…)
CREATE TABLE airs_concordances (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id   integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  import_id      integer REFERENCES airs_imports(id) ON DELETE CASCADE,  -- NULL = concordance réutilisable entre lots
  axe            text NOT NULL,
  source_table   text NOT NULL,
  source_colonne text NOT NULL,
  source_code    text NOT NULL DEFAULT '',
  source_libelle text,
  cible_type     text,
  cible_id       integer,
  cible_code     text,
  cible_libelle  text,
  etat           text NOT NULL DEFAULT 'a_faire' CHECK (etat IN ('a_faire', 'proposee', 'automatique', 'manuelle', 'ignoree')),
  confiance      numeric(4, 3),
  bloquant       boolean NOT NULL DEFAULT false,
  occurrence     integer NOT NULL DEFAULT 0,
  decide_par     text,
  decide_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX airs_concordances_uq ON airs_concordances (COALESCE(import_id, 0), axe, source_table, source_colonne, source_code);
CREATE INDEX airs_concordances_axe_idx ON airs_concordances (organisme_id, axe, etat);
CREATE TRIGGER airs_concordances_touch BEFORE UPDATE ON airs_concordances FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- items détectés (séance ou acte) : champs résolus, problèmes, cible publiée
CREATE TABLE airs_import_items (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_id     integer NOT NULL REFERENCES airs_imports(id) ON DELETE CASCADE,
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('seance', 'acte')),
  source_key    text NOT NULL,
  statut        text NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'pret', 'publie', 'ignore')),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  problemes     jsonb NOT NULL DEFAULT '[]'::jsonb,
  seance_id     integer REFERENCES seances(id) ON DELETE SET NULL,
  acte_id       integer REFERENCES actes(id) ON DELETE SET NULL,
  pubie_at      timestamptz,
  pubie_par     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX airs_import_items_uq ON airs_import_items (import_id, kind, source_key);
CREATE INDEX airs_import_items_statut_idx ON airs_import_items (organisme_id, statut);
CREATE TRIGGER airs_import_items_touch BEFORE UPDATE ON airs_import_items FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- correspondance durable entité AIRS -> entité créée : garantit l'idempotence entre lots et les reprises
CREATE TABLE airs_links (
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('seance', 'acte')),
  source_key    text NOT NULL,
  entity_id     integer NOT NULL,
  import_id     integer REFERENCES airs_imports(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisme_id, kind, source_key)
);

-- journal des événements d'un lot (chargement, analyse, décision, publication, annulation)
CREATE TABLE airs_import_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_id     integer NOT NULL REFERENCES airs_imports(id) ON DELETE CASCADE,
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  actor         text NOT NULL,
  action        text NOT NULL,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX airs_import_events_import_idx ON airs_import_events (import_id, at);
