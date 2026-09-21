-- 0055 — Journal de l'aide IA de Del-IA (assistant de rédaction).
--
-- Chaque question posée à Del-IA est tracée avec la réponse apportée, puis, à la fin, la note
-- (1 à 4 étoiles) et le commentaire éventuel de l'utilisateur. L'administration consulte ce journal
-- et la moyenne des notes (indicateur de qualité des réponses).
CREATE TABLE IF NOT EXISTS aide_ia_journal (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  username     text NOT NULL,
  question     text NOT NULL,
  reponse      text NOT NULL,
  contexte     jsonb NOT NULL DEFAULT '{}'::jsonb,
  modele       text,
  note         smallint CHECK (note IS NULL OR (note >= 1 AND note <= 4)),
  commentaire  text,
  notee_at     timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aide_ia_journal_org_idx ON aide_ia_journal (organisme_id, created_at DESC);
