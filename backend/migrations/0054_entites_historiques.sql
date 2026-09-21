-- 0054 — Import AIRS DELIB : directions/services HISTORIQUES (anciennes organisations).
--
-- Une organisation passée peut avoir porté des directions ou services qui n'existent plus dans la
-- hiérarchie actuelle (ex. « CCAS et santé »). Ils n'ont pas de code d'organigramme : on les conserve
-- à part, pour concordér les actes passés sans polluer les directions actuelles.
CREATE TABLE IF NOT EXISTS entites_historiques (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('direction', 'service')),
  code         text,
  libelle      text NOT NULL,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS entites_historiques_uq ON entites_historiques (organisme_id, type, lower(libelle));
CREATE INDEX IF NOT EXISTS entites_historiques_type_idx ON entites_historiques (organisme_id, type);
