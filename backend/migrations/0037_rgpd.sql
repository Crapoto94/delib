-- 0037 — RGPD : archivage intermédiaire des actes et pseudonymisation des actions et journaux.
-- L'archivage intermédiaire sort un acte de l'usage courant (listes actives, recherche) sans le supprimer :
-- il reste conservé pour la preuve et la ré-identification, avec une durée de conservation maîtrisée.

ALTER TABLE actes ADD COLUMN archive_intermediaire_at timestamptz;
ALTER TABLE actes ADD COLUMN archive_intermediaire_par text;
ALTER TABLE actes ADD COLUMN archive_intermediaire_motif text;
CREATE INDEX actes_archive_intermediaire_idx ON actes (organisme_id, archive_intermediaire_at);

-- Journal des opérations RGPD : qui a lancé quoi, quand, avec quel seuil et quel résultat.
CREATE TABLE rgpd_operations (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN ('archivage_intermediaire', 'pseudonymisation')),
  seuil         timestamptz,
  acteur        text NOT NULL,
  parametres    jsonb NOT NULL DEFAULT '{}'::jsonb,
  resultat      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rgpd_operations_org_idx ON rgpd_operations (organisme_id, created_at DESC);

-- Correspondance des pseudonymes, conservée à part (accès restreint à l'administrateur) : elle permet la
-- ré-identification par une personne habilitée sans réécrire le journal d'audit, qui reste immuable (SEC-04).
CREATE TABLE rgpd_pseudonymes (
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN ('acteur', 'ip')),
  original      text NOT NULL,
  pseudonyme    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisme_id, type, original)
);
CREATE INDEX rgpd_pseudonymes_pseudo_idx ON rgpd_pseudonymes (organisme_id, pseudonyme);

-- Vue des journaux pseudonymisés : les valeurs présentes dans la correspondance sont remplacées.
CREATE VIEW audit_log_pseudonymise AS
SELECT l.id, l.at, l.organisme_id,
       COALESCE(pa.pseudonyme, l.actor) AS actor,
       COALESCE(pb.pseudonyme, l.on_behalf_of) AS on_behalf_of,
       l.action, l.entity, l.entity_id, l.before, l.after,
       COALESCE(pi.pseudonyme, l.ip) AS ip
FROM audit_log l
LEFT JOIN rgpd_pseudonymes pa ON pa.organisme_id = l.organisme_id AND pa.type = 'acteur' AND pa.original = l.actor
LEFT JOIN rgpd_pseudonymes pb ON pb.organisme_id = l.organisme_id AND pb.type = 'acteur' AND pb.original = l.on_behalf_of
LEFT JOIN rgpd_pseudonymes pi ON pi.organisme_id = l.organisme_id AND pi.type = 'ip' AND pi.original = l.ip;
