-- 0034 — gestion des élus, désactivation persistante, mot de passe oublié par SMS (ELU-80 à ELU-85, D94).

-- désactivation faite à la main : la synchronisation avec le Hub ne réactive jamais cet élu
ALTER TABLE elus ADD COLUMN desactive_manuellement boolean NOT NULL DEFAULT false;
-- mobile saisi localement : jamais écrasé par la synchronisation ; l'effectif est mobile_local, à défaut telephone (Hub)
ALTER TABLE elus ADD COLUMN mobile_local text;

-- le défi de connexion sait par quel canal le code est parti (mail : 10 minutes ; sms : 5 minutes)
ALTER TABLE elu_codes ADD COLUMN canal text NOT NULL DEFAULT 'mail' CHECK (canal IN ('mail', 'sms'));
ALTER TABLE elu_sessions ADD COLUMN via text NOT NULL DEFAULT 'mot_de_passe' CHECK (via IN ('mot_de_passe', 'sms'));

-- journal des oublis de mot de passe (ELU-84) : aucun code n'y figure
CREATE TABLE elu_oublis (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id  integer REFERENCES organismes(id) ON DELETE CASCADE,
  elu_id        integer REFERENCES elus(id) ON DELETE SET NULL,
  email         text,                                        -- adresse saisie (même si aucun compte ne correspond)
  evenement     text NOT NULL CHECK (evenement IN ('demande', 'code_envoye', 'code_refuse', 'code_expire', 'code_valide', 'compte_inconnu', 'sans_mobile', 'echec_envoi', 'limite')),
  ip            text,
  detail        text,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX elu_oublis_org_idx ON elu_oublis (organisme_id, at DESC);
CREATE INDEX elu_oublis_email_idx ON elu_oublis (lower(email), at DESC);

-- messages SMS : en simulation, le journal des messages « envoyés » (le texte contient le code, pour les essais) ; en réel, le texte est masqué
CREATE TABLE sms_journal (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id  integer REFERENCES organismes(id) ON DELETE CASCADE,
  mobile_masque text NOT NULL,
  mobile        text,                                        -- renseigné seulement en simulation
  message       text NOT NULL,
  mode          text NOT NULL CHECK (mode IN ('simulation', 'http')),
  statut        text NOT NULL CHECK (statut IN ('simule', 'envoye', 'echec')),
  erreur        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sms_journal_org_idx ON sms_journal (organisme_id, created_at DESC);
