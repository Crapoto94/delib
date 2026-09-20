-- 0028 — archivage en GED Alfresco (section 19.5 bis, D86).

CREATE TABLE ged_config (
  organisme_id         integer PRIMARY KEY REFERENCES organismes(id) ON DELETE CASCADE,
  actif                boolean NOT NULL DEFAULT false,
  mode                 text NOT NULL DEFAULT 'simulation' CHECK (mode IN ('simulation', 'alfresco')),
  url                  text,
  utilisateur          text,
  mot_de_passe_chiffre text,                              -- AES-256-GCM ; jamais renvoyé par l'API
  racine               text NOT NULL DEFAULT '-root-',    -- identifiant de nœud, ou chemin relatif à « Company Home »
  auto_archivage       boolean NOT NULL DEFAULT false,    -- archive la séance à sa clôture
  plan_cree_le         timestamptz,
  updated_by           text,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- registre des dépôts : un document = une clé stable ; l'empreinte dit s'il faut le redéposer (nouvelle version)
CREATE TABLE ged_documents (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  seance_id     integer REFERENCES seances(id) ON DELETE SET NULL,
  acte_id       integer REFERENCES actes(id) ON DELETE SET NULL,
  doc_key       text NOT NULL,
  nom           text NOT NULL,
  chemin        text NOT NULL,
  node_id       text,
  version_label text,
  sha256        text,
  taille        integer,
  mode          text NOT NULL,
  statut        text NOT NULL DEFAULT 'ok' CHECK (statut IN ('ok', 'erreur')),
  erreur        text,
  archive_par   text NOT NULL,
  archive_le    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisme_id, doc_key)
);
CREATE INDEX ged_documents_seance_idx ON ged_documents (seance_id);

-- SIMULATEUR de GED : arborescence factice persistée (mode « simulation »). Jamais lue par le reste de l'application.
CREATE TABLE ged_sim_nodes (
  id           uuid PRIMARY KEY,
  organisme_id integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  parent_id    uuid REFERENCES ged_sim_nodes(id) ON DELETE CASCADE,
  nom          text NOT NULL,
  dossier      boolean NOT NULL,
  description  text,
  proprietes   jsonb NOT NULL DEFAULT '{}'::jsonb,
  contenu      bytea,
  sha256       text,
  taille       integer,
  version      integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ged_sim_nodes_uq ON ged_sim_nodes (organisme_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), nom);
