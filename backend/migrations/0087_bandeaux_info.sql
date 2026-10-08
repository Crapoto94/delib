-- 0087 — bandeau d'information : message défilant, rouge, affiché à tous les utilisateurs entre deux dates (défini par le SCC ou l'administrateur).
CREATE TABLE bandeaux_info (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  message       text NOT NULL CHECK (length(message) BETWEEN 3 AND 500),
  debut         timestamptz NOT NULL,
  fin           timestamptz NOT NULL,
  actif         boolean NOT NULL DEFAULT true,           -- interrupteur : un message désactivé n'est jamais affiché, même dans sa période
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (fin > debut)
);
CREATE INDEX bandeaux_info_org_idx ON bandeaux_info (organisme_id, debut, fin);
CREATE TRIGGER bandeaux_info_touch BEFORE UPDATE ON bandeaux_info FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
