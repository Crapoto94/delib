-- 0025 — choix de chaque utilisateur pour une notification FACULTATIVE (règle par règle, en plus du choix par famille).
--   immediate : comportement normal (canaux de la règle) ; inapp : dans l'outil seulement, pas de mail ; off : ne pas la recevoir.
CREATE TABLE notification_rule_prefs (
  organisme_id integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  username     text NOT NULL,
  rule_code    text NOT NULL,
  mode         text NOT NULL CHECK (mode IN ('inapp', 'off')),
  PRIMARY KEY (organisme_id, username, rule_code)
);
