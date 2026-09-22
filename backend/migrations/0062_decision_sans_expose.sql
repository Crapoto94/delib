-- 0062 — Une décision n'a ni exposé des motifs ni visas : juste la décision elle-même.
--
-- Les types d'acte sont semés au démarrage en « ON CONFLICT DO NOTHING » : la ligne « Décision » créée par une version
-- antérieure conserve `expose: 'required'` et ignore la clé `visas`. Cette migration met à jour sa fiche sur les
-- installations existantes (au niveau plateforme, sans écraser une surcharge locale par organisme) : exposé et visas
-- deviennent 'none', seuls le dispositif (la décision) reste à rédiger.

UPDATE ref_items
SET meta = COALESCE(meta, '{}'::jsonb) || '{"expose":"none","visas":"none"}'::jsonb
WHERE kind = 'type_acte' AND code = 'decision' AND organisme_id IS NULL;
