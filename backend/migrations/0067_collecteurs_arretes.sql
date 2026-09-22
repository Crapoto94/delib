-- 0067_collecteurs_arretes.sql — Collecteurs d'arrêtés (moissonne mail / espace, analyse IA, signature).
-- Un collecteur moissonne une source (boîte mail Microsoft Graph ou dossier de partage), fait analyser le document
-- (destinataire, type d'arrêté, objet, trame), crée l'arrêté et l'envoie en signature au maire ou à l'élu associé.
-- Les cas incertains restent « en attente » et alertent l'administration.

CREATE TABLE IF NOT EXISTS collecteur_types_arretes (
  id serial PRIMARY KEY,
  organisme_id integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  nom text NOT NULL,
  actif boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_collecteur_types_arretes_nom ON collecteur_types_arretes (organisme_id, lower(nom));

-- config (jsonb) selon le type :
--   mail    : { graphTenant?, graphClientId?, graphSecret?chiffré, graphMailbox, dossierSignes? , essai? }  (les 3 premiers : défaut = paramètres GRAPH_* de l'installation)
--   dossier : { cible, utilisateur?, motDePasse?chiffré, sousDossiers: 'elus'|'gauche', mouvement: 'deplacer'|'supprimer' }
CREATE TABLE IF NOT EXISTS collecteurs (
  id serial PRIMARY KEY,
  organisme_id integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  nom text NOT NULL,
  type text NOT NULL CHECK (type IN ('mail', 'dossier')),
  actif boolean NOT NULL DEFAULT true,
  intervalle text NOT NULL DEFAULT '24h' CHECK (intervalle IN ('1h', '4h', '24h')),
  type_arrete_id integer REFERENCES collecteur_types_arretes(id) ON DELETE SET NULL,
  elu_id integer REFERENCES elus(id) ON DELETE SET NULL,
  email_retour text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  dernier_passage timestamptz,
  prochain_passage timestamptz,
  dernier_resultat jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_collecteurs_org ON collecteurs(organisme_id, actif);

CREATE TABLE IF NOT EXISTS collectes (
  id serial PRIMARY KEY,
  collecteur_id integer NOT NULL REFERENCES collecteurs(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  origine text,
  nom_fichier text NOT NULL,
  statut text NOT NULL DEFAULT 'recu' CHECK (statut IN ('recu', 'traite', 'attente', 'erreur', 'doublon')),
  acte_id integer REFERENCES actes(id) ON DELETE SET NULL,
  elu_id integer REFERENCES elus(id) ON DELETE SET NULL,
  detail jsonb,
  erreur text,
  traite_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_collectes_collecteur ON collectes(collecteur_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_collectes_statut ON collectes(statut, collecteur_id);

-- Les arrêtés créés par un collecteur (badge « collecté » dans l'interface, et retour de signature ciblé).
ALTER TABLE actes ADD COLUMN IF NOT EXISTS source_collecteur boolean NOT NULL DEFAULT false;