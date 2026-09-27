-- 0079 — Espace élus : préférences personnelles (téléphone en libre-service, notifications par mail).
--
-- `elus.telephone` existe déjà (synchronisé depuis le Hub DSI, utilisé pour le code SMS de récupération de mot
-- de passe) mais un élu ne peut pas le corriger lui-même s'il est faux ou absent. `preferences` (JSONB, libre)
-- porte les réglages de notification et les futurs réglages personnels sans migration à chaque ajout ; le
-- premier réglage est `notifMail.parapheurRetour` (recevoir un mail au retour de signature du parapheur).
ALTER TABLE elu_comptes ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
