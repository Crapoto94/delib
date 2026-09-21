-- 0060 — Organisation : surcharges locales de l'organigramme (directions/services ajoutés à la main).
--
-- L'organigramme vient du Hub DSI (RH) ; on peut le COMPLÉTER ou le CORRIGER localement (une direction ou un service
-- absent du Hub, un libellé à ajuster) sans le modifier à la source. Ces entités locales sont fusionnées avec
-- l'organigramme du Hub partout où les directions/services sont utilisées (actes, circuits, titulaires…).
CREATE TABLE IF NOT EXISTS organisation_entites (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('direction', 'service')),
  code         text NOT NULL,
  label        text NOT NULL,
  parent_code  text,                                   -- direction de rattachement (pour un service)
  ordre        integer NOT NULL DEFAULT 0,
  actif        boolean NOT NULL DEFAULT true,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisme_id, type, code)
);
CREATE INDEX IF NOT EXISTS organisation_entites_idx ON organisation_entites (organisme_id, type);
