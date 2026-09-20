-- 0038 — clés d'API pour les applications externes (EXT-01 à EXT-06, D97). Seule l'empreinte du secret est conservée ; la clé n'est montrée qu'à la création.
CREATE TABLE api_keys (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id    integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  nom             text NOT NULL,                              -- application cliente (« Site de la Ville »)
  prefixe         text NOT NULL UNIQUE CHECK (prefixe ~ '^[0-9a-f]{8}$'),
  secret_hash     text NOT NULL,                              -- SHA-256 du secret ; jamais le secret
  portees         jsonb NOT NULL DEFAULT '[]'::jsonb,         -- actes:executoires | actes:adoptes | actes:encours
  ips             jsonb NOT NULL DEFAULT '[]'::jsonb,         -- adresses IP ou réseaux (a.b.c.d/nn) autorisés ; vide : toutes
  limite_minute   integer NOT NULL DEFAULT 120 CHECK (limite_minute BETWEEN 1 AND 6000),
  expire_le       timestamptz,
  actif           boolean NOT NULL DEFAULT true,
  revoquee_le     timestamptz,
  revoquee_par    text,
  remplace_id     integer REFERENCES api_keys(id) ON DELETE SET NULL,
  dernier_usage   timestamptz,
  nb_appels       bigint NOT NULL DEFAULT 0,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_org_idx ON api_keys (organisme_id, created_at DESC);
