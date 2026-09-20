-- 0030 — annotations des élus sur les PDF (ELU-71 à ELU-76, D90).
-- Le contenu (note, citation, réponses) est chiffré par l'application : cette base ne contient jamais de texte lisible d'un élu.
CREATE TABLE elu_annotations (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id   integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  elu_id         integer NOT NULL REFERENCES elus(id) ON DELETE CASCADE,
  seance_id      integer NOT NULL REFERENCES seances(id) ON DELETE CASCADE,
  doc_key        text NOT NULL,
  doc_version    text NOT NULL,                     -- version du document au moment de l'annotation (ELU-74)
  page           integer NOT NULL CHECK (page >= 1),
  kind           text NOT NULL CHECK (kind IN ('surlignage', 'note', 'dessin', 'signet')),
  rects          jsonb NOT NULL DEFAULT '[]'::jsonb,  -- zones {x,y,w,h} en fraction de la page (0..1), origine en haut à gauche
  trace          jsonb NOT NULL DEFAULT '[]'::jsonb,  -- dessin : traits = listes de points [x,y] en fraction de la page
  couleur        text NOT NULL DEFAULT '#facc15' CHECK (couleur ~ '^#[0-9a-fA-F]{6}$'),
  citation_c     text,                                -- texte cité, chiffré
  contenu_c      text,                                -- texte de la note, chiffré
  orpheline      boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX elu_annotations_elu_idx ON elu_annotations (elu_id, seance_id, doc_key);
CREATE INDEX elu_annotations_seance_idx ON elu_annotations (seance_id);
CREATE TRIGGER elu_annotations_touch BEFORE UPDATE ON elu_annotations FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- destinataires d'une annotation ; « groupe » = membres du groupe à l'instant du partage (figés, ELU-73)
CREATE TABLE elu_annotation_partages (
  annotation_id  integer NOT NULL REFERENCES elu_annotations(id) ON DELETE CASCADE,
  elu_id         integer NOT NULL REFERENCES elus(id) ON DELETE CASCADE,
  via            text NOT NULL CHECK (via IN ('groupe', 'elu')),
  partage_le     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (annotation_id, elu_id)
);
CREATE INDEX elu_annotation_partages_elu_idx ON elu_annotation_partages (elu_id);

CREATE TABLE elu_annotation_reponses (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  annotation_id  integer NOT NULL REFERENCES elu_annotations(id) ON DELETE CASCADE,
  elu_id         integer NOT NULL REFERENCES elus(id) ON DELETE CASCADE,
  contenu_c      text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX elu_annotation_reponses_idx ON elu_annotation_reponses (annotation_id, id);
