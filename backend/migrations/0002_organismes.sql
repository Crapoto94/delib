-- 0002 — organismes (Ville, CCAS…) et rattachement direction -> organisme (MOR-01, MOR-05).
CREATE TABLE organismes (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_-]{2,40}$'),
  nom          text NOT NULL,
  type         text NOT NULL DEFAULT 'commune' CHECK (type IN ('commune', 'ccas', 'autre')),
  siren        text CHECK (siren IS NULL OR siren ~ '^[0-9]{9}$'),
  adresse      text,
  logo_path    text,
  couleurs     jsonb NOT NULL DEFAULT '{}'::jsonb,
  vocabulaire  jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default   boolean NOT NULL DEFAULT false,
  actif        boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
-- un seul organisme par défaut : celui des agents dont la direction n'est rattachée à aucun autre
CREATE UNIQUE INDEX organismes_un_seul_defaut ON organismes (is_default) WHERE is_default;
CREATE TRIGGER organismes_touch BEFORE UPDATE ON organismes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- une direction appartient à un seul organisme (UNIQUE sur direction_code)
CREATE TABLE organisme_directions (
  organisme_id     integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  direction_code   text NOT NULL UNIQUE,
  direction_label  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisme_id, direction_code)
);
