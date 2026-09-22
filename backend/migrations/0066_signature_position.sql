-- 0066 — Emplacement de la signature du maire, défini AVANT l'envoi au parapheur.
--
-- On reprend le mécanisme du Hub DSI (DSIHUB) : la position est un cadre sur une page du document, décrit par
--   page : numéro de page (1 = première) ;
--   x    : centre horizontal, en pourcentage de la largeur (depuis la gauche) ;
--   y    : centre vertical, en pourcentage de la hauteur (depuis le haut) ;
--   w/h  : largeur et hauteur du cadre, en points PDF.
-- Le parapheur reçoit ces valeurs telles quelles dans `signataires[].positions`.

ALTER TABLE actes ADD COLUMN IF NOT EXISTS signature_position jsonb;
