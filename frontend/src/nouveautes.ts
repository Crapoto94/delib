/**
 * Journal des versions (What's New).
 *
 * Convention (avant la production) : l'application est en 0.x.y.
 *   - x (mineure) : ajout d'un module ou d'une fonctionnalité.
 *   - y (correctif) : correction, débogage ou amélioration sans nouveau module.
 *   - 1.0.0 : version de production (la date y sera ajoutée le jour venu ; aucune date avant).
 * Ce fichier est la source affichée dans l'application ; il est tenu en phase avec CHANGELOG.md.
 */

export type Version = { version: string; type: 'minor' | 'patch'; titre: string; items: string[] };

/** Version courante de l'application. */
export const VERSION = '0.36.1';

export const VERSIONS: Version[] = [
  {
    version: '0.36.1', type: 'patch', titre: 'Visite guidée et aide mises à jour',
    items: [
      "Visite guidée (version 2) et aide : « Mes actes », « Bibliothèque » et « Vérifier les références » sont expliqués ; la visite est reproposée à ceux qui avaient terminé la précédente.",
    ],
  },
  {
    version: '0.36.0', type: 'minor', titre: 'Listes filtrables, président de séance et date d’affichage',
    items: [
      "Toutes les listes déroulantes ont une zone de saisie pour filtrer les choix (dès 7 choix), utilisable au clavier.",
      "Au conseil, le président de séance est le maire par défaut à l'ouverture du suivi de séance (modifiable).",
      "Date d'affichage saisie par le SCC après l'AR : elle renseigne la mention « publié par voie d'affichage » de l'extrait du registre.",
    ],
  },
  {
    version: '0.35.0', type: 'minor', titre: 'Contrôle de légalité, workflow de séance, bibliothèque et trajet des actes',
    items: [
      "Contrôle de légalité : envoi et confirmation en masse (cases à cocher dans le suivi, « Préparer et envoyer »), sans s'arrêter à la première erreur.",
      "Contrôle de légalité : le SCC peut modifier le texte d'une délibération avant la transmission ; workflow d'envoi paramétrable (rôles, préparation, envoi et confirmation automatiques).",
      "AR de la préfecture : tampon sur chaque page, fichier ARActe XML conservé, consultable et déposé en GED ; extrait du registre conforme au modèle de la Ville (garde, présence, délibération).",
      "Séances : frise du workflow (Rédaction, Préparation, Convocation, Séance, Après la séance, Clôture) en haut des pages de la séance.",
      "Nouveaux : « Bibliothèque » (délibérations adoptées consultables par tous, avec exposé des motifs et extrait du registre) et « Mes actes » (trajet complet des dossiers où j'ai eu un rôle).",
      "Règles de notification : « active » et « obligatoire » réglables ; vote de groupe : case pleine si unanimité, remplissage proportionnel sinon, clic sur le nom pour zoomer sur le groupe.",
    ],
  },
  {
    version: '0.34.0', type: 'minor', titre: 'Pré-contrôle juridique et visas habituels',
    items: [
      "Pré-contrôle automatique des références à l'entrée du dossier dans l'étape « Service juridique » (sans IA, non bloquant).",
      "Visas habituels : l'assistant signale un visa présent dans la plupart des délibérations similaires adoptées et absent du dossier.",
    ],
  },
  {
    version: '0.33.0', type: 'minor', titre: 'Références juridiques vérifiées par le code',
    items: [
      "Bibliothèque de visas (Paramétrages › Visas et références) : textes normalisés avec statut, validité et dernière vérification ; import JSON/CSV ; fournie vide, maintenue par le juridique.",
      "« Vérifier les références » dans l'assistant : codes, lois, décrets, arrêtés et délibérations citées sont extraits par règles et vérifiés par le code contre la bibliothèque, à la date de la séance (sans IA).",
      "Listes de contrôle par type d'acte, matière et montant (visa ou mention attendus) ; ordre conventionnel des visas ; inclus dans le contrôle complet.",
      "Veille : un texte devenu abrogé ou modifié prévient les rédacteurs des actes en cours qui le citent.",
    ],
  },
  {
    version: '0.32.0', type: 'minor', titre: 'Nouveau design, mode sombre et menu latéral des paramétrages',
    items: [
      "Interface plus colorée et plus contrastée (bandeau de navigation bleu, cartes, tableaux et badges renforcés), inspirée des maquettes Stitch.",
      "Mode sombre : Automatique (suit l'appareil), Clair ou Sombre, depuis le bouton de l'en-tête ou le menu utilisateur ; aussi dans l'espace des élus.",
      "Paramétrages : menu latéral à gauche, groupé par thèmes, avec fil d'Ariane.",
    ],
  },
  {
    version: '0.31.0', type: 'minor', titre: 'Alertes de recherche et amendements dans l’espace élus',
    items: [
      "Cloche « Me prévenir quand un nouvel acte correspond » sur une recherche enregistrée : vérification au plus horaire, avec les droits de la personne, notification dans l'application.",
      "Amendements consultables dans l'espace élus (ELU-41).",
    ],
  },
  {
    version: '0.30.0', type: 'minor', titre: 'API externe et clés d’accès',
    items: [
      "API de lecture seule pour les applications tierces (site de la ville), avec clés hachées à affichage unique, portées distinguant actes exécutoires / adoptés / en cours, IP autorisées et limite de débit.",
      "Synchronisation incrémentale des actes, notamment une fois revenus du contrôle de légalité.",
    ],
  },
  {
    version: '0.29.0', type: 'minor', titre: 'RGPD : archivage intermédiaire et pseudonymisation',
    items: [
      "Menu RGPD : archivage intermédiaire des actes terminés et anciens, avec aperçu avant application (les actes restent conservés).",
      "Pseudonymisation des actions et journaux : les identités et adresses IP anciennes sont remplacées par des pseudonymes stables, sans réécrire le journal d'audit (immuable).",
      "Correspondance des pseudonymes conservée à part pour la ré-identification, journal des opérations RGPD, durées de conservation paramétrables.",
    ],
  },
  {
    version: '0.28.0', type: 'minor', titre: 'Documents techniques (DAT & DEX) et mode opératoire',
    items: [
      "DAT (document d'architecture technique) et DEX (dossier d'exploitation) disponibles dans l'aide administrateur, exportables en PDF.",
      "Le DAT expose l'architecture, le schéma des flux, les interfaces avec les applications tierces, les variables, le SGBD et le stockage.",
      "Mode opératoire pour un vibecodeur : précautions, risques et prompts de base ; mention que l'application est vibecodée.",
    ],
  },
  {
    version: '0.27.0', type: 'minor', titre: 'Sauvegarde vers un dossier réseau',
    items: [
      "Export logique cohérent et copie SMB avec identifiants chiffrés, planification, rétention et restauration outillée.",
    ],
  },
  {
    version: '0.26.0', type: 'minor', titre: 'Alfresco comme stockage des fichiers',
    items: [
      "Les fichiers peuvent être stockés dans Alfresco (clés alf:), avec cache et sonde ; migration dans les deux sens.",
    ],
  },
  {
    version: '0.25.0', type: 'minor', titre: 'Gestion des élus et mot de passe oublié par SMS',
    items: [
      "Création, édition, suppression prudente et désactivation persistante des élus.",
      "Réinitialisation du mot de passe de l'espace élus par SMS.",
    ],
  },
  {
    version: '0.24.0', type: 'minor', titre: "Centre d'aide",
    items: [
      "Trois aides accessibles depuis l'en-tête et affichées selon le profil : rédaction et circuit, séances et commissions (SCC), paramétrages.",
      "Séparation explicite des paramétrages fonctionnels (SCC) et techniques (administrateur).",
    ],
  },
  {
    version: '0.23.0', type: 'minor', titre: 'Amendements en séance et synchronisation GED',
    items: [
      "Dépôt et vote des amendements pendant la séance ; le vote du texte est bloqué tant qu'un amendement est en attente.",
      "Synchronisation VibeDélib / GED et archivage du cahier dès sa fin.",
    ],
  },
  {
    version: '0.22.0', type: 'minor', titre: "Dossier d'entraînement",
    items: [
      "Bac à sable de la visite guidée : jamais envoyé, hors recherche, purgé automatiquement.",
    ],
  },
  {
    version: '0.21.0', type: 'minor', titre: 'Champs personnalisés et export/import de configuration',
    items: [
      "Champs personnalisés de la fiche (type, obligatoire, droits de saisie, condition d'affichage).",
      "Export et import de la configuration d'un organisme (référentiels, circuits, champs, instances).",
    ],
  },
  {
    version: '0.20.2', type: 'patch', titre: '« Se souvenir de moi » à la connexion',
    items: ["Mémorisation de l'identifiant seulement (jamais du mot de passe), agents et élus."],
  },
  {
    version: '0.20.1', type: 'patch', titre: 'Visite guidée orientée utilisateur de base',
    items: ["Contenu de la visite centré sur la rédaction, les visas, le circuit, l'assistant IA et la validation."],
  },
  {
    version: '0.20.0', type: 'minor', titre: "Annotations sur les PDF et actes proches",
    items: [
      "Annotations sur les PDF de l'espace élus (ELU-71 à ELU-76).",
      "Actes proches proposés sur la fiche du dossier.",
    ],
  },
  {
    version: '0.19.0', type: 'minor', titre: 'Visite guidée de première connexion',
    items: [
      "Visite guidée à projecteur, reprise là où on s'est arrêté, badges, rejeu depuis le menu.",
      "Mesure anonymisée pour améliorer le tutoriel.",
    ],
  },
  {
    version: '0.18.0', type: 'minor', titre: 'Recherche plein texte et choix du tiers de télétransmission',
    items: [
      "Recherche plein texte (titres, textes, annexes), insensible aux accents.",
      "Choix du tiers de télétransmission.",
    ],
  },
  {
    version: '0.17.0', type: 'minor', titre: 'Archivage en GED Alfresco',
    items: [
      "Port et adaptateurs (Alfresco REST v1, simulateur), paramétrage avec test de connexion.",
      "Plan de classement et archivage versionné des séances.",
    ],
  },
  {
    version: '0.16.0', type: 'minor', titre: "Espace élus : application en DMZ",
    items: [
      "Front distinct (PWA/APK), téléchargement en arrière-plan, visionneuse, notes, suivi en direct.",
      "Gestion des accès côté SCC ; déploiement en DMZ.",
    ],
  },
  {
    version: '0.15.0', type: 'minor', titre: "Espace élus : API",
    items: [
      "Authentification par invitation, mot de passe et code par mail ; documents PDF filigranés, lectures, notes, suivi direct.",
    ],
  },
  {
    version: '0.14.0', type: 'minor', titre: 'Télétransmission S²LOW et groupes politiques',
    items: [
      "Chaîne complète S²LOW en mode simulation.",
      "Groupes politiques issus du Hub, activation par usage de l'IA, écran « Paramétrages ».",
    ],
  },
  {
    version: '0.13.0', type: 'minor', titre: 'Procès-verbal et registre en PDF',
    items: [
      "Procès-verbal, liste des délibérations et extrait du registre générés en PDF depuis le suivi de séance.",
    ],
  },
  {
    version: '0.12.1', type: 'patch', titre: "Jeu d'exemple sur l'organisation réelle",
    items: ["Séance d'exemple sur l'organisation réelle et noms des modèles IA."],
  },
  {
    version: '0.12.0', type: 'minor', titre: 'Suivi de séance (page) et modèles IA',
    items: [
      "Page de suivi de séance, modification et suppression de séance.",
      "Consignes et modèles de l'IA par fonction ; canal mail / outil par règle ; refus par règle.",
    ],
  },
  {
    version: '0.11.0', type: 'minor', titre: 'Suivi de séance en direct (backend)',
    items: [
      "Suivi de séance en direct, purge des données de démonstration, AD en repli, étape en rédaction surlignée.",
    ],
  },
  {
    version: '0.10.2', type: 'patch', titre: 'Organisation RH et noms',
    items: ["DGS dérivée de la direction générale des services, « Directeur·trice », noms composés."],
  },
  {
    version: '0.10.1', type: 'patch', titre: 'Frise et responsables',
    items: ["Frise fusionnée quand le rédacteur est directeur, désignation du responsable RH, noms des agents inconnus."],
  },
  {
    version: '0.10.0', type: 'minor', titre: 'Visibilité des actes et commissions',
    items: [
      "Visibilité des actes paramétrable (général et par utilisateur).",
      "Type de commission, dossiers simples (description et pièces jointes), convocation par commission.",
    ],
  },
  {
    version: '0.9.0', type: 'minor', titre: 'Éditeur de circuits et organisation',
    items: [
      "Organisation des responsables, postes vacants contournés, étape de refus par étape, éditeur de circuits.",
    ],
  },
  {
    version: '0.8.0', type: 'minor', titre: 'Convocation des élus',
    items: [
      "Convocation avec lien personnel unique, suivi de lecture, journal de preuve, statistiques, relance et modificatif.",
    ],
  },
  {
    version: '0.7.1', type: 'patch', titre: 'Renommage VibeDélib',
    items: ["L'outil devient VibeDélib ; salutation par le prénom."],
  },
  {
    version: '0.7.0', type: 'minor', titre: 'Indicateurs de séance et multi-collectivités',
    items: [
      "Indicateurs de séance (compte à rebours, taux de réalisation, actes à terminer, directions en retard).",
      "Administration multi-collectivités.",
    ],
  },
  {
    version: '0.6.0', type: 'minor', titre: 'Cahier de séance',
    items: [
      "Génération asynchrone, versions, contrôles, profils, recto-verso, filigrane, traçabilité ; intitulé de poste d'après l'organigramme RH.",
    ],
  },
  {
    version: '0.5.0', type: 'minor', titre: 'Réunions de commission et outillage',
    items: [
      "Réunions de commission avec projets présentés et Teams.",
      "Outils IA de l'éditeur, visionneuse PDF unique, docker-compose complet.",
    ],
  },
  {
    version: '0.4.0', type: 'minor', titre: 'IA en arrière-plan et identité',
    items: [
      "Assistant IA en arrière-plan (file d'attente paramétrable).",
      "Identité et logo de l'organisme, séances passées, dossiers visant une séance, liste des utilisateurs.",
    ],
  },
  {
    version: '0.3.1', type: 'patch', titre: 'Tableau de bord',
    items: ["Tableau de bord avec l'équipe et les actes validés en cours de circuit."],
  },
  {
    version: '0.3.0', type: 'minor', titre: 'Gabarits PDF et « afficher en tant que »',
    items: [
      "Gabarits PDF (police, marges, en-tête, pied de page, fond).",
      "« Afficher en tant que » et autocomplétion des agents partout.",
    ],
  },
  {
    version: '0.2.0', type: 'minor', titre: 'Ordre du jour, utilisateurs et rôles',
    items: [
      "Ordre du jour et numérotation.",
      "Utilisateurs et rôles, connexion de développement, jeu de démonstration, commissions réelles.",
    ],
  },
  {
    version: '0.1.1', type: 'patch', titre: 'Séances, dérogations, commissions et élus',
    items: ["Tests et compléments sur les séances, dérogations, commissions et élus ; erreur 423 pour la date limite."],
  },
  {
    version: '0.1.0', type: 'minor', titre: 'Socle applicatif',
    items: [
      "Backend (lots 0 à 4a) : actes, textes suivis, rendu PDF, circuit et délégations, notifications et relances, élus, commissions, séances et dérogations.",
      "Premier frontend d'après les maquettes.",
    ],
  },
];
