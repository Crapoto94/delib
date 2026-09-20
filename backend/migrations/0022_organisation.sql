-- 0022 — organisation des responsables : postes vacants, rattachement des directions aux DGA (ou à la DGS), visibilité des actes.

-- Poste VACANT : un titulaire déclaré « vacant » n'a pas de personne ; l'étape correspondante du circuit est contournée
-- automatiquement (et affichée comme telle dans la représentation du circuit).
ALTER TABLE titulaires ADD COLUMN vacant boolean NOT NULL DEFAULT false;
ALTER TABLE titulaires ALTER COLUMN username DROP NOT NULL;
ALTER TABLE titulaires ADD CONSTRAINT titulaires_vacant_chk CHECK ((vacant AND username IS NULL) OR (NOT vacant AND username IS NOT NULL));

-- Postes de DGA : un DGA encadre PLUSIEURS directions et répond toujours à la DGS. Un poste a un titulaire (et un suppléant
-- éventuel) ou est déclaré vacant : l'étape DGA des dossiers de ses directions est alors contournée.
CREATE TABLE dga_postes (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  libelle      text NOT NULL,
  username     text CHECK (username IS NULL OR username = lower(username)),
  suppleant    text,
  vacant       boolean NOT NULL DEFAULT false,
  updated_by   text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisme_id, libelle),
  CHECK ((vacant AND username IS NULL) OR (NOT vacant AND username IS NOT NULL))
);

-- Rattachement des directions : chaque direction relève d'un poste de DGA ou directement de la DGS. C'est un choix
-- d'organisation, absent de l'organigramme RH : il est donc défini ici.
CREATE TABLE direction_rattachements (
  organisme_id   integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  direction_code text NOT NULL,
  rattachement   text NOT NULL CHECK (rattachement IN ('dga', 'dgs')),
  dga_poste_id   integer REFERENCES dga_postes(id) ON DELETE RESTRICT,
  updated_by     text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisme_id, direction_code),
  CHECK ((rattachement = 'dga' AND dga_poste_id IS NOT NULL) OR (rattachement = 'dgs' AND dga_poste_id IS NULL))
);
CREATE INDEX direction_rattachements_poste_idx ON direction_rattachements (dga_poste_id);

-- Visibilité des actes : réglage par utilisateur, qui prime sur le réglage général de l'organisme (`actes.visibilite`).
CREATE TABLE user_acte_visibility (
  organisme_id integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  username     text NOT NULL CHECK (username = lower(username)),
  visibilite   text NOT NULL CHECK (visibilite IN ('redacteur', 'service', 'direction')),
  updated_by   text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisme_id, username)
);
