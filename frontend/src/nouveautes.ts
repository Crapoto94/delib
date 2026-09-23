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
export const VERSION = '0.45.0';

export const VERSIONS: Version[] = [
  {
    version: '0.45.0', type: 'minor', titre: 'Commissions, directions en info, rétroplanning et confort de rédaction',
    items: [
      "Rétroplanning d'une séance paramétrable en jours calendaires (week-ends et jours fériés compris) ou en jours ouvrés, au choix dans Paramétrages › Rétroplanning ; le simulateur de dates en tient compte.",
      "Réunions de commission : le lieu par défaut est « Teams ».",
      "Élu rapporteur : la fonction s'affiche à l'écriture inclusive (Adjointe, conseillère municipale…) selon la civilité fournie par le Hub DSI (M. / Mme) ; à défaut seulement, elle est déduite du prénom.",
      "Création d'un dossier par mots-clés : les délibérations passées proposées indiquent la date de leur séance et sont classées de la plus récente à la plus ancienne.",
      "Directions « en info » (copie) sur un dossier : le directeur de ces directions est notifié quand le projet arrive au SCC, et leur DGA quand la délibération arrive à l'étape DGA. Nouveau champ dans les informations clés de l'acte.",
      "Commissions : le rattachement pour avis se fait désormais dans les informations clés de l'acte et devient obligatoire dès que la collectivité a des commissions actives.",
      "Gestion des commissions : ajout, retrait et changement de fonction des membres élus (président·e, vice-président·e, membre) depuis la fiche de la commission ; suppression d'une commission par l'administrateur et le SCC (les rattachements aux actes sont retirés).",
      "Circuit : un acte rédigé par un membre du SCC (sa directrice, par exemple) passe quand même par l'étape SCC ; un DGA peut renvoyer l'acte à la direction (niveau directeur), même si l'étape a été sautée.",
      "Import AIRS : l'exposé des motifs et la délibération ne sont plus joints en pièces jointes (ils figurent déjà dans les textes de l'acte) ; seules les annexes le sont.",
      "Textes d'une délibération : quand un texte est rédigé, la pastille orange « à rédiger » laisse place à « ok ».",
      "« Mes actes » : le bloc « Action attendue de vous » est mis en évidence et placé en tête des rubriques.",
    ],
  },
  {
    version: '0.44.0', type: 'minor', titre: 'Décisions et arrêtés : signature du maire par parapheur',
    items: [
      "Nouveaux types d'acte « Décision » et « Arrêté », proposés dès la création. Une décision est prise par le maire dans le cadre d'une délégation du conseil ; un arrêté est un acte réglementaire ou individuel du maire. Ni l'un ni l'autre ne passe au conseil.",
      "À la fin du circuit d'une décision ou d'un arrêté, le dossier passe à l'état « À signer » et part en signature du maire au lieu d'être inscrit à l'ordre du jour. Le circuit reste le même que pour les délibérations ; il peut être spécialisé par type d'acte dans Paramétrages › Circuits.",
      "Une décision doit lier les délibérations adoptées qui l'autorisent : un bloc « Délibérations d'autorisation » sur la fiche permet de les rechercher (bibliothèque) et de les lier ; sans elles, le dossier ne peut pas être envoyé.",
      "Nouveau menu Paramétrages › Parapheur (signature) : choix du parapheur — DSIHUB par défaut, iParapheur prévu (non disponible) —, état actif, mode dev (tous les envois vers une adresse d'essai unique) ou prod (au signataire paramétré), compte technique du Hub, signataire et bouton de test.",
      "Tous les échanges avec le parapheur sont journalisés (ce qui est envoyé, ce qui est retourné) et consultables depuis la fiche du dossier comme depuis l'administration. Sans Hub configuré, un simulateur permet de dérouler la signature (retour signé ou refusé).",
      "Pastilles de type d'acte dans les listes et sur la fiche : l'icône du type (délibération, décision, arrêté) s'affiche désormais seule, à côté du titre.",
      "Parapheur : le mode de signature se choisit (P12 par défaut, signature manuscrite ou SMS avec le portable du signataire), le document remis au parapheur porte son vrai titre et les métadonnées de l'acte (rubrique, direction, rédacteur, séance…), la position de signature est transmise au parapheur (le document s'affiche et se lit dans la visionneuse), et l'administration peut « Envoyer un document de test » pour vérifier la chaîne de bout en bout. Un envoi en erreur propose « Renvoyer au parapheur ».",
      "Une décision n'a ni séance à viser, ni élu rapporteur, ni exposé, ni visas : juste l'acte lui-même. Pour les actes signés (décision, arrêté), les articles du dispositif s'enchaînent sans retour à la ligne. Un administrateur ou le SCC peut envoyer une décision en signature du maire sans attendre la fin du circuit.",
    ],
  },
  {
    version: '0.43.0', type: 'minor', titre: 'Gabarits Word, éditeur enrichi (images, tableaux, alignement) et bibliothèque multi-documents',
    items: [
      "Gabarits Word (.docx) à variables : chaque document (exposé des motifs, délibération, visas et considérants, délibéré, dossier complet) est produit à partir du modèle Word défini pour son gabarit s'il existe, sinon de la mise en page PDF. La fusion remplit les zones (exposé, visas, dispositif, présences, transmission…), insère les tableaux et les images, puis convertit en PDF sur le serveur. On peut déposer, télécharger, prévisualiser et retirer le modèle de chaque gabarit (Paramétrages › Gabarits).",
      "Variable {numero} : le numéro du dossier au conseil, dans l'ordre de passage (figé à l'arrêt de l'ordre du jour, provisoire avant), utilisable dans les modèles Word et les en-têtes PDF.",
      "Éditeur : insertion d'images (fichier, copier/coller, glisser-déposer), redimensionnement à la poignée, rotation, alignement (gauche / centré / droite) et déplacement ; insertion de tableaux ; alignement des paragraphes (gauche, centré, droite, justifié) comme dans un traitement de texte ; le copier/coller conserve la mise en forme, y compris depuis Word.",
      "Bibliothèque : visionneuse multi-documents — on navigue d'une pièce jointe à l'autre (flèches, liste) ; pour les délibérations des conseils non encore archivés, un bouton « Délibération » régénère visas et délibéré au bon gabarit ; boutons par document (exposé, délibération, extrait du registre, pièces jointes) et fiche complète.",
      "« Mes actes » : nouvelle rubrique « Dans le circuit » (actes encore en circuit chez un autre avec leur étape, ou validés en attente de séance) ; vue par rubrique ou par conseil pressenti ; la direction porteuse et le service s'affichent sous l'acte ; pastille « Inscrit au conseil » et fond vert quand le circuit est validé ET l'acte inscrit.",
      "Séances : distinction clôturées / non clôturées (filtre d'état et pastille). Les séances reprises d'AIRS sont marquées « tenue » et jamais closes, avec correction d'un verrouillage antérieur.",
      "Création d'un dossier : la direction porteuse reste déduite de votre fiche RH, et un champ libre « service / bureau ou chargé de mission » permet de préciser le service porteur.",
      "Import AIRS : l'origine (archivé ou courant) et les actes des conseils non archivés sont conservés ; les séances reprises ne sont plus marquées closes.",
      "Organisation (Paramétrages › Organisation) : l'organigramme du Hub DSI peut être complété localement, une direction ou un service peut être renommé, ou masqué pour ne plus apparaître dans les listes de l'application (une direction masquée emporte ses services).",
    ],
  },
  {
    version: '0.42.0', type: 'minor', titre: 'Mes actes, « Tous les actes », bibliothèque enrichie et import AIRS des conseils récents',
    items: [
      "Accueil « Mes actes » : une seule page qui rassemble tous les actes qui vous concernent et ne sont pas encore passés au conseil, séparés en rubriques — action attendue de vous, rédaction/validation de votre équipe, actes que vous avez validés et qui poursuivent leur circuit, actes inscrits au conseil. Les actes en retard sont distingués d'emblée.",
      "Nouvelle page « Tous les actes » (administrateur, SCC) : les actes qui ne sont pas encore passés au conseil, avec une rupture au choix — par étape du circuit (rédaction, validation directeur, visa finance, inscrit au conseil…) ou par date du conseil pressenti.",
      "Import AIRS : reprise des actes des séances non archivées (documents Word et annexes), avec conversion automatique en PDF à côté du fichier d'origine ; l'origine AIRS (archivé ou courant) est conservée et les élus repris sont marqués comme anciens élus.",
      "Annexes : un document d'origine (Word/Excel) et son PDF converti forment une seule annexe, avec deux boutons ; une annexe est communicable ou non communicable.",
      "Bibliothèque : filtre rapide par état — archivé, en cours, ou les deux — avec pastille colorée ; les actes issus de l'import AIRS sont signalés en violet ; le bouton d'annexes affiche leur nombre et, entre parenthèses en rouge, celles qui ne sont pas publiables ; les boutons « exposé des motifs » et « extrait du registre » servent directement les PDF de l'import.",
      "Création d'un dossier : saisie de mots-clés ; l'application propose des délibérations passées correspondantes (recherche dans la bibliothèque, sans IA, reconnaissant les acronymes comme RIFSEEP pour R.I.F.S.E.E.P) et permet de les reprendre comme modèle, textes et annexes compris.",
      "Rappel d'une délibération en circuit : seules les personnes ayant eu affaire à l'acte (validation, avis, commentaire, amendement) et le rédacteur sont prévenues ; la liste des destinataires est affichée avant de confirmer.",
      "Un ordre du jour arrêté peut être rouvert (avec motif) tant que la séance n'est pas convoquée, pour corriger ou compléter la liste.",
      "Suppression d'un acte : un acte déjà passé au conseil ne peut être supprimé que par un administrateur ou le SCC.",
      "Numéros de suivi : plus de collision après un import AIRS, la numérotation reprend toujours au-dessus des numéros déjà attribués.",
    ],
  },
  {
    version: '0.41.0', type: 'minor', titre: 'Dossier assisté : un guide pas à pas à la rédaction',
    items: [
      "Créer un dossier en mode assisté (case à la création, ou carte « Dossier assisté » sur un brouillon existant) : un avatar d'aide, Evelyne Del-IA, accompagne la rédaction.",
      "Evelyne Del-IA dit quoi faire à chaque étape — fiche, exposé des motifs, visas, dispositif, annexes, relecture, envoi — donne des conseils, et suit la progression. L'étape courante est déduite automatiquement de l'état du dossier.",
      "Le bouton « Montrer » ouvre l'éditeur sur le texte concerné ou place le curseur sur le champ à remplir, avec un repère visuel. Les champs obligatoires non renseignés de la fiche sont surlignés.",
      "Le guide est déplaçable sur la fenêtre (glisser son en-tête ou l'avatar) ; sa position est mémorisée. Il rappelle que l'état de complétude est affiché dans l'encadré « État de complétude », à droite de la fiche.",
      "Le guide se réduit, se coupe (« Ne plus m'aider ») et se réactive à tout moment ; son état est mémorisé sur le dossier. Aussi accessible depuis le tableau de bord.",
      "À chaque étape franchie, Evelyne Del-IA félicite le rédacteur et sa zone passe au vert — « c'est bon, on passe à l'étape suivante ».",
      "Domaine d'intervention (matière) : la nomenclature de la préfecture se choisit désormais dans une arborescence dépliable, avec recherche ; seules les matières précises (feuilles) sont sélectionnables.",
      "Éditeur : les modifications sont enregistrées automatiquement au fil de la frappe — il suffit de cliquer sur « Terminer » quand le texte est vraiment fini (un rappel s'affiche pendant l'édition).",
      "Bibliothèque de vus et considérants : dans l'onglet « Vu et considérant », les formules les plus utilisées des délibérations adoptées sont proposées (les plus fréquentes d'abord), chacune avec une pastille de vérification (vérifié, à revoir, obsolète, à faire vérifier) ; un clic insère la ligne.",
      "Étape « Relecture » : un bouton « Ouvrir le dossier complet » affiche l'aperçu PDF du dossier entier, et le conseil rappelle qu'on peut ouvrir un fil de discussion sur le dossier (mentions @).",
      "Après l'envoi d'un dossier, un écran de félicitations s'affiche avec un mini feu d'artifice : « Bravo, vous avez envoyé votre premier dossier, il est en relecture auprès de … et poursuivra son chemin ».",
      "Evelyne Del-IA sait répondre aux questions : posez-lui une question dans son panneau, il répond en s'appuyant sur la documentation, votre profil et une recherche dans les délibérations de l'application. À la fin, dites si la réponse vous a convenu (1 à 4 étoiles) et laissez un commentaire si vous le souhaitez.",
      "Paramétrages IA : l'administration consulte le journal de l'aide IA — questions posées, réponses apportées, note et commentaire — avec la moyenne des notes des réponses.",
    ],
  },
  {
    version: '0.40.0', type: 'minor', titre: 'Mode simulation de séance, numéro d’origine à l’ordre du jour, CGU et licence',
    items: [
      "Ouvrir une séance un autre jour que sa date est désormais possible : l'application passe en mode simulation, avec un bandeau visible, et tout ce qui est saisi peut être annulé d'un geste (présences, pouvoirs, votes, points) pour revenir à l'état d'avant ouverture.",
      "À la création de l'ordre du jour, le numéro d'origine d'un acte repris d'AIRS est affiché (n° source), à côté du numéro généré.",
      "Conditions générales d'utilisation et licence d'usage accessibles depuis l'application (pied de page, écran de connexion et espace élus).",
    ],
  },
  {
    version: '0.39.0', type: 'minor', titre: 'Import AIRS DELIB : sas, concordances et publication',
    items: [
      "Nouvel écran Paramétrages › Import AIRS DELIB : reprise de l'historique de l'ancien logiciel en trois temps — sas (données brutes, invisibles), concordances (rapprochement avec vos élus, directions, services, agents et référentiels déjà paramétrés), puis publication des actes des séances passées.",
      "Un lot de reprise se charge depuis un export JSON du HUB DSI (ou un jeu d'essai), s'analyse, puis se valide : la publication reste bloquée tant que les concordances obligatoires (direction, service) ne sont pas tranchées.",
      "Contrôle AD des agents cités par AIRS qui ne se sont jamais connectés (connu, jamais connecté, absent, ambigu) — aucun compte n'est créé.",
      "Le mapping des tables AIRS est déclaratif : dès que le MCD d'AIRS sera connu, il se renseigne en configuration, sans redéploiement.",
      "Publication idempotente et réversible : chaque acte repris est créé une seule fois (séance, textes, résultat de vote), et un lot peut être annulé.",
    ],
  },
  {
    version: '0.38.1', type: 'patch', titre: 'Séance visée : inscrit ou pas encore',
    items: [
      "La séance visée s'affiche en gras quand le dossier est inscrit à l'ordre du jour de cette séance, et en italique (« pas encore inscrit ») quand elle n'est que visée : tableau de bord, liste des dossiers et fiche du dossier.",
    ],
  },
  {
    version: '0.38.0', type: 'minor', titre: 'Séances : nouvelle liste, relance des services, lien Outlook ; se souvenir de moi',
    items: [
      "Liste des séances refondue d'après la maquette : une carte par séance (compte à rebours, délibérations inscrites, étape du workflow, jalons), onglets à compteurs, année, instances, filtre, vue détaillée ou compacte.",
      "« Relancer les services » : relance, direction par direction, les détenteurs des dossiers non terminés d'une séance (garde-fou de 24 h).",
      "« Lien calendrier Outlook » : un abonnement dynamique personnel et secret (séances, lieux, annulations, jalons pour le SCC), sans export de fichier.",
      "« Se souvenir de moi » : session persistante de 6 mois au plus, jusqu'à la déconnexion.",
      "Dossiers de mon équipe : la séance visée est affichée.",
      "Mot de passe oublié des élus : les SMS peuvent partir par l'API de la Ville (APM), en plus d'une passerelle propre.",
    ],
  },
  {
    version: '0.37.0', type: 'minor', titre: 'Alertes de recherche par e-mail',
    items: [
      "Alertes de recherche par e-mail (facultatif) : l'enveloppe à côté de la cloche d'une recherche enregistrée envoie aussi le message par mail.",
    ],
  },
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
