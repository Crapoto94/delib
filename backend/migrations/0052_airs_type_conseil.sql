-- 0052 — Import AIRS DELIB : « Ordinaire / Extra-ordinaire » est un type de conseil (séance), pas un type d'acte.
--
-- Avant correction, l'analyse créait une concordance d'axe `type_acte` à partir du champ `type` d'une séance.
-- On reclasse ces lignes vers l'axe `type_seance` et on pré-résout la cible (les valeurs AIRS sont déterministes).
-- Les concordances déjà émises par le nouveau code (axe `type_seance`) et les décisions des autres valeurs ne sont pas touchées.
UPDATE airs_concordances c
SET axe = 'type_seance',
    cible_type = 'seance_types',
    cible_code = CASE WHEN upper(c.source_code) LIKE '%EXTRA%' THEN 'extraordinaire'
                      WHEN upper(c.source_code) LIKE '%BUDGET%' THEN 'budgetaire'
                      ELSE 'ordinaire' END,
    cible_libelle = CASE WHEN upper(c.source_code) LIKE '%EXTRA%' THEN 'Extraordinaire'
                         WHEN upper(c.source_code) LIKE '%BUDGET%' THEN 'Budgétaire'
                         ELSE 'Ordinaire' END,
    etat = 'automatique',
    confiance = 0.99
WHERE c.axe = 'type_acte'
  AND c.source_colonne = 'type'
  AND upper(trim(c.source_code)) IN ('ORDINAIRE', 'EXTRA-ORDINAIRE', 'EXTRAORDINAIRE', 'BUDGETAIRE', 'BUDGÉTAIRE')
  AND NOT EXISTS (
    SELECT 1 FROM airs_concordances d
    WHERE COALESCE(d.import_id, 0) = COALESCE(c.import_id, 0)
      AND d.axe = 'type_seance' AND d.source_table = c.source_table
      AND d.source_colonne = c.source_colonne AND d.source_code = c.source_code);
