-- 0077 — parapheur : qui a réellement signé, quand ce n'est pas le signataire désigné.
--
-- Le parapheur du Hub gère la délégation de date à date : un agent (ou un adjoint) désigné peut signer « par
-- délégation de » l'élu attendu, et le PDF signé porte alors la mention « Signé X par délégation de Y ». On conserve
-- le nom du délégué pour que le dossier VibeDélib le dise aussi, au lieu de laisser croire que le signataire
-- désigné a signé lui-même.
ALTER TABLE parapheur_envois ADD COLUMN IF NOT EXISTS signe_par_nom text;
