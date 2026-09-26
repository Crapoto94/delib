-- 0074 — fichier converti : moteur de conversion.
--
-- Un PDF d'annexe entre dans le dossier remis au conseil, le cahier de séance et la télétransmission. On note donc
-- quel moteur l'a produit (conteneur du serveur de documents, Microsoft Office, LibreOffice) : le rendu dépend du moteur,
-- la question « ce PDF vient d'où ? » doit avoir une réponse dans la base, au même titre que le SHA-256.
-- `NULL` pour un fichier déposé tel quel (original, PDF déjà en PDF, gabarit) : ce n'est pas une conversion.

ALTER TABLE files ADD COLUMN IF NOT EXISTS moteur text;
