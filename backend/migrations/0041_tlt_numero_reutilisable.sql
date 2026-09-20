-- 0041 — le numéro transmis d'une transmission annulée AVANT tout envoi (jamais posté à S²LOW) peut être réutilisé :
-- on annule pour refaire la préparation (texte corrigé, TLT-32) et on garde le même numéro.
ALTER TABLE tlt_transactions DROP CONSTRAINT IF EXISTS tlt_transactions_organisme_id_numero_transmis_key;
CREATE UNIQUE INDEX tlt_transactions_numero_uq ON tlt_transactions (organisme_id, numero_transmis) WHERE NOT (etat = 'annule' AND remote_id IS NULL);
