-- 0090 — backlog : bugs signalés et évolutions demandées par les utilisateurs ; le SCC ou l'administrateur les accepte, les refuse (avec motif) ou les déclare réalisées.
CREATE TABLE backlog_demandes (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id     integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  type             text NOT NULL CHECK (type IN ('bug', 'evolution')),
  titre            text NOT NULL CHECK (length(titre) BETWEEN 3 AND 200),
  description      text NOT NULL CHECK (length(description) BETWEEN 3 AND 5000),
  version_app      text,                                   -- version de l'application au moment de la demande
  demandeur        text NOT NULL,
  demandeur_nom    text,
  demandeur_email  text,                                   -- conservé pour répondre même si l'annuaire change
  statut           text NOT NULL DEFAULT 'demandee' CHECK (statut IN ('demandee', 'acceptee', 'refusee', 'realisee')),
  motif            text,                                   -- obligatoire pour un refus
  traite_par       text,
  traite_le        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX backlog_demandes_org_idx ON backlog_demandes (organisme_id, statut, created_at DESC);
CREATE TRIGGER backlog_demandes_touch BEFORE UPDATE ON backlog_demandes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
