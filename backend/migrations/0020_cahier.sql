-- 0020 — cahier de séance (CAH-01 à CAH-11) : une ligne par génération = une version numérotée du cahier.
CREATE TABLE cahier_builds (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  seance_id     integer NOT NULL REFERENCES seances(id) ON DELETE CASCADE,
  version_no    integer NOT NULL,
  profil        text NOT NULL CHECK (profil IN ('scc', 'presidence', 'elus', 'public')),
  options       jsonb NOT NULL DEFAULT '{}'::jsonb,          -- rectoVerso, anomalies (bloquer | avertir | exclure)
  statut        text NOT NULL DEFAULT 'queued' CHECK (statut IN ('queued', 'running', 'done', 'error')),
  step_label    text,
  progress      integer NOT NULL DEFAULT 0,
  total         integer NOT NULL DEFAULT 0,
  file_id       integer REFERENCES files(id),
  pages         integer,
  sha256        text,
  anomalies     jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot      jsonb NOT NULL DEFAULT '[]'::jsonb,          -- [{ acteId, deliberationId, numero, titre, hash }] : pour lister les changements depuis la version diffusée
  odj_statut    text,                                        -- état de l'ordre du jour à la génération (filigrane « PROJET » tant qu'il n'est pas arrêté)
  error         text,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  printed_at    timestamptz,
  printed_by    text,
  UNIQUE (seance_id, version_no)
);
CREATE INDEX cahier_builds_seance_idx ON cahier_builds (seance_id, version_no DESC);
