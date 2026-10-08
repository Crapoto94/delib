-- 0089 — bibliothèque de visas : délibérations de l'historique (AIRS) qui citent chaque texte (référencement, lecture seule).
CREATE TABLE visa_historique_delibs (
  id           bigserial PRIMARY KEY,
  visa_id      bigint NOT NULL REFERENCES visa_library(id) ON DELETE CASCADE,
  organisme_id bigint NOT NULL,
  fichier      text NOT NULL,          -- nom du PDF archivé (d<horodatage>.pdf)
  date_delib   date,                   -- date d'archivage déduite du nom du fichier
  objet        text                    -- « OBJET : … » de la délibération
);
CREATE INDEX visa_historique_delibs_visa ON visa_historique_delibs (visa_id, date_delib DESC);
