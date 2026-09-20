-- 0036 — sauvegarde vers un dossier réseau (SAV-01 à SAV-07, D96) : configuration de la plateforme (une seule ligne) et journal.
CREATE TABLE sauvegarde_config (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id),
  actif                boolean NOT NULL DEFAULT false,
  cible                text,                                   -- chemin UNC (\\serveur\partage\dossier), lecteur monté ou dossier local
  utilisateur          text,                                   -- DOMAINE\compte (facultatif si le compte du service a déjà accès)
  mot_de_passe_chiffre text,                                   -- AES-256-GCM ; jamais renvoyé par l'API
  heure                text NOT NULL DEFAULT '02:00' CHECK (heure ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  retention_jours      integer NOT NULL DEFAULT 30 CHECK (retention_jours BETWEEN 1 AND 3650),
  inclure_fichiers     boolean NOT NULL DEFAULT true,
  updated_by           text,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sauvegardes (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  debut         timestamptz NOT NULL DEFAULT now(),
  fin           timestamptz,
  statut        text NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours', 'ok', 'erreur')),
  declencheur   text NOT NULL CHECK (declencheur IN ('planifie', 'manuel')),
  lance_par     text,
  dossier       text,                                          -- nom du dossier de sauvegarde sur la cible
  tables        integer,
  lignes        bigint,
  octets_base   bigint,
  fichiers      integer,
  octets_fichiers bigint,
  purgees       integer,
  erreur        text
);
CREATE INDEX sauvegardes_debut_idx ON sauvegardes (debut DESC);
