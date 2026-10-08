-- 0088 — bibliothèque de visas : description et emploi de chaque texte, usage constaté dans l'historique, vérification de cohérence par l'IA.
ALTER TABLE visa_library
  ADD COLUMN description    text,                                   -- ce qu'est ce texte (rédigé par l'IA ou un agent ; à relire)
  ADD COLUMN emploi         text,                                   -- dans quels cas le viser
  ADD COLUMN description_par text CHECK (description_par IN ('ia', 'manuel', 'historique')),
  ADD COLUMN citations      integer NOT NULL DEFAULT 0,             -- délibérations de l'historique qui le citent
  ADD COLUMN cite_de        smallint,                               -- première et dernière année de citation
  ADD COLUMN cite_a         smallint,
  ADD COLUMN usage_stats    jsonb NOT NULL DEFAULT '{}'::jsonb,     -- { total, rubriques: [{ libelle, n }], formulation } : usage constaté (jamais réécrit par l'IA)
  ADD COLUMN ia_etat        text CHECK (ia_etat IN ('coherent', 'a_revoir')),   -- « bonbon » : verdict de la vérification de cohérence par l'IA
  ADD COLUMN ia_avis        text,
  ADD COLUMN ia_le          timestamptz,
  ADD COLUMN ia_modele      text;
