-- 0078 — Espace élus : documents « exposé »/« délibération » figés une fois générés (ELU-60, ELU-64).
--
-- L'ordre du jour d'une séance est arrêté avant d'être mis à disposition des élus : le document qu'ils
-- consultent doit être STABLE et identique à chaque lecture, pas reconstruit (conversion Word -> PDF comprise)
-- à chaque requête. La première génération pour une version donnée (empreinte des sources) est conservée et
-- réutilisée telle quelle tant que les sources ne changent pas (une nouvelle version régénère).
CREATE TABLE IF NOT EXISTS actes_documents_figes (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id    integer NOT NULL REFERENCES organismes(id),
  acte_id         integer NOT NULL REFERENCES actes(id) ON DELETE CASCADE,
  cible           text NOT NULL CHECK (cible IN ('expose', 'deliberation')),
  deliberation_id integer,
  version         text NOT NULL,
  file_id         integer NOT NULL REFERENCES files(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (acte_id, cible, deliberation_id, version)
);
CREATE INDEX IF NOT EXISTS actes_documents_figes_acte_idx ON actes_documents_figes (acte_id);
