-- 0068 — Directions « en info » (copie) sur un acte.
--
-- Une ou plusieurs directions peuvent être associées à un dossier pour information. Leur directeur est notifié
-- quand le projet arrive au SCC ; leur DGA est notifié quand la délibération arrive à l'étape DGA.
-- Format : tableau JSON d'objets `{ code, label }` (label figé à l'association pour l'affichage).

ALTER TABLE actes ADD COLUMN IF NOT EXISTS directions_info jsonb NOT NULL DEFAULT '[]'::jsonb;
