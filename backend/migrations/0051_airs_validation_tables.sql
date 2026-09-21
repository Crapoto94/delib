-- 0051 — Import AIRS DELIB : validation obligatoire de chaque table source avant import.
--
-- Toute table source doit être relue par l'administrateur (aperçu des données + transposition des
-- colonnes vers les champs canoniques) puis explicitement validée. L'import ne reprend que les tables
-- validées. Cette validation est propre à l'organisme et n'écrit jamais dans le paramétrage applicatif
-- (référentiels, organisation, instances, élus…) : elle ne touche que le sas `airs_*`.
ALTER TABLE airs_source_tables ADD COLUMN IF NOT EXISTS valide boolean NOT NULL DEFAULT false;
ALTER TABLE airs_source_tables ADD COLUMN IF NOT EXISTS valide_par text;
ALTER TABLE airs_source_tables ADD COLUMN IF NOT EXISTS valide_at timestamptz;
ALTER TABLE airs_source_tables ADD COLUMN IF NOT EXISTS apercu_at timestamptz;
