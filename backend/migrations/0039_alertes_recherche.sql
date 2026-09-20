-- 0039 — alertes de recherche (REC-29, D98) : « me prévenir quand un nouvel acte correspond ».
ALTER TABLE search_saved ADD COLUMN alerte boolean NOT NULL DEFAULT false;
ALTER TABLE search_saved ADD COLUMN vus jsonb NOT NULL DEFAULT '[]'::jsonb;      -- identifiants d'actes déjà signalés (ou présents à l'activation)
ALTER TABLE search_saved ADD COLUMN derniere_verif timestamptz;
CREATE INDEX search_saved_alerte_idx ON search_saved (organisme_id) WHERE alerte;
