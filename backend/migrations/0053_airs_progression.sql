-- 0053 — Import AIRS DELIB : suivi de progression du chargement et de l'analyse.
--
-- L'analyse d'un historique peut durer (plusieurs milliers d'actes). On expose une progression
-- lisible (phase, entités traitées, total) que l'écran interroge pendant le travail, sans le bloquer.
ALTER TABLE airs_imports ADD COLUMN IF NOT EXISTS progression jsonb NOT NULL DEFAULT '{}'::jsonb;
