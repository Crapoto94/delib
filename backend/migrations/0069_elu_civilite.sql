-- 0069 — Civilité des élus (M. / Mme), fournie par le Hub DSI.
--
-- Le sexe de l'élu n'est plus déduit du prénom : il est repris tel quel du Hub DSI (champ « civilité ») et conservé
-- localement. Sert notamment à l'écriture inclusive des fonctions (Adjointe, conseillère municipale…).
-- Valeurs observées : « M. », « Mme » (à défaut « F »/« M »).

ALTER TABLE elus ADD COLUMN IF NOT EXISTS civilite text;
