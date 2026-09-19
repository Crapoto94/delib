-- 0011 — notifications, relances, calendrier (section 22).

-- jours fériés / fermetures : organisme_id NULL = commun à tous (NOT-25)
CREATE TABLE holidays (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id integer REFERENCES organismes(id) ON DELETE CASCADE,
  day          date NOT NULL,
  label        text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX holidays_uniq ON holidays (COALESCE(organisme_id, 0), day);

-- règles : organisme_id NULL = jeu fourni par la plateforme (hérité), une ligne d'organisme de même code la remplace
CREATE TABLE notification_rules (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id integer REFERENCES organismes(id) ON DELETE CASCADE,
  code         text NOT NULL CHECK (code ~ '^[a-z0-9_.-]{2,60}$'),
  nom          text NOT NULL,
  family       text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('event', 'temporal')),
  trigger      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { event } | { type, ... }
  condition    jsonb,                                  -- même grammaire que les transitions de circuit
  recipients   jsonb NOT NULL DEFAULT '[]'::jsonb,    -- résolveurs : redacteur, valideurs, circuit, chef_service, directeur, scc, dgs, admins, agent:<login>…
  channels     jsonb NOT NULL DEFAULT '["inapp","mail"]'::jsonb,
  palliers     jsonb NOT NULL DEFAULT '[]'::jsonb,    -- règles temporelles : [{ at:{ days, of }, recipients }]
  subject      text NOT NULL,
  body         text NOT NULL,
  mandatory    boolean NOT NULL DEFAULT false,
  enabled      boolean NOT NULL DEFAULT true,
  updated_by   text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX notification_rules_uniq ON notification_rules (COALESCE(organisme_id, 0), code);

-- centre de notifications dans l'outil (NOT-14)
CREATE TABLE notifications (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  username     text NOT NULL,
  family       text NOT NULL,
  rule_code    text,
  acte_id      integer REFERENCES actes(id) ON DELETE CASCADE,
  title        text NOT NULL,
  body         text NOT NULL DEFAULT '',
  link         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz
);
CREATE INDEX notifications_user_idx ON notifications (organisme_id, username, read_at, created_at DESC);

-- file d'envoi et journal (NOT-20 à NOT-22) : une ligne par (destinataire, canal, message)
CREATE TABLE notification_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id    integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  dedupe_key      text,
  rule_code       text,
  family          text,
  acte_id         integer REFERENCES actes(id) ON DELETE SET NULL,
  recipient       text NOT NULL,
  email           text,
  channel         text NOT NULL DEFAULT 'mail',
  subject         text NOT NULL,
  body            text NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped', 'digest')),
  skip_reason     text,
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- idempotence : jamais deux fois la même relance (règle, acte, échéance, destinataire, palier)
CREATE UNIQUE INDEX notification_log_dedupe ON notification_log (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX notification_log_due_idx ON notification_log (status, next_attempt_at);
CREATE INDEX notification_log_acte_idx ON notification_log (acte_id);

-- préférences par utilisateur et par famille (NOT-11)
CREATE TABLE notification_prefs (
  organisme_id integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  username     text NOT NULL,
  family       text NOT NULL,
  mode         text NOT NULL CHECK (mode IN ('immediate', 'digest', 'off')),
  PRIMARY KEY (organisme_id, username, family)
);

-- mise en sourdine (utilisateur) ou suspension (SCC / directeur) des notifications d'un acte (NOT-11, NOT-13)
CREATE TABLE notification_mutes (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  acte_id    integer NOT NULL REFERENCES actes(id) ON DELETE CASCADE,
  username   text,                       -- NULL = suspension pour tout le monde
  until      timestamptz NOT NULL,
  reason     text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_mutes_acte_idx ON notification_mutes (acte_id);

-- exécutions de synthèses : une par (utilisateur, jour)
CREATE TABLE scheduler_runs (
  key        text PRIMARY KEY,
  ran_at     timestamptz NOT NULL DEFAULT now()
);
