-- 0048 — connexion de développement de l'espace des élus (mot de passe commun DEV_LOGIN_PASSWORD, jamais en production).
ALTER TABLE elu_sessions DROP CONSTRAINT IF EXISTS elu_sessions_via_check;
ALTER TABLE elu_sessions ADD CONSTRAINT elu_sessions_via_check CHECK (via IN ('mot_de_passe', 'sms', 'dev'));
