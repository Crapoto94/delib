-- 0035 — Alfresco comme stockage des fichiers (GED-09, D95) : au choix de l'organisme, les fichiers vont dans la GED plutôt que sur le volume local.
ALTER TABLE ged_config ADD COLUMN stockage text NOT NULL DEFAULT 'local' CHECK (stockage IN ('local', 'alfresco'));
