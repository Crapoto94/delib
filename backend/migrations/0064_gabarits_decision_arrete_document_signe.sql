-- 0064 — Gabarits des décisions / arrêtés et conservation du document signé revenu du parapheur.
--
-- 1) La migration 0061 a introduit les types d'acte « decision » et « arrete », et le service de rendu a ajouté leurs
--    gabarits (LOT « Décisions et arrêtés »). La contrainte posée en 0009 sur render_templates.doc_type n'a pas suivi :
--    déposer un modèle Word (ou un fond) sur le gabarit « decision » / « arrete » échouait (« violates check constraint
--    render_templates_doc_type_check »). On l'élargit aux deux nouveaux types.
--
-- 2) Une décision / un arrêté signé(e) ne se modifie plus : ce qui fait foi est le PDF signé renvoyé par le parapheur.
--    On conserve ce document (fichier) et on le rattache à l'envoi, pour le proposer en consultation depuis la fiche.

ALTER TABLE render_templates DROP CONSTRAINT IF EXISTS render_templates_doc_type_check;
ALTER TABLE render_templates ADD CONSTRAINT render_templates_doc_type_check CHECK (doc_type IN (
  'expose', 'deliberation', 'decision', 'arrete', 'dossier', 'garde', 'intercalaire', 'sommaire', 'odj', 'convocation', 'registre'));

ALTER TABLE parapheur_envois ADD COLUMN IF NOT EXISTS document_signe_file_id integer REFERENCES files(id) ON DELETE SET NULL;
