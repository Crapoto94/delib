-- 0080 — lien de calendrier dynamique (Outlook, Google, Apple…) pour les ÉLUS : même principe que `calendrier_liens`
-- (migration 0045, réservée aux agents), mais keyé par élu (organisme + elu_id) plutôt que par nom d'utilisateur agent,
-- pour que le flux ne reprenne que les séances auxquelles cet élu a accès (conseil + ses commissions, ESP-service).
CREATE TABLE elu_calendrier_liens (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id    integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  elu_id          integer NOT NULL REFERENCES elus(id) ON DELETE CASCADE,
  token_hash      text NOT NULL UNIQUE,
  token_chiffre   text NOT NULL,
  cree_le         timestamptz NOT NULL DEFAULT now(),
  dernier_acces   timestamptz,
  nb_acces        integer NOT NULL DEFAULT 0,
  UNIQUE (organisme_id, elu_id)
);
