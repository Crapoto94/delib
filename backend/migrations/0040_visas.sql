-- 0040 — lot 5c-1 (D101) : bibliothèque de visas (IA-38) et listes de contrôle (IA-32). Fournies vides : le juridique les maintient.
CREATE TABLE visa_library (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  cle           text NOT NULL,                                   -- clé normalisée : cgct:L2121-29, loi:2015-991, cgct (code cité sans article)…
  type          text NOT NULL CHECK (type IN ('code', 'loi', 'ordonnance', 'decret', 'arrete', 'autre')),
  code          text,                                            -- clé du code (cgct, ccp…) pour un article
  article       text,
  intitule      text NOT NULL,                                   -- libellé normalisé, tel qu'il doit être visé
  statut        text NOT NULL DEFAULT 'en_vigueur' CHECK (statut IN ('en_vigueur', 'modifie', 'abroge')),
  date_debut    date,
  date_fin      date,
  verifie_le    date,                                            -- dernière vérification par le juridique
  verifie_par   text,
  source        text,                                            -- Légifrance, JO…
  note          text,
  matieres      integer[] NOT NULL DEFAULT '{}',                 -- rattachement facultatif (ref_items)
  types_acte    integer[] NOT NULL DEFAULT '{}',
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisme_id, cle)
);
CREATE TRIGGER visa_library_touch BEFORE UPDATE ON visa_library FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE visa_controles (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  nom           text NOT NULL,
  type_acte_id  integer,                                         -- NULL : tous les types d'acte
  matiere_id    integer,                                         -- NULL : toutes les matières (sous-niveaux compris)
  regle         text NOT NULL CHECK (regle IN ('visa', 'mention')),
  cle           text,                                            -- règle « visa » : clé de la bibliothèque attendue
  motif         text,                                            -- règle « mention » : expression attendue dans les textes
  est_regex     boolean NOT NULL DEFAULT false,
  montant_min   numeric(14, 2),                                  -- ne s'applique qu'à partir de ce montant
  gravite       text NOT NULL DEFAULT 'a_revoir' CHECK (gravite IN ('bloquant', 'a_revoir', 'info')),
  message       text,
  actif         boolean NOT NULL DEFAULT true,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((regle = 'visa' AND cle IS NOT NULL) OR (regle = 'mention' AND motif IS NOT NULL))
);
CREATE INDEX visa_controles_org_idx ON visa_controles (organisme_id) WHERE actif;
CREATE TRIGGER visa_controles_touch BEFORE UPDATE ON visa_controles FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
