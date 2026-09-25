-- 0073 — stockage GED : classement par catégorie et métadonnées des fichiers.
--
-- Le stockage applicatif était rangé « <année>/<mois> » (date d'import) avec des noms opaques et sans métadonnées :
-- impossible de retrouver un document dans la GED. On ajoute la catégorie métier du fichier (annexes, convocations,
-- ordres-du-jour, cahiers, parapheur, controle-legalite, gabarits, logos, divers…) et le nom lisible déposé dans la
-- GED. Les valeurs des fichiers déjà déposés sont renseignées par le rattrapage « scripts/reclasser-ged.js »
-- (classement par catégorie, nom lisible et métadonnées, sans re-téléversement).

ALTER TABLE files ADD COLUMN IF NOT EXISTS categorie text;
ALTER TABLE files ADD COLUMN IF NOT EXISTS ged_nom text;
CREATE INDEX IF NOT EXISTS files_categorie_idx ON files (organisme_id, categorie);
