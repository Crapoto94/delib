-- 0014 — thématiques et nombre de sièges des commissions (délibération de création : « La Ville qui débat » 13 sièges dont 3 d'opposition…).
ALTER TABLE commissions
  ADD COLUMN thematiques        jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN sieges             integer CHECK (sieges IS NULL OR sieges > 0),
  ADD COLUMN sieges_opposition  integer CHECK (sieges_opposition IS NULL OR sieges_opposition >= 0);
