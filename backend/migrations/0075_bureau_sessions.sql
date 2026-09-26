-- 0075 — bureau en ligne : sessions d'édition d'un document par le serveur de documents.
--
-- Quand un agent ouvre une annexe Word dans le navigateur, le moteur (conteneur) vient chercher le fichier puis
-- nous rappelle à chaque enregistrement. Le rappel est anonyme : il n'y a pas de session applicative. Cette table est
-- donc le lien entre la clé remise au moteur et l'(acte, annexe, auteur, version) au moment de l'ouverture — c'est
-- aussi la trace d'une consultation : qui a ouvert quelle version d'un document, et quand (transparence, principe 3).
--
-- Le jeton est tiré au sort (128 bits) et sert d'adresse de téléchargement pour le moteur : il n'est pas devinable.
-- `expire_at` évite qu'un lien reste bon indéfiniment ; `consomme_at` est posé dès que le moteur a récupéré le
-- fichier ou signalé une sauvegarde : le lien ne sert plus à rien et l'annexe reste gelée de ce côté.
-- `version` suit l'annexe : le moteur signale CHAQUE enregistrement (forcesave), pas seulement la fermeture, donc
-- la version attendue est remise à jour à chaque écriture acceptée — sans quoi la 2e sauvegarde serait lue comme un
-- conflit. `kind` (ad | local) permet de reconstruire le contexte exact de l'auteur au rappel, pour lui réappliquer
-- le contrôle d'accès — donc la règle du gel après transmission — sans lui fabriquer un contexte de fortune.

CREATE TABLE IF NOT EXISTS bureau_sessions (
  id            bigserial PRIMARY KEY,
  cle           text NOT NULL UNIQUE,
  usage         text NOT NULL DEFAULT 'edition',      -- edition | conversion
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  acte_id       integer REFERENCES actes(id) ON DELETE CASCADE,
  annexe_id     integer REFERENCES annexes(id) ON DELETE CASCADE,
  username      text NOT NULL,
  kind          text NOT NULL DEFAULT 'ad',           -- provenance de la session applicative (ad | local)
  version       integer,                              -- version de l'annexe à l'ouverture, puis après chaque écriture
  user_agent    text,
  ouverte_at    timestamptz NOT NULL DEFAULT now(),
  expire_at     timestamptz NOT NULL,
  consomme_at   timestamptz
);
CREATE INDEX IF NOT EXISTS bureau_sessions_organisme_idx ON bureau_sessions (organisme_id, ouverte_at DESC);
CREATE INDEX IF NOT EXISTS bureau_sessions_annexe_idx ON bureau_sessions (annexe_id);
