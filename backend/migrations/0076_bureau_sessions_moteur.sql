-- 0076 — bureau en ligne : moteur d'ouverture d'une session.
--
-- Plusieurs moteurs peuvent être déployés côte à côte (ONLYOFFICE Docs, Collabora Online) et l'administrateur choisit
-- lequel ouvre les documents, organisme par organisme. Cette colonne note le moteur qui a ouvert la session : c'est ce
-- qui autorise un hôte WOPI (Collabora) à servir puis réécrire un document. Un rappel venu d'un autre moteur, ou une
-- clé devinée, ne trouve ainsi aucune session Collabora à traiter.
--
-- Les lignes antérieures conservent 'onlyoffice' : c'est le seul moteur qui ait jamais ouvert de session jusqu'ici.

ALTER TABLE bureau_sessions
  ADD COLUMN IF NOT EXISTS moteur text NOT NULL DEFAULT 'onlyoffice';
