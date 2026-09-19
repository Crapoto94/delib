-- 0007 — Row-Level Security (défense supplémentaire de MOR-02).
-- Les politiques ne s'appliquent qu'à un rôle qui n'est NI propriétaire des tables NI super-utilisateur :
-- en production, l'application doit se connecter avec un rôle dédié (voir LOT0.md §6).
-- L'application renseigne app.organisme_ids (liste d'identifiants) ou app.rls_bypass = 'on' (administrateur de plateforme).
CREATE OR REPLACE FUNCTION current_org_ids() RETURNS integer[] LANGUAGE sql STABLE AS $$
  SELECT string_to_array(NULLIF(current_setting('app.organisme_ids', true), ''), ',')::integer[]
$$;
CREATE OR REPLACE FUNCTION rls_bypass() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.rls_bypass', true), 'off') = 'on'
$$;

ALTER TABLE organisme_directions ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON organisme_directions USING (rls_bypass() OR organisme_id = ANY (current_org_ids()));

ALTER TABLE user_org_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON user_org_roles USING (rls_bypass() OR organisme_id = ANY (current_org_ids()));

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON audit_log USING (rls_bypass() OR organisme_id = ANY (current_org_ids()));
