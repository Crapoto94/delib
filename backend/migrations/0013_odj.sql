-- 0013 — ordre du jour, classement et numérotation (section 16.2).

-- ligne de l'ordre du jour : délibération d'un acte, point libre ou chapitre (titre de regroupement, sans numéro)
CREATE TABLE seance_items (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id     integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  seance_id        integer NOT NULL REFERENCES seances(id) ON DELETE CASCADE,
  position         integer NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('deliberation', 'libre', 'chapitre')),
  acte_id          integer REFERENCES actes(id) ON DELETE SET NULL,
  deliberation_id  integer REFERENCES deliberations(id) ON DELETE SET NULL,
  titre            text,
  numerote         boolean NOT NULL DEFAULT true,      -- un point libre peut ne pas être numéroté
  numero           text,                               -- figé à l'arrêt de l'ordre du jour ; provisoire (calculé) avant
  numero_seq       integer,
  statut           text NOT NULL DEFAULT 'a_traiter' CHECK (statut IN ('a_traiter', 'retire')),
  retire_motif     text,
  ajoute_apres_arret boolean NOT NULL DEFAULT false,
  created_by       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seance_items_seance_idx ON seance_items (seance_id, position);
CREATE INDEX seance_items_acte_idx ON seance_items (acte_id);
-- unicité du numéro dans la séance (donc dans l'instance et l'année : le motif contient l'année et le rang de séance) ; jamais réattribué
CREATE UNIQUE INDEX seance_items_numero_uq ON seance_items (seance_id, numero) WHERE numero IS NOT NULL;
CREATE UNIQUE INDEX seance_items_delib_uq ON seance_items (seance_id, deliberation_id) WHERE deliberation_id IS NOT NULL AND statut = 'a_traiter';

CREATE TABLE seance_item_history (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seance_id  integer NOT NULL REFERENCES seances(id) ON DELETE CASCADE,
  item_id    integer,
  actor      text NOT NULL,
  action     text NOT NULL,
  before     jsonb,
  after      jsonb,
  motif      text,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seance_item_history_idx ON seance_item_history (seance_id, id);

-- verrou d'édition de l'ordre du jour : un seul éditeur actif (ODJ-09)
CREATE TABLE seance_locks (
  seance_id  integer PRIMARY KEY REFERENCES seances(id) ON DELETE CASCADE,
  username   text NOT NULL,
  until      timestamptz NOT NULL
);
