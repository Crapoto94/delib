-- 0026 — télétransmission au contrôle de légalité (S²LOW, module ACTES ; section 19.5, TLT-01 à TLT-19, D82).

-- une transaction = une délibération transmise ; `status` reprend les codes de S²LOW (-1 erreur, 0 annulé, 1 posté, 2 en attente de
-- transmission, 3 transmis, 4 acquittement reçu, 5 validé, 6 refusé, 17 en attente d'être postée)
CREATE TABLE tlt_transactions (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id    integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  acte_id         integer NOT NULL REFERENCES actes(id) ON DELETE CASCADE,
  seance_id       integer REFERENCES seances(id) ON DELETE SET NULL,
  item_id         integer,
  numero_transmis text NOT NULL,                      -- 15 caractères au plus : majuscules, chiffres, « _ » (distinct du numéro d'affichage)
  mode            text NOT NULL CHECK (mode IN ('simulation', 'test', 'production')),
  etat            text NOT NULL DEFAULT 'prepare' CHECK (etat IN ('prepare', 'poste', 'annule', 'erreur')),
  remote_id       text,                               -- identifiant de la transaction chez S²LOW (enregistré dès la réponse OK : TLT-11)
  status          integer,
  status_label    text,
  package         jsonb NOT NULL,                     -- ce qui est posté : nature, classification, date, objet, fichiers, annexes typées, scénario de simulation
  file_id         integer REFERENCES files(id),       -- PDF de la délibération transmise
  prepared_by     text NOT NULL,
  prepared_at     timestamptz NOT NULL DEFAULT now(),
  sent_by         text,
  sent_at         timestamptz,
  ar_at           timestamptz,                        -- date d'acquittement de la préfecture (renseignée automatiquement : TLT-07)
  ar_id           text,                               -- identifiant unique de l'acte (ARActe)
  ar_content      text,
  error           text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisme_id, numero_transmis)
);
-- une seule transaction vivante par acte (préparée ou postée) : jamais deux envois du même acte
CREATE UNIQUE INDEX tlt_acte_vivante ON tlt_transactions (acte_id) WHERE etat IN ('prepare', 'poste');
CREATE INDEX tlt_org_idx ON tlt_transactions (organisme_id, etat, status);

CREATE TABLE tlt_journal (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id integer NOT NULL REFERENCES tlt_transactions(id) ON DELETE CASCADE,
  type           text NOT NULL,
  detail         jsonb,
  actor          text NOT NULL,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tlt_journal_idx ON tlt_journal (transaction_id, id);

-- documents de la préfecture (courrier simple 2, demande de pièces 3, lettre d'observation 4, déféré 5)
CREATE TABLE tlt_documents (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id   integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  transaction_id integer NOT NULL REFERENCES tlt_transactions(id) ON DELETE CASCADE,
  remote_id      text NOT NULL,
  type           integer NOT NULL CHECK (type IN (2, 3, 4, 5)),
  titre          text NOT NULL,
  contenu        text,
  received_at    timestamptz NOT NULL DEFAULT now(),
  statut         text NOT NULL DEFAULT 'a_traiter' CHECK (statut IN ('a_traiter', 'repondu', 'clos')),
  reponse        jsonb,
  traite_par     text,
  traite_at      timestamptz,
  UNIQUE (transaction_id, remote_id)
);

-- SIMULATEUR S²LOW : le « serveur distant » factice (mode simulation, TLT-19). Ces tables n'existent que pour reproduire les réponses de
-- S²LOW (OK / KO, statuts, ARActe, documents de la préfecture) ; elles ne sont jamais lues par le reste de l'application.
CREATE TABLE s2low_sim_transactions (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  remote_id    text NOT NULL UNIQUE,
  numero       text NOT NULL,
  payload      jsonb NOT NULL,
  status       integer NOT NULL,
  step         integer NOT NULL DEFAULT 0,             -- prochaine étape du scénario à jouer
  scenario     text NOT NULL DEFAULT 'nominal',
  attente      boolean NOT NULL DEFAULT false,         -- la « préfecture » attend une réponse (pièces complémentaires)
  message      text,
  ar           jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE s2low_sim_documents (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sim_id     integer NOT NULL REFERENCES s2low_sim_transactions(id) ON DELETE CASCADE,
  type       integer NOT NULL,
  titre      text NOT NULL,
  contenu    text,
  lu         boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
