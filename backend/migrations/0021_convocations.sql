-- 0021 — convocations (CONV-01 à CONV-09) : une convocation = une version envoyée à une liste de convoqués.
-- Chaque convoqué (élu, agent de la Ville, membre de commission…) reçoit un LIEN PERSONNEL (jeton unique) : son ouverture, la
-- consultation de la convocation et de l'ordre du jour, l'accusé de lecture et la réponse de présence sont journalisés.
CREATE TABLE convocations (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  seance_id     integer NOT NULL REFERENCES seances(id) ON DELETE CASCADE,
  version_no    integer NOT NULL,
  modificatif   boolean NOT NULL DEFAULT false,               -- version 2 et suivantes : ordre du jour modifié
  objet         text NOT NULL,
  message       text,
  urgence       boolean NOT NULL DEFAULT false,
  urgence_motif text,
  delai_jours_francs integer,                                 -- délai réel entre l'envoi et la séance
  delai_requis  integer,
  avertissement text,                                         -- délai non respecté mais autorisé par le paramétrage
  odj_snapshot  jsonb NOT NULL DEFAULT '[]'::jsonb,           -- [{ numero, titre, kind, rubrique, rapporteur }]
  differences   jsonb,                                        -- { ajoutes: [], retires: [] } par rapport à la version précédente
  convocation_file_id integer REFERENCES files(id),
  odj_file_id   integer REFERENCES files(id),
  statut        text NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours', 'envoyee')),
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  UNIQUE (seance_id, version_no)
);
CREATE INDEX convocations_seance_idx ON convocations (seance_id, version_no DESC);

CREATE TABLE convocation_destinataires (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  convocation_id integer NOT NULL REFERENCES convocations(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('elu', 'agent')),
  elu_id        integer REFERENCES elus(id) ON DELETE SET NULL,
  username      text,
  nom           text NOT NULL,
  qualite       text,                                         -- rôle de l'élu, poste ou direction de l'agent
  groupe        text,                                         -- groupe politique (élus)
  email         text,
  token         text NOT NULL UNIQUE,                         -- lien personnel : /c/<jeton>
  envoi_statut  text NOT NULL DEFAULT 'en_attente' CHECK (envoi_statut IN ('en_attente', 'envoye', 'echec')),
  envoye_at     timestamptz,
  erreur        text,
  ouvertures    integer NOT NULL DEFAULT 0,
  premiere_ouverture_at timestamptz,
  derniere_ouverture_at timestamptz,
  conv_lectures integer NOT NULL DEFAULT 0,                   -- consultations du PDF de convocation
  conv_lue_at   timestamptz,
  odj_lectures  integer NOT NULL DEFAULT 0,                   -- consultations du PDF de l'ordre du jour
  odj_lu_at     timestamptz,
  accuse_at     timestamptz,                                  -- « J'ai pris connaissance »
  reponse       text CHECK (reponse IN ('present', 'absent')),
  reponse_commentaire text,
  reponse_at    timestamptz,
  relances      integer NOT NULL DEFAULT 0,
  derniere_relance_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX convocation_dest_conv_idx ON convocation_destinataires (convocation_id);

-- journal : preuve d'envoi et de consultation (adresse IP seulement sous forme d'empreinte)
CREATE TABLE convocation_events (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  convocation_id integer NOT NULL REFERENCES convocations(id) ON DELETE CASCADE,
  destinataire_id integer REFERENCES convocation_destinataires(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN ('envoi', 'echec', 'relance', 'ouverture', 'convocation_lue', 'odj_lu', 'accuse', 'reponse')),
  at            timestamptz NOT NULL DEFAULT now(),
  ip_hash       text,
  user_agent    text,
  meta          jsonb
);
CREATE INDEX convocation_events_conv_idx ON convocation_events (convocation_id, at DESC);
CREATE INDEX convocation_events_dest_idx ON convocation_events (destinataire_id, at DESC);
