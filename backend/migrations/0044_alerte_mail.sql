-- 0044 — alerte de recherche aussi par e-mail (REC-29, D107) : facultatif, désactivé par défaut.
ALTER TABLE search_saved ADD COLUMN alerte_mail boolean NOT NULL DEFAULT false;
