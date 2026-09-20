-- 0043 — date d'affichage (publication) saisie par le SCC après l'AR : mention « PUBLIÉ PAR VOIE D'AFFICHAGE LE » de l'extrait du registre (TLT-34).
ALTER TABLE tlt_transactions ADD COLUMN date_affichage date;
