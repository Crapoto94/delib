-- 0091 — pièces jointes des demandes du backlog (captures d'écran, documents) ; le fichier lui-même est dans le stockage de l'application.
CREATE TABLE backlog_pieces (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  demande_id   integer NOT NULL REFERENCES backlog_demandes(id) ON DELETE CASCADE,
  nom          text NOT NULL,
  mime         text NOT NULL,
  taille       integer NOT NULL,
  storage_key  text NOT NULL,
  sha256       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX backlog_pieces_demande_idx ON backlog_pieces (demande_id);
