-- 0045 — relance des services par séance (SEA-16) et lien de calendrier dynamique pour Outlook (SEA-17), D108.
CREATE TABLE seance_relances (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id   integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  seance_id      integer NOT NULL REFERENCES seances(id) ON DELETE CASCADE,
  acte_id        integer NOT NULL REFERENCES actes(id) ON DELETE CASCADE,
  destinataires  jsonb NOT NULL DEFAULT '[]'::jsonb,
  message        text,
  par            text NOT NULL,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seance_relances_acte_idx ON seance_relances (acte_id, at DESC);
CREATE INDEX seance_relances_seance_idx ON seance_relances (seance_id, at DESC);

-- Un lien secret par personne et par organisme : l'URL EST l'authentification (192 bits). Seule l'empreinte sert à retrouver le lien ;
-- la clé est aussi conservée chiffrée pour pouvoir réafficher le lien à son propriétaire.
CREATE TABLE calendrier_liens (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id    integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  username        text NOT NULL,
  token_hash      text NOT NULL UNIQUE,
  token_chiffre   text NOT NULL,
  cree_le         timestamptz NOT NULL DEFAULT now(),
  dernier_acces   timestamptz,
  nb_acces        integer NOT NULL DEFAULT 0,
  UNIQUE (organisme_id, username)
);
