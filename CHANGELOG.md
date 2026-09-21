# Journal des versions — VibeDélib (What's New)

> Convention avant la mise en production : l'application est en **0.x.y**.
> - **x** (version mineure) : ajout d'un module ou d'une fonctionnalité.
> - **y** (correctif) : correction, débogage ou amélioration sans nouveau module.
> - **1.0.0** : version de production. **Aucune date n'est indiquée avant la 1.0.0** ; elle sera ajoutée le jour de la mise en production.
>
> La version affichée par l'application est celle de `frontend/package.json` et `backend/package.json`. Le présent fichier et `frontend/src/nouveautes.ts` sont tenus en phase.
>
> **Pour incrémenter** : ajouter un module ou une fonctionnalité → +1 sur x, y remis à 0 ; correction ou amélioration sans nouveau module → +1 sur y. Mettre à jour les deux `package.json`, ce fichier et `nouveautes.ts`.

## 0.39.0 — Import AIRS DELIB : sas, concordances et publication

- Nouvel écran **Paramétrages › Import AIRS DELIB** (administrateur d'organisme et SCC) : reprise de l'historique de l'ancien logiciel en trois temps — **sas** (données brutes JSONB, invisibles de l'outil), **concordances** (rapprochement avec les élus, directions, services, agents, commissions, instances et référentiels déjà paramétrés, avec proposition automatique et validation humaine), puis **publication** des actes des séances passées.
- Un **lot de reprise** se crée, se charge (export JSON du HUB DSI ou **jeu d'essai**), s'analyse et se valide ; la publication reste **bloquée** tant que les concordances obligatoires (direction, service) ne sont pas tranchées ou ignorées.
- **Contrôle AD / RH** des agents cités par AIRS qui ne se sont jamais connectés (connu, jamais connecté, absent, ambigu) : **aucun compte n'est créé**.
- Le **mapping des tables AIRS** est déclaratif (MCD inconnu) : il se renseigne en configuration dès réception, sans redéploiement.
- **Publication idempotente et réversible** : séance, acte, textes et résultat de vote créés une seule fois ; un lot peut être retiré ou annulé, jamais supprimé physiquement. Tout est audité (lot, concordance, publication).

## 0.38.1 — Séance visée : inscrit ou pas encore

- La **séance visée** s'affiche désormais en **gras** quand l'acte est **inscrit à l'ordre du jour** de la séance, et en *italique* (« pas encore inscrit ») quand elle n'est que visée — tableau de bord, liste des dossiers, fiche du dossier (SEA-18).

## 0.38.0 — Séances : nouvelle liste, relance des services, lien Outlook ; se souvenir de moi
- Liste des séances refondue d'après la maquette : une carte par séance (compte à rebours, délibérations inscrites, étape du workflow, jalons), onglets à compteurs, année, instances, filtre, vue détaillée ou compacte.
- « Relancer les services » : relance, direction par direction, les détenteurs des dossiers non terminés d'une séance (garde-fou de 24 h).
- « Lien calendrier Outlook » : un abonnement dynamique personnel et secret (séances, lieux, annulations, jalons pour le SCC), sans export de fichier.
- « Se souvenir de moi » : session persistante de 6 mois au plus, jusqu'à la déconnexion.
- Dossiers de mon équipe : la séance visée est affichée.
- Mot de passe oublié des élus : les SMS peuvent partir par l'API de la Ville (APM), en plus d'une passerelle propre.

## 0.37.0 — Alertes de recherche par e-mail
- Alertes de recherche par e-mail (facultatif) : l'enveloppe à côté de la cloche d'une recherche enregistrée envoie aussi le message par mail.

## 0.36.1 — Visite guidée et aide mises à jour
- Visite guidée (version 2) et aide : « Mes actes », « Bibliothèque » et « Vérifier les références » sont expliqués ; la visite est reproposée à ceux qui avaient terminé la précédente.

## 0.36.0 — Listes filtrables, président de séance et date d’affichage
- Toutes les listes déroulantes ont une zone de saisie pour filtrer les choix (dès 7 choix), utilisable au clavier.
- Au conseil, le président de séance est le maire par défaut à l'ouverture du suivi de séance (modifiable).
- Date d'affichage saisie par le SCC après l'AR : elle renseigne la mention « publié par voie d'affichage » de l'extrait du registre.

## 0.35.0 — Contrôle de légalité, workflow de séance, bibliothèque et trajet des actes
- Contrôle de légalité : envoi et confirmation en masse (cases à cocher dans le suivi, « Préparer et envoyer »), sans s'arrêter à la première erreur.
- Contrôle de légalité : le SCC peut modifier le texte d'une délibération avant la transmission ; workflow d'envoi paramétrable (rôles, préparation, envoi et confirmation automatiques).
- AR de la préfecture : tampon sur chaque page, fichier ARActe XML conservé, consultable et déposé en GED ; extrait du registre conforme au modèle de la Ville (garde, présence, délibération).
- Séances : frise du workflow (Rédaction, Préparation, Convocation, Séance, Après la séance, Clôture) en haut des pages de la séance.
- Nouveaux : « Bibliothèque » (délibérations adoptées consultables par tous, avec exposé des motifs et extrait du registre) et « Mes actes » (trajet complet des dossiers où j'ai eu un rôle).
- Règles de notification : « active » et « obligatoire » réglables ; vote de groupe : case pleine si unanimité, remplissage proportionnel sinon, clic sur le nom pour zoomer sur le groupe.

## 0.34.0 — Pré-contrôle juridique et visas habituels
- Pré-contrôle automatique des références à l'entrée du dossier dans l'étape « Service juridique » (sans IA, non bloquant).
- Visas habituels : l'assistant signale un visa présent dans la plupart des délibérations similaires adoptées et absent du dossier.

## 0.33.0 — Références juridiques vérifiées par le code
- Bibliothèque de visas (Paramétrages › Visas et références) : textes normalisés avec statut, validité et dernière vérification ; import JSON/CSV ; fournie vide, maintenue par le juridique.
- « Vérifier les références » dans l'assistant : codes, lois, décrets, arrêtés et délibérations citées sont extraits par règles et vérifiés par le code contre la bibliothèque, à la date de la séance (sans IA).
- Listes de contrôle par type d'acte, matière et montant (visa ou mention attendus) ; ordre conventionnel des visas ; inclus dans le contrôle complet.
- Veille : un texte devenu abrogé ou modifié prévient les rédacteurs des actes en cours qui le citent.

## 0.32.0 — Nouveau design, mode sombre et menu latéral des paramétrages
- Interface plus colorée et plus contrastée (bandeau de navigation bleu, cartes, tableaux et badges renforcés), inspirée des maquettes Stitch.
- Mode sombre : Automatique (suit l'appareil), Clair ou Sombre, depuis le bouton de l'en-tête ou le menu utilisateur ; aussi dans l'espace des élus.
- Paramétrages : menu latéral à gauche, groupé par thèmes, avec fil d'Ariane.

## 0.31.0 — Alertes de recherche et amendements dans l'espace élus
- Cloche « Me prévenir quand un nouvel acte correspond » sur une recherche enregistrée : vérification au plus horaire, avec les droits de la personne, notification dans l'application.
- Amendements consultables dans l'espace élus (ELU-41).

## 0.30.0 — API externe et clés d'accès
- API de lecture seule pour les applications tierces (site de la ville), avec clés hachées à affichage unique, portées distinguant actes exécutoires / adoptés / en cours, IP autorisées et limite de débit.
- Synchronisation incrémentale des actes, notamment une fois revenus du contrôle de légalité.

## 0.29.0 — RGPD : archivage intermédiaire et pseudonymisation
- Menu RGPD : archivage intermédiaire des actes terminés et anciens, avec aperçu avant application (les actes restent conservés).
- Pseudonymisation des actions et journaux : les identités et adresses IP anciennes sont remplacées par des pseudonymes stables, sans réécrire le journal d'audit (immuable).
- Correspondance des pseudonymes conservée à part pour la ré-identification, journal des opérations RGPD, durées de conservation paramétrables.

## 0.28.0 — Documents techniques (DAT & DEX) et mode opératoire
- DAT (document d'architecture technique) et DEX (dossier d'exploitation) dans l'aide administrateur, exportables en PDF.
- Le DAT expose l'architecture, le schéma des flux, les interfaces avec les applications tierces, les variables, le SGBD et le stockage.
- Mode opératoire pour un vibecodeur : précautions, risques et prompts de base ; mention que l'application est vibecodée.

## 0.27.0 — Sauvegarde vers un dossier réseau
- Export logique cohérent et copie SMB avec identifiants chiffrés, planification, rétention et restauration outillée.

## 0.26.0 — Alfresco comme stockage des fichiers
- Stockage des fichiers dans Alfresco (clés `alf:`), avec cache et sonde ; migration dans les deux sens.

## 0.25.0 — Gestion des élus et mot de passe oublié par SMS
- Création, édition, suppression prudente et désactivation persistante des élus.
- Réinitialisation du mot de passe de l'espace élus par SMS.

## 0.24.0 — Centre d'aide
- Trois aides accessibles depuis l'en-tête et affichées selon le profil : rédaction et circuit, séances et commissions (SCC), paramétrages.
- Séparation explicite des paramétrages fonctionnels (SCC) et techniques (administrateur).

## 0.23.0 — Amendements en séance et synchronisation GED
- Dépôt et vote des amendements pendant la séance ; le vote du texte est bloqué tant qu'un amendement est en attente.
- Synchronisation VibeDélib / GED et archivage du cahier dès sa fin.

## 0.22.0 — Dossier d'entraînement
- Bac à sable de la visite guidée : jamais envoyé, hors recherche, purgé automatiquement.

## 0.21.0 — Champs personnalisés et export/import de configuration
- Champs personnalisés de la fiche (type, obligatoire, droits de saisie, condition d'affichage).
- Export et import de la configuration d'un organisme (référentiels, circuits, champs, instances).

## 0.20.2 — « Se souvenir de moi » à la connexion
- Mémorisation de l'identifiant seulement (jamais du mot de passe), agents et élus.

## 0.20.1 — Visite guidée orientée utilisateur de base
- Contenu de la visite centré sur la rédaction, les visas, le circuit, l'assistant IA et la validation.

## 0.20.0 — Annotations sur les PDF et actes proches
- Annotations sur les PDF de l'espace élus (ELU-71 à ELU-76).
- Actes proches proposés sur la fiche du dossier.

## 0.19.0 — Visite guidée de première connexion
- Visite guidée à projecteur, reprise là où on s'est arrêté, badges, rejeu depuis le menu.
- Mesure anonymisée pour améliorer le tutoriel.

## 0.18.0 — Recherche plein texte et choix du tiers de télétransmission
- Recherche plein texte (titres, textes, annexes), insensible aux accents.
- Choix du tiers de télétransmission.

## 0.17.0 — Archivage en GED Alfresco
- Port et adaptateurs (Alfresco REST v1, simulateur), paramétrage avec test de connexion.
- Plan de classement et archivage versionné des séances.

## 0.16.0 — Espace élus : application en DMZ
- Front distinct (PWA/APK), téléchargement en arrière-plan, visionneuse, notes, suivi en direct.
- Gestion des accès côté SCC ; déploiement en DMZ.

## 0.15.0 — Espace élus : API
- Authentification par invitation, mot de passe et code par mail ; documents PDF filigranés, lectures, notes, suivi direct.

## 0.14.0 — Télétransmission S²LOW et groupes politiques
- Chaîne complète S²LOW en mode simulation.
- Groupes politiques issus du Hub, activation par usage de l'IA, écran « Paramétrages ».

## 0.13.0 — Procès-verbal et registre en PDF
- Procès-verbal, liste des délibérations et extrait du registre générés en PDF depuis le suivi de séance.

## 0.12.1 — Jeu d'exemple sur l'organisation réelle
- Séance d'exemple sur l'organisation réelle et noms des modèles IA.

## 0.12.0 — Suivi de séance (page) et modèles IA
- Page de suivi de séance, modification et suppression de séance.
- Consignes et modèles de l'IA par fonction ; canal mail / outil par règle ; refus par règle.

## 0.11.0 — Suivi de séance en direct (backend)
- Suivi de séance en direct, purge des données de démonstration, AD en repli, étape en rédaction surlignée.

## 0.10.2 — Organisation RH et noms
- DGS dérivée de la direction générale des services, « Directeur·trice », noms composés.

## 0.10.1 — Frise et responsables
- Frise fusionnée quand le rédacteur est directeur, désignation du responsable RH, noms des agents inconnus.

## 0.10.0 — Visibilité des actes et commissions
- Visibilité des actes paramétrable (général et par utilisateur).
- Type de commission, dossiers simples (description et pièces jointes), convocation par commission.

## 0.9.0 — Éditeur de circuits et organisation
- Organisation des responsables, postes vacants contournés, étape de refus par étape, éditeur de circuits.

## 0.8.0 — Convocation des élus
- Convocation avec lien personnel unique, suivi de lecture, journal de preuve, statistiques, relance et modificatif.

## 0.7.1 — Renommage VibeDélib
- L'outil devient VibeDélib ; salutation par le prénom.

## 0.7.0 — Indicateurs de séance et multi-collectivités
- Indicateurs de séance (compte à rebours, taux de réalisation, actes à terminer, directions en retard).
- Administration multi-collectivités.

## 0.6.0 — Cahier de séance
- Génération asynchrone, versions, contrôles, profils, recto-verso, filigrane, traçabilité ; intitulé de poste d'après l'organigramme RH.

## 0.5.0 — Réunions de commission et outillage
- Réunions de commission avec projets présentés et Teams.
- Outils IA de l'éditeur, visionneuse PDF unique, docker-compose complet.

## 0.4.0 — IA en arrière-plan et identité
- Assistant IA en arrière-plan (file d'attente paramétrable).
- Identité et logo de l'organisme, séances passées, dossiers visant une séance, liste des utilisateurs.

## 0.3.1 — Tableau de bord
- Tableau de bord avec l'équipe et les actes validés en cours de circuit.

## 0.3.0 — Gabarits PDF et « afficher en tant que »
- Gabarits PDF (police, marges, en-tête, pied de page, fond).
- « Afficher en tant que » et autocomplétion des agents partout.

## 0.2.0 — Ordre du jour, utilisateurs et rôles
- Ordre du jour et numérotation.
- Utilisateurs et rôles, connexion de développement, jeu de démonstration, commissions réelles.

## 0.1.1 — Séances, dérogations, commissions et élus
- Tests et compléments sur les séances, dérogations, commissions et élus ; erreur 423 pour la date limite.

## 0.1.0 — Socle applicatif
- Backend (lots 0 à 4a) : actes, textes suivis, rendu PDF, circuit et délégations, notifications et relances, élus, commissions, séances et dérogations.
- Premier frontend d'après les maquettes.
