-- 0024 — suivi de la séance en direct : présences, pouvoirs, point en cours, notes, votes (section 19.1 bis, D78).

-- état de la tenue d'une séance (une ligne dès l'ouverture) ; `version` s'incrémente à chaque modification (synchronisation en direct)
CREATE TABLE seance_tenue (
  seance_id         integer PRIMARY KEY REFERENCES seances(id) ON DELETE CASCADE,
  organisme_id      integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  statut            text NOT NULL DEFAULT 'ouverte' CHECK (statut IN ('ouverte', 'close')),
  point_courant_id  integer REFERENCES seance_items(id) ON DELETE SET NULL,
  president_elu_id  integer REFERENCES elus(id) ON DELETE SET NULL,
  secretaire_elu_id integer REFERENCES elus(id) ON DELETE SET NULL,
  notes             text NOT NULL DEFAULT '',
  version           integer NOT NULL DEFAULT 1,
  ouverte_at        timestamptz NOT NULL DEFAULT now(),
  ouverte_par       text NOT NULL,
  close_at          timestamptz,
  close_par         text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- présence de chaque élu : absent (défaut) / excusé / présent, et « en salle » (un présent peut être sorti un moment)
CREATE TABLE seance_presences (
  seance_id  integer NOT NULL REFERENCES seances(id) ON DELETE CASCADE,
  elu_id     integer NOT NULL REFERENCES elus(id) ON DELETE CASCADE,
  statut     text NOT NULL DEFAULT 'absent' CHECK (statut IN ('absent', 'excuse', 'present')),
  en_salle   boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (seance_id, elu_id),
  CHECK (NOT en_salle OR statut = 'present')
);

-- pouvoirs : un seul par mandataire, et un seul par mandant
CREATE TABLE seance_procurations (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seance_id         integer NOT NULL REFERENCES seances(id) ON DELETE CASCADE,
  mandant_elu_id    integer NOT NULL REFERENCES elus(id) ON DELETE CASCADE,
  mandataire_elu_id integer NOT NULL REFERENCES elus(id) ON DELETE CASCADE,
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seance_id, mandant_elu_id),
  UNIQUE (seance_id, mandataire_elu_id),
  CHECK (mandant_elu_id <> mandataire_elu_id)
);

-- état de chaque point de l'ordre du jour pendant la séance
CREATE TABLE seance_points (
  item_id     integer PRIMARY KEY REFERENCES seance_items(id) ON DELETE CASCADE,
  seance_id   integer NOT NULL REFERENCES seances(id) ON DELETE CASCADE,
  etat        text NOT NULL DEFAULT 'a_traiter' CHECK (etat IN ('a_traiter', 'en_cours', 'traite', 'sans_vote', 'retire', 'ajourne')),
  notes       text NOT NULL DEFAULT '',
  scrutin     text NOT NULL DEFAULT 'main_levee' CHECK (scrutin IN ('main_levee', 'public', 'secret', 'unanimite')),
  resultat    text CHECK (resultat IN ('adopte_unanimite', 'adopte_majorite', 'adopte_preponderante', 'rejete_preponderante', 'rejete')),
  pour        integer, contre integer, abstention integer, nppv integer, absents integer, votants integer,
  debut_at    timestamptz,
  close_at    timestamptz,
  close_par   text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seance_points_seance_idx ON seance_points (seance_id);

-- vote de chaque élu sur un point (choix ; « absent » = voix non exercée, fixé à la clôture du vote)
CREATE TABLE seance_votes (
  item_id     integer NOT NULL REFERENCES seance_items(id) ON DELETE CASCADE,
  elu_id      integer NOT NULL REFERENCES elus(id) ON DELETE CASCADE,
  choix       text NOT NULL CHECK (choix IN ('pour', 'contre', 'abstention', 'nppv', 'absent')),
  mandataire_elu_id integer REFERENCES elus(id) ON DELETE SET NULL,  -- renseigné à la clôture : voix exercée par ce mandataire pour cet élu (pouvoir)
  at          timestamptz NOT NULL DEFAULT now(),
  saisi_par   text NOT NULL,
  PRIMARY KEY (item_id, elu_id)
);

-- journal de la séance : arrivées, sorties, retours, changement de point, pouvoirs, clôtures, corrections
CREATE TABLE seance_journal (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seance_id  integer NOT NULL REFERENCES seances(id) ON DELETE CASCADE,
  item_id    integer,
  elu_id     integer,
  type       text NOT NULL,
  detail     jsonb,
  actor      text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seance_journal_idx ON seance_journal (seance_id, id);
