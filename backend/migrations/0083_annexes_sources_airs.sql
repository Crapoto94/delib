-- Les sources AIRS « Délibération / Exposé des motifs (document d'origine AIRS) » ne sont PAS des annexes :
-- elles alimentent les textes de l'acte (elles sont déjà reprises dans le PDF de la délibération).
-- L'import les rattachait à tort, car `tfp` arrive en chaîne (« 4 » / « 5 ») et la comparaison stricte échouait.
-- On supprime ces rattachements erronés ; les fichiers eux-mêmes sont conservés (aucune donnée perdue).
DELETE FROM annexes
WHERE titre IN ('Délibération (document d''origine AIRS)', 'Exposé des motifs (document d''origine AIRS)');
