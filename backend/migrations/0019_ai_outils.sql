-- 0019 — outils IA de l'éditeur (IA-10 à IA-36, IA-60 à IA-62) : catégorie, gravité et origine des suggestions.
ALTER TABLE ai_suggestions ADD COLUMN categorie text;   -- orthographe | typographie | style | visa | coherence | completude | copie
ALTER TABLE ai_suggestions ADD COLUMN gravite   text CHECK (gravite IN ('bloquant', 'a_revoir', 'info'));
ALTER TABLE ai_suggestions ADD COLUMN fonction  text;   -- orthographe | style | visas | complet | copie (fonction demandée)
UPDATE ai_suggestions SET categorie = 'copie', fonction = 'copie' WHERE categorie IS NULL;
CREATE INDEX ai_suggestions_text_idx ON ai_suggestions (text_id, status);
