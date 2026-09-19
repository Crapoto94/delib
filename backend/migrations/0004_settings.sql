-- 0004 — paramètres hiérarchiques : plateforme -> organisme -> instance -> type d'acte (MOR-10, MOR-11).
-- scope_id : '' (plateforme) ; '<organisme>' ; '<organisme>:<instance>' ; '<organisme>:<type_acte>'.
-- Le préfixe organisme est imposé par le serveur : un paramètre ne peut jamais relever de deux organismes.
CREATE TABLE settings (
  scope       text NOT NULL CHECK (scope IN ('platform', 'organisme', 'instance', 'type_acte')),
  scope_id    text NOT NULL DEFAULT '',
  key         text NOT NULL CHECK (key ~ '^[a-z0-9_.]{1,100}$'),
  value       jsonb NOT NULL,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, scope_id, key),
  CHECK ((scope = 'platform' AND scope_id = '')
      OR (scope = 'organisme' AND scope_id ~ '^[0-9]+$')
      OR (scope IN ('instance', 'type_acte') AND scope_id ~ '^[0-9]+:[0-9]+$'))
);
