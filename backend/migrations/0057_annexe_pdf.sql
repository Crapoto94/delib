-- 0057 — Annexes : une annexe Word peut porter son PDF associé (un seul élément, deux fichiers).
--
-- L'import AIRS rattachait l'original (Word/Excel) ET sa conversion PDF comme deux annexes distinctes.
-- On ajoute `pdf_file_id` pour que la conversion reste UNE seule annexe, avec deux boutons (original + PDF).
-- Les paires déjà créées (« titre » + « titre (PDF) ») sont fusionnées.
ALTER TABLE annexes ADD COLUMN IF NOT EXISTS pdf_file_id integer REFERENCES files(id) ON DELETE SET NULL;

-- Réunit le PDF converti sous l'annexe d'origine.
WITH paires AS (
  SELECT p.id AS pdf_id, o.id AS orig_id, p.file_id AS pdf_file
  FROM annexes p
  JOIN annexes o ON o.acte_id = p.acte_id AND o.id <> p.id
    AND o.titre = left(p.titre, length(p.titre) - 6)
  WHERE p.titre LIKE '% (PDF)'
    AND EXISTS (SELECT 1 FROM files f WHERE f.id = p.file_id AND f.mime = 'application/pdf')
)
UPDATE annexes o SET pdf_file_id = pa.pdf_file
FROM paires pa WHERE o.id = pa.orig_id AND o.pdf_file_id IS NULL;

-- Supprime les annexes « (PDF) » devenues redondantes (leur fichier reste référencé par pdf_file_id).
WITH paires AS (
  SELECT p.id AS pdf_id, o.id AS orig_id
  FROM annexes p
  JOIN annexes o ON o.acte_id = p.acte_id AND o.id <> p.id
    AND o.titre = left(p.titre, length(p.titre) - 6)
  WHERE p.titre LIKE '% (PDF)'
    AND EXISTS (SELECT 1 FROM files f WHERE f.id = p.file_id AND f.mime = 'application/pdf')
)
DELETE FROM annexes p USING paires pa WHERE p.id = pa.pdf_id;
