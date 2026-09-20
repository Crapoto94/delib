-- 0031 — champs personnalisés (PAR-10, D91) : définitions par organisme ; les valeurs restent dans actes.custom (jsonb).
CREATE TABLE champs_personnalises (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id   integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  code           text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  libelle        text NOT NULL,
  aide           text,
  kind           text NOT NULL CHECK (kind IN ('texte', 'nombre', 'date', 'liste', 'booleen', 'elu', 'agent')),
  options        jsonb NOT NULL DEFAULT '[]'::jsonb,        -- liste : [{ "valeur": "a", "libelle": "A" }]
  obligatoire    boolean NOT NULL DEFAULT false,
  type_acte_id   integer REFERENCES ref_items(id) ON DELETE CASCADE,   -- NULL : tous les types d'actes
  visible_si     jsonb,                                     -- { "champ": "code", "egal": valeur } ; NULL : toujours visible
  roles_saisie   jsonb NOT NULL DEFAULT '[]'::jsonb,        -- vide : tout éditeur de l'acte ; sinon rôles (org_admin, scc, redacteur…)
  etapes_saisie  jsonb NOT NULL DEFAULT '[]'::jsonb,        -- vide : toutes ; sinon clés d'étapes du circuit ("brouillon" = avant l'envoi)
  ordre          integer NOT NULL DEFAULT 0,
  actif          boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisme_id, code)
);
CREATE TRIGGER champs_personnalises_touch BEFORE UPDATE ON champs_personnalises FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
