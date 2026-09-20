-- 0029 — recherche plein texte (section 20, D87) : PostgreSQL seul, sans moteur externe (REC-09).
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- français + suppression des accents : « ecole », « école » et « écoles » se rejoignent
CREATE TEXT SEARCH CONFIGURATION fr_unaccent (COPY = french);
ALTER TEXT SEARCH CONFIGURATION fr_unaccent ALTER MAPPING FOR hword, hword_part, word WITH unaccent, french_stem;

-- une entrée par acte ; les critères (statut, séance, rapporteur…) sont lus dans les tables d'origine
CREATE TABLE search_index (
  acte_id         integer PRIMARY KEY REFERENCES actes(id) ON DELETE CASCADE,
  organisme_id    integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  titre_norm      text NOT NULL,           -- titre et objet, minuscules sans accent : tolérance aux fautes (trigrammes)
  contenu         text NOT NULL,           -- texte pour les extraits surlignés (agents)
  contenu_public  text NOT NULL,           -- titre, objet, dispositif seulement (espace élus : pas d'annexe ni d'exposé)
  tsv             tsvector NOT NULL,       -- A titre et n° · B objet, rubrique, matière, dispositif · C exposé, visas, avis, vote · D annexes
  indexed_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX search_index_tsv_idx ON search_index USING gin (tsv);
CREATE INDEX search_index_trgm_idx ON search_index USING gin (titre_norm gin_trgm_ops);
CREATE INDEX search_index_org_idx ON search_index (organisme_id);

-- texte extrait de chaque fichier PDF, mis en cache par fichier (un fichier n'est lu qu'une fois)
CREATE TABLE search_annexes (
  file_id       integer PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  texte         text NOT NULL DEFAULT '',
  sans_texte    boolean NOT NULL DEFAULT false,   -- PDF sans couche texte (scan) ou illisible
  erreur        text,
  extracted_at  timestamptz NOT NULL DEFAULT now()
);

-- recherches enregistrées par utilisateur (REC-07 ; les alertes restent à faire)
CREATE TABLE search_saved (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  username      text NOT NULL,
  nom           text NOT NULL,
  requete       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX search_saved_user_idx ON search_saved (organisme_id, username);

-- journal anonymisé (REC-12) : ni nom ni identifiant, seulement la requête et le nombre de résultats
CREATE TABLE search_log (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  requete       text NOT NULL,
  nb            integer NOT NULL,
  espace        text NOT NULL DEFAULT 'agents',
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX search_log_org_idx ON search_log (organisme_id, at DESC);
