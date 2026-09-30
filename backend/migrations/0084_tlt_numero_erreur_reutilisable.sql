-- 0084 — le numéro transmis d'une transmission qui n'a JAMAIS atteint S²LOW peut être réutilisé.
--
-- 0041 ne libérait le numéro que dans le cas « annule » (préparation annulée avant tout envoi).
-- Or une transaction en « erreur » (envoi refusé par S²LOW, donc jamais postée : remote_id NULL)
-- conserve elle aussi le numéro. Comme `preparer()` ne détectait pas ce conflit pour le même acte,
-- toute nouvelle préparation du même acte partait en violation d'unicité → erreur interne 500 au
-- lieu d'un message clair, et l'acte devenait impossible à renvoyer.
--
-- Règle retenue : un numéro est détenu tant que la transaction est vivante (prepare/poste) OU
-- qu'elle a atteint S²LOW (remote_id non nul). Il est libéré si la transaction est morte sans
-- avoir jamais été postée : `annule` (0041) ou `erreur` (le présent correctif).
DROP INDEX IF EXISTS tlt_transactions_numero_uq;
CREATE UNIQUE INDEX tlt_transactions_numero_uq ON tlt_transactions (organisme_id, numero_transmis)
  WHERE NOT (etat IN ('annule', 'erreur') AND remote_id IS NULL);
