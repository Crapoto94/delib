-- 0033 — synchronisation avec la GED (GED-08, D93) : un document déposé qui n'existe plus dans la GED est marqué « manquant » et sera redéposé.
ALTER TABLE ged_documents DROP CONSTRAINT IF EXISTS ged_documents_statut_check;
ALTER TABLE ged_documents ADD CONSTRAINT ged_documents_statut_check CHECK (statut IN ('ok', 'erreur', 'manquant'));
