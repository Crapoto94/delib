-- 0042 — l'ARActe (fichier XML de la préfecture) est conservé, consultable et déposé en GED (TLT-35, D104).
ALTER TABLE tlt_transactions ADD COLUMN ar_file_id integer REFERENCES files(id);
