-- 0008 — lot 1 : référentiels (avec héritage par organisme), fiche d'acte, délibérations, fichiers, annexes,
-- commentaires, droits de rédaction, titulaires, groupes de valideurs.
ALTER TABLE agent_ref ADD COLUMN service_code text;

CREATE TABLE counters (
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  key           text NOT NULL,
  value         bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (organisme_id, key)
);

-- Référentiels (types d'acte, natures, rubriques, matières, types d'annexes).
-- organisme_id NULL = jeu commun à la plateforme ; un organisme peut hériter, désactiver, renommer ou ajouter (MOR-10).
CREATE TABLE ref_items (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('type_acte', 'nature', 'rubrique', 'matiere', 'annexe_type')),
  organisme_id  integer REFERENCES organismes(id) ON DELETE CASCADE,
  code          text NOT NULL,
  libelle       text NOT NULL,
  parent_code   text,
  niveau        integer,
  ordre         integer NOT NULL DEFAULT 0,
  actif         boolean NOT NULL DEFAULT true,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ref_items_uq ON ref_items (kind, COALESCE(organisme_id, 0), code);
CREATE INDEX ref_items_kind_idx ON ref_items (kind, organisme_id);
CREATE TRIGGER ref_items_touch BEFORE UPDATE ON ref_items FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE ref_overrides (
  ref_id        integer NOT NULL REFERENCES ref_items(id) ON DELETE CASCADE,
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  actif         boolean,
  libelle       text,
  PRIMARY KEY (ref_id, organisme_id)
);

-- Fiche d'acte (dossier). Une délibération = 1..n délibérations rattachées (D5).
CREATE TABLE actes (
  id                     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id           integer NOT NULL REFERENCES organismes(id),
  numero_suivi           integer NOT NULL,
  type_id                integer NOT NULL REFERENCES ref_items(id),
  titre                  text NOT NULL,
  statut                 text NOT NULL DEFAULT 'brouillon' CHECK (statut IN (
    'brouillon', 'en_circuit', 'modification_demandee', 'valide_dgs', 'en_attente_scc', 'mis_a_disposition', 'avis_rendu',
    'inscrit_odj', 'adopte', 'rejete', 'retire', 'ajourne', 'texte_definitif_pret', 'pret_a_transmettre', 'transmis',
    'ar_recu', 'publie', 'executoire', 'abandonne', 'archive')),
  redacteur              text NOT NULL,
  co_redacteurs          jsonb NOT NULL DEFAULT '[]'::jsonb,
  direction_code         text NOT NULL,
  direction_label        text,
  service_code           text,
  service_label          text,
  nature_id              integer REFERENCES ref_items(id),
  matiere_id             integer REFERENCES ref_items(id),
  rubrique_id            integer REFERENCES ref_items(id),
  incidence_financiere   boolean,
  montant                numeric(14, 2),
  rapporteur_id          integer,
  rapporteur_compl_id    integer,
  seance_visee_id        integer,
  seance_id              integer,
  urgence                boolean NOT NULL DEFAULT false,
  date_limite            date,
  confidentialite        text NOT NULL DEFAULT 'normale' CHECK (confidentialite IN ('normale', 'confidentiel', 'huis_clos')),
  commentaire_initial    text,
  custom                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  circuit_version_id     integer,
  path                   jsonb,
  participants           jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_step_key       text,
  submitted_at           timestamptz,
  abandoned_at           timestamptz,
  abandon_motif          text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisme_id, numero_suivi)
);
CREATE INDEX actes_org_statut_idx ON actes (organisme_id, statut);
CREATE INDEX actes_redacteur_idx ON actes (organisme_id, redacteur);
CREATE INDEX actes_direction_idx ON actes (organisme_id, direction_code, service_code);
CREATE TRIGGER actes_touch BEFORE UPDATE ON actes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE deliberations (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  acte_id     integer NOT NULL REFERENCES actes(id) ON DELETE CASCADE,
  ordre       integer NOT NULL DEFAULT 1,
  titre       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deliberations_acte_idx ON deliberations (acte_id, ordre);
CREATE TRIGGER deliberations_touch BEFORE UPDATE ON deliberations FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Fichiers (annexes, fonds de page…) : stockés hors base, empreinte SHA-256.
CREATE TABLE files (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id   integer NOT NULL REFERENCES organismes(id),
  storage_key    text NOT NULL,
  original_name  text NOT NULL,
  mime           text NOT NULL,
  size           bigint NOT NULL,
  pages          integer,
  sha256         text NOT NULL,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_org_idx ON files (organisme_id);

CREATE TABLE annexes (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  acte_id        integer NOT NULL REFERENCES actes(id) ON DELETE CASCADE,
  titre          text NOT NULL,
  type_id        integer REFERENCES ref_items(id),
  ordre          integer NOT NULL DEFAULT 1,
  file_id        integer NOT NULL REFERENCES files(id),
  version        integer NOT NULL DEFAULT 1,
  communicable   boolean NOT NULL DEFAULT true,
  publiable      boolean NOT NULL DEFAULT true,
  transmissible  boolean NOT NULL DEFAULT true,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX annexes_acte_idx ON annexes (acte_id, ordre);
CREATE TRIGGER annexes_touch BEFORE UPDATE ON annexes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE annexe_versions (
  annexe_id    integer NOT NULL REFERENCES annexes(id) ON DELETE CASCADE,
  version      integer NOT NULL,
  file_id      integer NOT NULL REFERENCES files(id),
  replaced_by  text,
  replaced_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (annexe_id, version)
);

CREATE TABLE comments (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  acte_id       integer NOT NULL REFERENCES actes(id) ON DELETE CASCADE,
  parent_id     integer REFERENCES comments(id) ON DELETE CASCADE,
  author        text NOT NULL,
  title         text,
  body          text NOT NULL,
  step_key      text,
  kind          text NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'refus', 'systeme')),
  mentions      jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolved      boolean NOT NULL DEFAULT false,
  hidden        boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_acte_idx ON comments (acte_id, created_at);

-- Droits de rédaction étendus (DRO-02) : un agent d'une autre direction autorisé à rédiger pour la direction (ou le service).
CREATE TABLE redaction_grants (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id    integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  direction_code  text NOT NULL,
  service_code    text,
  username        text NOT NULL CHECK (username = lower(username)),
  granted_by      text NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  motif           text,
  revoked_at      timestamptz,
  revoked_by      text
);
CREATE INDEX redaction_grants_lookup ON redaction_grants (organisme_id, username) WHERE revoked_at IS NULL;

-- Titulaires saisis à la main (D3, CIR-25).
CREATE TABLE titulaires (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id    integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  perimetre       text NOT NULL CHECK (perimetre IN ('organisme', 'direction', 'service')),
  direction_code  text,
  service_code    text,
  fonction        text NOT NULL CHECK (fonction IN ('responsable_intermediaire', 'chef_service', 'directeur', 'dga', 'dgs')),
  username        text NOT NULL CHECK (username = lower(username)),
  suppleant       text,
  valid_from      date,
  valid_to        date,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((perimetre = 'organisme' AND direction_code IS NULL AND service_code IS NULL)
      OR (perimetre = 'direction' AND direction_code IS NOT NULL AND service_code IS NULL)
      OR (perimetre = 'service' AND direction_code IS NOT NULL AND service_code IS NOT NULL))
);
CREATE INDEX titulaires_lookup ON titulaires (organisme_id, fonction, direction_code, service_code);

-- Groupes de valideurs (Service financier, Service juridique, SCC…).
CREATE TABLE groupes_valideurs (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  code          text NOT NULL CHECK (code ~ '^[a-z0-9_-]{2,40}$'),
  nom           text NOT NULL,
  UNIQUE (organisme_id, code)
);
CREATE TABLE groupe_valideurs_membres (
  groupe_id  integer NOT NULL REFERENCES groupes_valideurs(id) ON DELETE CASCADE,
  username   text NOT NULL CHECK (username = lower(username)),
  PRIMARY KEY (groupe_id, username)
);
