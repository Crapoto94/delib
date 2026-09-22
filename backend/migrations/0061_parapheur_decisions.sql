-- 0061 — Décisions et arrêtés : signature du maire par parapheur à la fin du circuit.
--
-- Un acte dont le type porte `signature: true` (décision, arrêté) ne part pas au conseil : une fois le circuit terminé,
-- il passe à l'état « à signer » et part au parapheur (DSIHUB par défaut) pour la signature du maire. L'envoi et les
-- échanges avec le parapheur sont journalisés (ce qui est envoyé, ce qui revient). Les décisions peuvent lier les
-- délibérations qui autorisent le maire à décider (acte_liens).

-- Nouveaux états du dossier (signature).
ALTER TABLE actes DROP CONSTRAINT IF EXISTS actes_statut_check;
ALTER TABLE actes ADD CONSTRAINT actes_statut_check CHECK (statut IN (
  'brouillon', 'en_circuit', 'modification_demandee', 'valide_dgs', 'en_attente_scc', 'mis_a_disposition', 'avis_rendu',
  'inscrit_odj', 'adopte', 'rejete', 'retire', 'ajourne', 'texte_definitif_pret', 'pret_a_transmettre', 'transmis',
  'ar_recu', 'publie', 'executoire', 'abandonne', 'rappele', 'archive',
  'a_signer', 'signe', 'signature_refusee'));

-- Configuration du parapheur, par organisme (aucun secret en clair : le mot de passe/la clé est chiffré au repos).
CREATE TABLE parapheur_config (
  organisme_id        integer PRIMARY KEY REFERENCES organismes(id) ON DELETE CASCADE,
  fournisseur         text NOT NULL DEFAULT 'dsihub' CHECK (fournisseur IN ('dsihub', 'iparapheur')),
  actif               boolean NOT NULL DEFAULT true,
  mode                text NOT NULL DEFAULT 'dev' CHECK (mode IN ('dev', 'prod')),
  url                 text,
  utilisateur         text,
  secret_chiffre      text,
  email_test          text,
  signataire_nom      text,
  signataire_email    text,
  signataire_qualite  text,
  updated_by          text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Un envoi en signature par acte (le dernier fait foi). Le payload et la réponse bruts sont conservés.
CREATE TABLE parapheur_envois (
  id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id       integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  acte_id            integer NOT NULL REFERENCES actes(id) ON DELETE CASCADE,
  fournisseur        text NOT NULL,
  mode               text NOT NULL,
  ref_externe        text,
  statut             text NOT NULL DEFAULT 'envoye' CHECK (statut IN ('envoye', 'a_signer', 'signe', 'refuse', 'annule', 'erreur')),
  signataire_nom     text,
  signataire_email   text,
  document_nom       text,
  lien_externe       text,
  demande_at         timestamptz NOT NULL DEFAULT now(),
  signe_at           timestamptz,
  refuse_at          timestamptz,
  motif              text,
  payload            jsonb,
  reponse            jsonb,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX parapheur_envois_acte_idx ON parapheur_envois (acte_id, demande_at DESC);
CREATE INDEX parapheur_envois_org_idx ON parapheur_envois (organisme_id, statut);

ALTER TABLE actes ADD COLUMN IF NOT EXISTS parapheur_envoi_id integer;
ALTER TABLE actes ADD COLUMN IF NOT EXISTS signe_at timestamptz;
ALTER TABLE actes ADD COLUMN IF NOT EXISTS signe_par text;
ALTER TABLE actes DROP CONSTRAINT IF EXISTS actes_parapheur_envoi_fk;
ALTER TABLE actes ADD CONSTRAINT actes_parapheur_envoi_fk FOREIGN KEY (parapheur_envoi_id) REFERENCES parapheur_envois(id) ON DELETE SET NULL;

-- Journal des échanges avec le parapheur : sens sortant (ce que VibeDélib envoie) et entrant (ce que le parapheur renvoie).
CREATE TABLE parapheur_journal (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  envoi_id     integer REFERENCES parapheur_envois(id) ON DELETE CASCADE,
  acte_id      integer REFERENCES actes(id) ON DELETE CASCADE,
  sens         text NOT NULL CHECK (sens IN ('sortant', 'entrant')),
  methode      text,
  url          text,
  http_status  integer,
  resume       text,
  corps        jsonb,
  reponse      jsonb,
  erreur       text,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX parapheur_journal_envoi_idx ON parapheur_journal (envoi_id, at);
CREATE INDEX parapheur_journal_org_idx ON parapheur_journal (organisme_id, at DESC);

-- Délibérations qui autorisent le maire à prendre une décision (une décision = acte, la cible = délibération adoptée).
CREATE TABLE acte_liens (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id   integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  acte_id        integer NOT NULL REFERENCES actes(id) ON DELETE CASCADE,
  cible_acte_id  integer NOT NULL REFERENCES actes(id) ON DELETE CASCADE,
  kind           text NOT NULL DEFAULT 'autorisation' CHECK (kind IN ('autorisation')),
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (acte_id, cible_acte_id, kind),
  CHECK (acte_id <> cible_acte_id)
);
CREATE INDEX acte_liens_cible_idx ON acte_liens (cible_acte_id);
