-- 0027 — espace élus (section 18, D85) : comptes, sessions, codes à usage unique, appareils de confiance, journal de consultation,
-- points lus / favoris, notes personnelles partageables. RIEN ici ne contient de note de séance ni de donnée de saisie.

CREATE TABLE elu_comptes (
  elu_id            integer PRIMARY KEY REFERENCES elus(id) ON DELETE CASCADE,
  organisme_id      integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  email             text NOT NULL,
  password_hash     text,                                  -- scrypt ; NULL tant que l'invitation n'est pas acceptée
  actif             boolean NOT NULL DEFAULT true,
  invitation_hash   text,                                  -- empreinte du lien d'invitation (le lien lui-même n'est jamais conservé)
  invitation_expire timestamptz,
  invite_par        text,
  invite_le         timestamptz,
  accepte_le        timestamptz,
  derniere_connexion timestamptz,
  echecs            integer NOT NULL DEFAULT 0,
  verrouille_jusqu  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX elu_comptes_email_uq ON elu_comptes (organisme_id, lower(email));

CREATE TABLE elu_sessions (
  jti         uuid PRIMARY KEY,
  elu_id      integer NOT NULL REFERENCES elus(id) ON DELETE CASCADE,
  expire_le   timestamptz NOT NULL,
  revoquee_le timestamptz,
  ip          text,
  appareil    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX elu_sessions_elu_idx ON elu_sessions (elu_id, expire_le);

-- défi de connexion : code à 6 chiffres envoyé par mail (10 minutes, 5 essais)
CREATE TABLE elu_codes (
  id         uuid PRIMARY KEY,
  elu_id     integer NOT NULL REFERENCES elus(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  expire_le  timestamptz NOT NULL,
  essais     integer NOT NULL DEFAULT 0,
  utilise_le timestamptz,
  appareil   text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE elu_appareils (
  elu_id        integer NOT NULL REFERENCES elus(id) ON DELETE CASCADE,
  appareil_hash text NOT NULL,
  confiance_jusqu timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (elu_id, appareil_hash)
);

-- journal de consultation (MAD-06) : qui a ouvert quoi, quelle version, combien de fois ; sert aussi à « ce qui a changé depuis ma dernière lecture »
CREATE TABLE elu_lectures (
  elu_id     integer NOT NULL REFERENCES elus(id) ON DELETE CASCADE,
  seance_id  integer NOT NULL REFERENCES seances(id) ON DELETE CASCADE,
  doc_key    text NOT NULL,
  version    text NOT NULL,
  premiere_le timestamptz NOT NULL DEFAULT now(),
  derniere_le timestamptz NOT NULL DEFAULT now(),
  nb         integer NOT NULL DEFAULT 1,
  hors_ligne boolean NOT NULL DEFAULT false,
  PRIMARY KEY (elu_id, seance_id, doc_key, version)
);
CREATE INDEX elu_lectures_seance_idx ON elu_lectures (seance_id, doc_key);

CREATE TABLE elu_points (
  elu_id  integer NOT NULL REFERENCES elus(id) ON DELETE CASCADE,
  item_id integer NOT NULL REFERENCES seance_items(id) ON DELETE CASCADE,
  lu      boolean NOT NULL DEFAULT false,
  favori  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (elu_id, item_id)
);

-- notes personnelles par point : privées par défaut ; ni les agents ni le SCC ne les lisent (ELU-33) — aucune route agent n'y accède
CREATE TABLE elu_notes (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  elu_id     integer NOT NULL REFERENCES elus(id) ON DELETE CASCADE,
  seance_id  integer NOT NULL REFERENCES seances(id) ON DELETE CASCADE,
  item_id    integer REFERENCES seance_items(id) ON DELETE CASCADE,
  texte      text NOT NULL,
  partage    text NOT NULL DEFAULT 'prive' CHECK (partage IN ('prive', 'groupe', 'elus')),
  groupe_id  integer,                                   -- groupe au moment du partage
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX elu_notes_seance_idx ON elu_notes (seance_id, item_id);
CREATE TABLE elu_notes_partages (
  note_id integer NOT NULL REFERENCES elu_notes(id) ON DELETE CASCADE,
  elu_id  integer NOT NULL REFERENCES elus(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, elu_id)
);
