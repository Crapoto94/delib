-- 0012 — élus, groupes politiques, commissions, instances, séances, dérogations (sections 15, 16, 22.1).

-- groupes politiques (ELU-34) : propres à chaque organisme
CREATE TABLE groupes_politiques (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  nom           text NOT NULL,
  couleur       text,
  ordre         integer NOT NULL DEFAULT 0,
  actif         boolean NOT NULL DEFAULT true,
  UNIQUE (organisme_id, nom)
);

-- élus : cache du Hub DSI (source 'hub', lecture seule pour l'identité) ou saisie manuelle (CCAS, membres non élus)
CREATE TABLE elus (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('hub', 'manual')),
  external_id   text,
  nom           text NOT NULL,
  prenom        text NOT NULL DEFAULT '',
  email         text,
  telephone     text,
  role          text,                         -- Maire, Adjoint(e), Conseiller(ère)…
  delegation    text,
  est_elu       boolean NOT NULL DEFAULT true, -- false : membre non élu (saisi à la main, D22)
  groupe_id     integer REFERENCES groupes_politiques(id) ON DELETE SET NULL,
  mandat_debut  date,
  mandat_fin    date,
  actif         boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX elus_external_uq ON elus (organisme_id, source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX elus_org_idx ON elus (organisme_id, actif);
CREATE TRIGGER elus_touch BEFORE UPDATE ON elus FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- commissions (CMN-01) : toutes « pour avis » (D29)
CREATE TABLE commissions (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  nom           text NOT NULL,
  description   text,
  couleur       text,
  ordre         integer NOT NULL DEFAULT 0,
  matieres      jsonb NOT NULL DEFAULT '[]'::jsonb,     -- suggestions à la création d'un acte
  directions    jsonb NOT NULL DEFAULT '[]'::jsonb,
  actif         boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisme_id, nom)
);
CREATE TABLE commission_membres (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  commission_id  integer NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  elu_id         integer NOT NULL REFERENCES elus(id) ON DELETE CASCADE,
  fonction       text NOT NULL DEFAULT 'membre' CHECK (fonction IN ('president', 'vice_president', 'membre')),
  date_debut     date,
  date_fin       date,
  UNIQUE (commission_id, elu_id)
);
CREATE TABLE commission_secretaires (
  commission_id  integer NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  username       text NOT NULL,
  PRIMARY KEY (commission_id, username)
);

-- commissions d'un acte : avis (Favorable / Défavorable / Réservé / Sans avis) et mise à disposition (15.2)
CREATE TABLE acte_commissions (
  id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  acte_id              integer NOT NULL REFERENCES actes(id) ON DELETE CASCADE,
  commission_id        integer NOT NULL REFERENCES commissions(id),
  avis                 text CHECK (avis IN ('favorable', 'defavorable', 'reserve', 'sans_avis')),
  avis_commentaire     text,
  avis_date            date,
  avis_par             text,
  avis_at              timestamptz,
  mis_a_disposition_at timestamptz,
  suspendue            boolean NOT NULL DEFAULT false,
  retiree_at           timestamptz,
  retiree_motif        text,
  created_by           text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX acte_commissions_uq ON acte_commissions (acte_id, commission_id) WHERE retiree_at IS NULL;

-- instances (Conseil municipal, commission, CCAS…) et séances (SEA-01, SEA-02)
CREATE TABLE instances (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id   integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  code           text NOT NULL CHECK (code ~ '^[a-z0-9_-]{2,40}$'),
  nom            text NOT NULL,
  kind           text NOT NULL DEFAULT 'conseil' CHECK (kind IN ('conseil', 'commission', 'autre')),
  commission_id  integer REFERENCES commissions(id) ON DELETE SET NULL,
  numbering      jsonb NOT NULL DEFAULT '{"pattern":"{ANNEE}-{N_SEANCE}-{ORDRE:03}"}'::jsonb,   -- ODJ-05
  actif          boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisme_id, code)
);

CREATE TABLE seances (
  id                          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id                integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  instance_id                 integer NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  type                        text NOT NULL DEFAULT 'ordinaire' CHECK (type IN ('ordinaire', 'extraordinaire', 'budgetaire', 'autre')),
  date_seance                 timestamptz NOT NULL,
  lieu                        text,
  statut                      text NOT NULL DEFAULT 'planifiee' CHECK (statut IN ('planifiee', 'convoquee', 'tenue', 'close', 'annulee')),
  date_limite_redaction       timestamptz,
  date_limite_dgs             timestamptz,
  date_limite_mad_commissions timestamptz,
  date_envoi_convocation      timestamptz,
  jalons_extra                jsonb NOT NULL DEFAULT '[]'::jsonb,
  numbering                   jsonb,                       -- surcharge du motif pour cette séance
  odj_statut                  text NOT NULL DEFAULT 'en_preparation' CHECK (odj_statut IN ('en_preparation', 'arrete', 'convoque', 'tenue')),
  odj_arrete_at               timestamptz,
  odj_arrete_par              text,
  created_by                  text NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seances_org_date_idx ON seances (organisme_id, date_seance);
CREATE TRIGGER seances_touch BEFORE UPDATE ON seances FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE actes ADD CONSTRAINT actes_seance_visee_fk FOREIGN KEY (seance_visee_id) REFERENCES seances(id) ON DELETE SET NULL;
ALTER TABLE actes ADD CONSTRAINT actes_seance_fk FOREIGN KEY (seance_id) REFERENCES seances(id) ON DELETE SET NULL;
ALTER TABLE actes ADD CONSTRAINT actes_rapporteur_fk FOREIGN KEY (rapporteur_id) REFERENCES elus(id) ON DELETE SET NULL;
ALTER TABLE actes ADD CONSTRAINT actes_rapporteur_compl_fk FOREIGN KEY (rapporteur_compl_id) REFERENCES elus(id) ON DELETE SET NULL;

-- historique des affectations / reports d'un acte entre séances (SEA-05)
CREATE TABLE acte_seance_history (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  acte_id     integer NOT NULL REFERENCES actes(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('visee', 'report', 'affectation', 'retrait')),
  from_seance integer,
  to_seance   integer,
  motif       text,
  actor       text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX acte_seance_history_acte_idx ON acte_seance_history (acte_id);

-- dérogations à la date limite de rédaction (NOT-06, NOT-07)
CREATE TABLE derogations (
  id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id         integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  acte_id              integer NOT NULL REFERENCES actes(id) ON DELETE CASCADE,
  seance_id            integer NOT NULL REFERENCES seances(id) ON DELETE CASCADE,
  demandeur            text NOT NULL,
  motif                text NOT NULL,
  nouvelle_date_limite timestamptz,
  statut               text NOT NULL DEFAULT 'demandee' CHECK (statut IN ('demandee', 'accordee', 'refusee', 'annulee')),
  decide_par           text,
  decide_at            timestamptz,
  decision_motif       text,
  valide_jusqu_au      timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX derogations_acte_idx ON derogations (acte_id, statut);
CREATE INDEX derogations_org_idx ON derogations (organisme_id, statut);
