-- 0005 — journal d'audit immuable : ni UPDATE, ni DELETE, ni TRUNCATE (SEC-04).
CREATE TABLE audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  organisme_id  integer,
  actor         text NOT NULL,
  on_behalf_of  text,
  action        text NOT NULL,
  entity        text NOT NULL,
  entity_id     text,
  before        jsonb,
  after         jsonb,
  ip            text
);
CREATE INDEX audit_log_org_at_idx ON audit_log (organisme_id, at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor, at DESC);

CREATE OR REPLACE FUNCTION audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log est immuable (opération % refusée)', TG_OP;
END $$;
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_immutable();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_immutable();
