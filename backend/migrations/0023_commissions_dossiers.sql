-- 0023 — type de commission (D74) et dossiers simples de l'ordre du jour (D75).

-- Une commission est « associée à la rédaction des actes » (elle rend des avis sur les projets) ou « autre » (sans lien avec les actes).
ALTER TABLE commissions ADD COLUMN type text NOT NULL DEFAULT 'actes' CHECK (type IN ('actes', 'autre'));

-- Dossier simple = point libre enrichi : nom (titre), description et pièces jointes.
ALTER TABLE seance_items ADD COLUMN description text;
CREATE TABLE seance_item_fichiers (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id     integer NOT NULL REFERENCES seance_items(id) ON DELETE CASCADE,
  file_id     integer NOT NULL REFERENCES files(id),
  titre       text NOT NULL,
  ordre       integer NOT NULL DEFAULT 0,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seance_item_fichiers_item_idx ON seance_item_fichiers (item_id, ordre);

-- consultation d'une pièce jointe depuis le lien personnel d'un convoqué
ALTER TABLE convocation_events DROP CONSTRAINT convocation_events_type_check;
ALTER TABLE convocation_events ADD CONSTRAINT convocation_events_type_check
  CHECK (type IN ('envoi', 'echec', 'relance', 'ouverture', 'convocation_lue', 'odj_lu', 'accuse', 'reponse', 'piece_lue'));
