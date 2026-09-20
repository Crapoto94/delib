/**
 * Documents techniques (DAT, DEX) : contenu rédigé en Markdown restreint, rendu à l'identique dans l'aide en ligne
 * et dans le PDF généré par le backend. Les variables (version, date, environnement) sont interpolées à la génération.
 * Markdown accepté par la composition PDF (modules/render/typeset) : titres (#, ##, ###), listes (- et 1.), gras (**).
 * Contraintes : un paragraphe par ligne (pas de retour à la ligne manuel), marqueurs « ** » équilibrés, pas d'accolades.
 */

function dat(v) {
  return `# Document d'Architecture Technique (DAT)

Application VibeDélib — gestion des délibérations. Édition du ${v.date}. Version applicative : ${v.version}. Environnement : ${v.env}.

## 1. Objet et périmètre

Ce document décrit l'architecture technique de VibeDélib : composants, flux, données, intégrations, sécurité et prérequis. Il s'adresse aux équipes techniques (DSI, intégration, exploitation) et sert de référence pour l'exploitation (voir le DEX) et les évolutions.

Périmètre couvert : rédaction et circuit de validation des actes, commissions, séances et ordre du jour, convocation et espace élus, tenue de séance et votes, contrôle de légalité, recherche, archivage GED et assistance IA.

Hors périmètre de cette version : signature électronique (mécanisme prévu, non branché), publication et recueil des actes, hébergement d'une autre collectivité avec annuaire distinct.

## 2. Vue d'ensemble

VibeDélib est une application web multi-organismes : une même installation sert plusieurs organismes (Ville, CCAS, autres) avec une isolation stricte des données.

- **Frontend agents** : application React servie par nginx, qui relaie l'API en interne (un seul port exposé).
- **Backend** : API REST Node.js et Express, porte les règles métier, le circuit, le rendu PDF et les traitements planifiés.
- **Base de données** : PostgreSQL, schéma dédié (par défaut « ivrydelib ») de la base partagée de la Ville.
- **Stockage de fichiers** : annexes, logos et fonds de page sur volume persistant.
- **Espace élus** : application distincte exposée en DMZ, avec sa propre authentification par lien personnel.
- **Intégrations** : APM (annuaire AD, mail, SMS, IA), Hub DSI (RH, organisation, élus), S2LOW (contrôle de légalité), Alfresco (GED), Microsoft Teams (option).

Flux principal : le navigateur de l'agent appelle nginx, qui relaie le chemin d'API vers le backend ; le backend lit et écrit dans PostgreSQL et dans le stockage, puis appelle les services externes selon les besoins.

## 3. Acteurs et rôles

- **Rédacteur** : agent autorisé à rédiger pour une direction ; droit déduit de sa direction RH et des autorisations de rédaction.
- **Valideur** : détenteur d'une étape du circuit (chef de service, directeur, DGA, DGS, service financier, service juridique, SCC), résolu dynamiquement selon le circuit.
- **SCC** : Service Conseil et Contentieux, dernier maillon du circuit ; gère les séances, l'ordre du jour, la convocation et la télétransmission.
- **Élu** : consulte, annote et partage les documents dans l'espace élus (DMZ).
- **Administrateur d'organisme** : paramètre son organisme (circuits, référentiels, utilisateurs, gabarits, connexions).
- **Administrateur de plateforme** : crée les organismes et les paramètres transverses ; réservé à la DSI.
- **Télétransmission** : prépare et confirme les envois au contrôle de légalité.
- **Lecteur** : consultation seule.

## 4. Architecture applicative

### 4.1 Backend

Application Node.js en modules par domaine (routes, services, accès aux données). Chaque route déclare en un seul endroit sa politique d'accès, sa validation et sa documentation : une route ne peut pas exister sans être documentée. L'API est versionnée sous « /api/v1 » ; la documentation interactive est servie sur « /api-docs », le descriptif sur « /swagger.json » et le contrôle de santé sur « /api/status ».

Le backend porte l'authentification et les sessions, les organismes et les rôles, les référentiels, les actes et leurs textes suivis, le moteur de circuit, les notifications et relances, les commissions, les séances et l'ordre du jour, la tenue de séance et les votes, les convocations, l'espace élus, la télétransmission, la GED, la recherche plein texte, le rendu PDF et l'assistance IA.

### 4.2 Frontend agents

Application React 18 en TypeScript strict, construite par Vite et stylée avec Tailwind. Elle est servie en fichiers statiques par nginx, qui relaie le chemin d'API vers le backend : le navigateur ne parle qu'à un seul domaine, ce qui évite toute question de CORS. Les mêmes interfaces servent tous les profils ; les fonctions visibles dépendent des rôles et des droits.

### 4.3 Espace élus (DMZ)

Frontend distinct exposé dans une zone réseau démilitarisée. Il ne contient ni base de données ni secret. Les élus y accèdent par un lien personnel envoyé avec la convocation ; ils consultent les documents, les annotent et partagent leurs notes.

### 4.4 Traitements planifiés

Un ordonnanceur interne déclenche périodiquement les relances et échéances, le suivi des statuts de télétransmission, la purge des dossiers d'entraînement, la synchronisation GED et l'indexation de la recherche. Il est activable par configuration.

## 5. Architecture des données

Les données sont stockées dans PostgreSQL, dans un schéma dédié. Le schéma est créé et mis à jour par des migrations SQL numérotées, exécutées automatiquement au démarrage. Chaque migration est appliquée une seule fois, dans sa propre transaction ; une migration déjà appliquée ne doit jamais être modifiée (une somme de contrôle le vérifie).

- **Isolation multi-organismes** : chaque enregistrement métier porte un identifiant d'organisme ; une couche d'accès unique filtre selon les organismes autorisés de l'utilisateur.
- **Traçabilité** : rien n'est écrasé ; les changements sont horodatés et attribués dans un journal d'audit.
- **Versionnement** : textes suivis, annexes, circuits et gabarits conservent leurs versions.
- **Référentiels hérités** : un jeu commun au niveau plateforme, surchargeable par organisme.
- **Fichiers hors base** : stockés sur volume, référencés en base avec leur empreinte SHA-256.

## 6. Intégrations externes

- **APM** : authentification des agents (annuaire AD), envoi des mails et des SMS, API d'IA interne.
- **Hub DSI** : organigramme RH (directions, services, responsables), agents et élus de la Ville.
- **S2LOW** : télétransmission des actes au contrôle de légalité (certificat client). Un simulateur est utilisé tant que l'accès réel n'est pas obtenu.
- **Alfresco** : archivage des documents de séance dans une GED. Un simulateur persistant est utilisé par défaut.
- **Microsoft Teams** : création de réunions de commission (optionnel).
- **Légifrance** : vérification des textes en vigueur (optionnel).

Aucun secret ni URL de service n'est écrit dans le code : tout provient de variables d'environnement.

## 7. Sécurité

- **Authentification** : agents par l'annuaire AD via l'APM, puis jeton de session à durée de vie bornée et session révocable ; élus par lien personnel et code à usage unique.
- **Autorisation** : rôles par organisme ; fonctions de validation résolues par le circuit ; isolation stricte entre organismes. Le mode « afficher en tant que » est réservé aux administrateurs et au SCC, journalisé et revérifié à chaque requête.
- **Secrets** : jamais stockés en clair, fournis par l'environnement, jamais exposés au navigateur.
- **En-têtes HTTP** : politique de sécurité de contenu, anti-sniffing, protection contre l'encadrement, politique de référent.
- **CORS** : restreint aux origines connues, jamais l'étoile.
- **Limitation de débit** : sur les routes sensibles et l'authentification.
- **Audit** : toute action significative est journalisée (qui, quoi, quand).

## 8. Performance et disponibilité

- Le rendu PDF est mis en cache par empreinte du contenu et de la version du gabarit.
- La recherche s'appuie sur l'index plein texte de PostgreSQL (français, insensible aux accents).
- Les traitements longs (IA, génération du cahier, envoi des convocations) s'exécutent en arrière-plan et l'utilisateur est notifié.
- Les services redémarrent automatiquement en cas d'arrêt ; la supervision s'appuie sur le contrôle de santé et les journaux.

## 9. Prérequis et dépendances

- Node.js et PostgreSQL (versions de référence dans le DEX).
- Un serveur nginx pour servir le frontend et relayer l'API.
- Un accès réseau aux services externes utilisés, et un certificat client pour S2LOW si la télétransmission réelle est activée.
- Un volume persistant pour le stockage des fichiers et un accès en lecture aux polices sous licence.

## 10. Environnements et déploiement

Trois environnements peuvent coexister : développement, recette et production. La configuration est entièrement portée par des variables d'environnement, par environnement. Le déploiement s'appuie sur Docker Compose ; la procédure détaillée, les sauvegardes et les incidents courants sont décrits dans le Dossier d'Exploitation (DEX).

## 11. Traçabilité et audit

Chaque acte, chaque étape du circuit et chaque action d'administration laisse une trace horodatée et attribuée. Les modifications de texte sont suivies (auteur, date, couleur). Le journal de preuve des convocations enregistre envois, ouvertures et réponses ; les adresses IP ne sont conservées que sous forme d'empreinte.

## 12. Évolutions et points d'extension

L'architecture accueille sans refonte la signature électronique (port dédié), la publication et le recueil des actes, de nouveaux organismes, d'autres tiers de télétransmission, d'autres fournisseurs de GED et d'autres modèles d'IA. Les circuits, référentiels, champs et gabarits sont des données : ils se paramètrent sans modification de code.

## 13. Glossaire

- **Acte / dossier** : ensemble fiche, exposé, délibérations, annexes et discussion.
- **Circuit** : suite d'étapes de validation d'un acte.
- **ODJ** : ordre du jour d'une séance.
- **DMZ** : zone réseau exposée où tourne le frontend des élus.
- **GED** : gestion électronique des documents (ici Alfresco).
- **TDT** : télétransmission au contrôle de légalité.
- **SCC** : Service Conseil et Contentieux.`;
}

function dex(v) {
  return `# Dossier d'Exploitation (DEX)

Application VibeDélib. Édition du ${v.date}. Version applicative : ${v.version}. Environnement : ${v.env}.

## 1. Objet et public

Ce dossier décrit l'exploitation courante de VibeDélib : installation, configuration, sauvegardes, supervision, mises à jour et incidents. Il s'adresse à l'équipe d'exploitation (DSI) et à l'administrateur applicatif.

## 2. Inventaire des composants

- **Backend** : API Node.js, port interne 3021 ; redémarre toujours.
- **Frontend** : nginx et fichiers statiques React, port 5160 sur l'hôte.
- **PostgreSQL** : base partagée de la Ville ; un conteneur local facultatif existe pour le développement.
- **Espace élus (DMZ)** : conteneur distinct, port 5161, déployé séparément.
- **Volumes** : dossier de stockage (annexes, logos, fonds) et dossier des polices sous licence en lecture seule.

## 3. Prérequis

- Docker et Docker Compose.
- PostgreSQL accessible et un schéma dédié.
- Le fichier d'environnement à la racine du projet, jamais versionné.
- Accès réseau aux services externes utilisés (APM, Hub DSI, S2LOW, Alfresco).
- Les polices sous licence présentes si le gabarit les utilise.

## 4. Installation et premier démarrage

1. Récupérer le code puis se placer dans le dossier du projet.
2. Créer le fichier d'environnement à partir du modèle et renseigner les valeurs (base, secrets, services).
3. Construire et démarrer : « docker compose up -d --build ».
4. Vérifier que les conteneurs sont stables : « docker compose ps ».
5. Vérifier l'API : ouvrir « /api/status » sur le port du frontend (doit répondre).
6. Se connecter avec un administrateur (compte de secours local ou annuaire) et vérifier l'organisme par défaut.

## 5. Variables d'environnement

Les valeurs sensibles ne figurent pas ici ; elles sont dans le fichier d'environnement de chaque environnement. Principales familles :

- **Base de données** : hôte, port, base, utilisateur, mot de passe, schéma dédié, taille du pool, migrations automatiques.
- **Session et sécurité** : secret de session, durées de validité, administrateurs initiaux, compte de secours local.
- **Services externes** : URL et clés de l'APM et du Hub DSI, autorité de certification pour les services de la Ville.
- **Application** : port, origines autorisées, URL publique, activation de l'ordonnanceur, proxy de confiance.
- **Stockage et fichiers** : dossier de stockage, taille maximale des dépôts, dossier des polices.
- **Mail** : domaine des adresses, redirection des mails en recette.
- **Télétransmission et GED** : fournisseur, mode, identifiants (chiffrés en base), certificat.
- **Interdit en production** : la connexion de développement sans annuaire. Sa présence empêche volontairement le démarrage.

## 6. Exploitation courante

- **Démarrer** : « docker compose up -d ».
- **Arrêter** : « docker compose down » (les volumes et le stockage sont conservés).
- **Voir l'état** : « docker compose ps ».
- **Journaux** : « docker compose logs -f backend » (ou « frontend »).
- **Contrôle de santé** : « /api/status » et l'état des conteneurs.
- **Redémarrer le backend** : « docker compose restart backend ».

## 7. Sauvegarde et restauration

Sauvegarder ensemble, à fréquence régulière : la base de données (export du schéma applicatif), le dossier de stockage des fichiers, et la configuration (fichier d'environnement et polices).

La restauration consiste à recréer le schéma, restaurer l'export, remettre le dossier de stockage en place, puis redémarrer. La configuration applicative (référentiels, circuits, champs) peut aussi être exportée en JSON depuis l'administration (onglet Export / import) ; ce fichier ne contient ni mot de passe ni donnée personnelle.

## 8. Supervision et alertes

Surveiller la disponibilité du backend et des conteneurs, les redémarrages répétés (signe d'erreur de configuration ou de base), l'espace disque du stockage et de la base, les files d'attente et les échecs (IA, notifications, télétransmission), et les journaux d'audit pour les actions sensibles.

## 9. Gestion des migrations

Les migrations s'appliquent automatiquement au démarrage. Règles : ne jamais modifier une migration déjà appliquée (ajouter une nouvelle migration numérotée), garder une numérotation continue, et, en cas de divergence de somme de contrôle, ne pas forcer : restaurer la version attendue ou faire valider une correction du journal des migrations par l'administrateur de la base.

## 10. Mise à jour applicative

1. Prévenir les utilisateurs et, si besoin, passer en mode maintenance.
2. Sauvegarder base, stockage et configuration.
3. Récupérer la nouvelle version du code.
4. Reconstruire et redémarrer : « docker compose up -d --build ».
5. Vérifier les journaux, le contrôle de santé et une connexion de test.
6. En cas de problème, revenir à la version précédente et restaurer si nécessaire.

## 11. Incidents courants et résolutions

- **Le backend redémarre en boucle** : consulter les journaux. Causes fréquentes : variable interdite en production, origine autorisée manquante, base injoignable, migration divergente. Corriger la configuration puis redémarrer.
- **Erreur 502 sur le frontend** : le backend n'est pas démarré ou n'est pas sain ; vérifier l'état des conteneurs et les journaux du backend.
- **Connexion impossible** : vérifier l'accès à l'annuaire ou utiliser le compte de secours local ; vérifier la durée maximale de session.
- **Aucun mail envoyé** : vérifier la configuration mail et la redirection de test ; consulter les échecs dans les notifications.
- **Police manquante dans les PDF** : vérifier la présence des fichiers de police et le dossier configuré.
- **GED ou télétransmission en erreur** : tester la connexion depuis l'administration et vérifier le mode (simulation, test, production).
- **Recherche incomplète** : relancer la ré-indexation depuis l'administration (onglet Recherche).

## 12. Sécurité d'exploitation

Restreindre l'accès distant et l'accès au fichier d'environnement. Ne jamais exposer la base ni le backend directement sur Internet : seul le frontend (et l'espace élus en DMZ) est exposé. Renouveler les secrets et certificats avant expiration. Désactiver le compte de secours local en fonctionnement normal et le réserver aux incidents. Vérifier régulièrement les journaux d'audit et les comptes à privilèges.

## 13. Maintenance planifiée

Purge automatique des dossiers d'entraînement, rotation et archivage des journaux, vérification des sauvegardes par un test de restauration périodique, mise à jour des polices et des gabarits si nécessaire.

## 14. Contacts et escalade

- **Niveau 1 — Administrateur applicatif** : paramétrage, comptes, incidents fonctionnels.
- **Niveau 2 — Équipe d'exploitation (DSI)** : conteneurs, base, réseau, sauvegardes.
- **Niveau 3 — Éditeur / intégrateur** : anomalies applicatives, migrations, intégrations externes.

Consigner chaque incident : date, symptôme, action, résultat.

## 15. Listes de contrôle

- **Après une mise à jour** : conteneurs stables, santé correcte, connexion de test, PDF de contrôle, envoi de mail de test, connexions externes testées.
- **Avant une séance** : convocation envoyée, ordre du jour arrêté, documents disponibles pour les élus, cahier généré.
- **Avant une intervention lourde** : sauvegarde base, stockage et configuration ; fenêtre de maintenance annoncée.`;
}

const BUILDERS = { dat, dex };

function build(kind, vars) {
  const f = BUILDERS[kind];
  if (!f) throw new Error(`Document technique inconnu : ${kind}`);
  return f(vars).trim();
}

module.exports = { build, kinds: Object.keys(BUILDERS) };
