-- 0085 — périmètre d'une clé d'API publique : types d'actes, durée (2 ans au plus) et contenus exposés.
ALTER TABLE api_keys
  ADD COLUMN types jsonb NOT NULL DEFAULT '[]'::jsonb,                 -- codes des types d'actes visibles ; vide : tous
  ADD COLUMN duree_mois integer NOT NULL DEFAULT 24 CHECK (duree_mois BETWEEN 1 AND 24),  -- fenêtre glissante (date de séance, à défaut de création)
  ADD COLUMN contenus jsonb NOT NULL DEFAULT '{"acte": true, "expose": true, "annexes": true}'::jsonb;  -- ce qui peut être téléchargé
