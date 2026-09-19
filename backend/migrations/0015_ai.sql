-- 0015 — assistant IA : exécutions et suggestions (section 21, D21, D40). L'IA propose, l'agent décide.
CREATE TABLE ai_runs (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  acte_id       integer REFERENCES actes(id) ON DELETE CASCADE,
  kind          text NOT NULL,                 -- 'copie'
  requested_by  text NOT NULL,
  model         text,
  status        text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error')),
  context       text,
  prompt_chars  integer NOT NULL DEFAULT 0,
  response_chars integer NOT NULL DEFAULT 0,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_suggestions (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id  integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  acte_id       integer NOT NULL REFERENCES actes(id) ON DELETE CASCADE,
  text_id       integer REFERENCES tracked_texts(id) ON DELETE CASCADE,
  run_id        integer REFERENCES ai_runs(id) ON DELETE SET NULL,
  kind          text NOT NULL CHECK (kind IN ('remplacement', 'alerte')),
  find          text,                          -- passage EXACT du texte à remplacer
  replacement   text,
  reason        text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'edited', 'rejected', 'obsolete')),
  decided_by    text,
  decided_at    timestamptz,
  applied_version integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_suggestions_acte_idx ON ai_suggestions (acte_id, status);
