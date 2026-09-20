-- 0032 — amendements en séance (VOT-06, D92) : déposés sur un point, votés AVANT le texte ; adopté = le texte de la délibération est modifié (avec suivi).
CREATE TABLE seance_amendements (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id      integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  seance_id         integer NOT NULL REFERENCES seances(id) ON DELETE CASCADE,
  item_id           integer NOT NULL REFERENCES seance_items(id) ON DELETE CASCADE,
  numero            integer NOT NULL,                                   -- 1, 2… dans le point
  auteur_elu_id     integer REFERENCES elus(id) ON DELETE SET NULL,
  auteur_groupe_id  integer REFERENCES groupes_politiques(id) ON DELETE SET NULL,
  auteur_libelle    text NOT NULL,                                      -- « Paul DURIF », « Groupe Majorité »… figé au dépôt
  cible             text NOT NULL CHECK (cible IN ('expose', 'visas', 'dispositif')),
  deliberation_id   integer REFERENCES deliberations(id) ON DELETE SET NULL,
  texte_propose     text NOT NULL,                                      -- texte complet de la partie visée, tel qu'il serait après amendement
  motif             text NOT NULL DEFAULT '',
  statut            text NOT NULL DEFAULT 'depose' CHECK (statut IN ('depose', 'adopte', 'rejete', 'retire')),
  scrutin           text NOT NULL DEFAULT 'main_levee' CHECK (scrutin IN ('main_levee', 'public', 'secret', 'unanimite')),
  resultat          text CHECK (resultat IN ('adopte_unanimite', 'adopte_majorite', 'adopte_preponderante', 'rejete_preponderante', 'rejete')),
  pour integer, contre integer, abstention integer, nppv integer, absents integer, votants integer,
  texte_avant       text,                                               -- texte de la partie visée juste avant l'application (comparaison, traçabilité)
  version_apres     integer,                                            -- version du texte suivi produite par l'amendement adopté
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  close_at          timestamptz,
  close_par         text,
  UNIQUE (item_id, numero)
);
CREATE INDEX seance_amendements_seance_idx ON seance_amendements (seance_id);

CREATE TABLE seance_amendement_votes (
  amendement_id      integer NOT NULL REFERENCES seance_amendements(id) ON DELETE CASCADE,
  elu_id             integer NOT NULL REFERENCES elus(id) ON DELETE CASCADE,
  choix              text NOT NULL CHECK (choix IN ('pour', 'contre', 'abstention', 'nppv', 'absent')),
  mandataire_elu_id  integer REFERENCES elus(id) ON DELETE SET NULL,
  at                 timestamptz NOT NULL DEFAULT now(),
  saisi_par          text NOT NULL,
  PRIMARY KEY (amendement_id, elu_id)
);
