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

Ce document décrit l'architecture technique de VibeDélib : composants et versions, flux, base de données, stockage, interfaces avec les applications tierces, variables d'environnement, réseau et sécurité. Il s'adresse aux équipes techniques (DSI, intégration, exploitation) et sert de référence pour l'exploitation (voir le DEX) et les évolutions.

Périmètre couvert : rédaction et circuit de validation des actes, commissions, séances et ordre du jour, convocation et espace élus, tenue de séance et votes, contrôle de légalité, recherche, archivage GED et assistance IA.

Hors périmètre de cette version : signature électronique (mécanisme prévu, non branché), publication et recueil des actes, hébergement d'une autre collectivité avec annuaire distinct.

## 2. Vue d'ensemble

VibeDélib est une application web multi-organismes : une même installation sert plusieurs organismes (Ville, CCAS, autres) avec une isolation stricte des données.

- **Frontend agents** : application React servie par nginx, qui relaie l'API en interne ; un seul port est exposé.
- **Backend** : API REST Node.js et Express, porte les règles métier, le circuit, le rendu PDF et les traitements planifiés.
- **Base de données** : PostgreSQL 16, schéma dédié (par défaut « ivrydelib ») de la base partagée de la Ville.
- **Stockage de fichiers** : stockage local sur volume (annexes, logos, fonds de page) ; archivage GED Alfresco en option.
- **Espace élus** : application distincte exposée en DMZ, authentification par lien personnel.
- **Intégrations** : APM (AD, mail, SMS, IA), Hub DSI (RH, organisation, élus), S2LOW (contrôle de légalité), Alfresco (GED), Microsoft Teams (option), passerelle SMS.

## 3. Schéma des flux (paramétrage actuel)

Le schéma ci-dessous reflète le paramétrage déployé : un frontend nginx, un backend Node.js, une base PostgreSQL et le stockage local, complétés par les services externes activés.

- **Navigateur agent** -> **nginx** (frontend, port 5160) : service des fichiers statiques et relais du chemin d'API vers le backend.
- **nginx** -> **backend Node.js / Express** (port 3021) : API REST, règles métier, moteur de circuit, rendu PDF, ordonnanceur.
- **backend** -> **PostgreSQL 16** (schéma ivrydelib) : données métier, référentiels, journal d'audit, index de recherche plein texte.
- **backend** -> **stockage local** (volume ./backend/storage) : annexes PDF, logos et fonds de page.
- **backend** -> **APM** (HTTPS, en-tête X-API-KEY) : authentification AD, envoi des mails et SMS, IA interne.
- **backend** -> **Hub DSI** (HTTPS, clé dsk_) : organigramme RH, agents, élus de la Ville.
- **backend** -> **S2LOW** (HTTPS, certificat client) : télétransmission au contrôle de légalité.
- **backend** -> **Alfresco** (HTTPS, API REST v1) : archivage GED des documents de séance.
- **backend** -> **Microsoft Teams** (Graph, OAuth2) : création des réunions de commission (option).
- **Élu** -> **espace élus** (DMZ, port 5161) -> **backend** (liste blanche) : convocation, consultation des documents, annotations.

## 4. Architecture applicative

### 4.1 Backend

Application Node.js 22 en modules par domaine (routes, services, accès aux données), en CommonJS. Dépendances principales : Express 5, zod (validation), pg (PostgreSQL), jsonwebtoken (sessions), bcryptjs (compte de secours), pdf-lib et fontkit (rendu PDF), pdfjs-dist (extraction de texte pour la recherche), multer (dépôts), helmet, cors, express-rate-limit, pino (journaux), swagger-ui-express.

Chaque route déclare en un seul endroit sa politique d'accès, sa validation et sa documentation : une route ne peut pas exister sans être documentée. L'API est versionnée sous « /api/v1 » ; la documentation interactive est servie sur « /api-docs », le descriptif OpenAPI sur « /swagger.json » et le contrôle de santé sur « /api/status ».

Le backend porte l'authentification et les sessions, les organismes et les rôles, les référentiels, les actes et leurs textes suivis, le moteur de circuit, les notifications et relances, les commissions, les séances et l'ordre du jour, la tenue de séance et les votes, les convocations, l'espace élus, la télétransmission, la GED, la recherche plein texte, le rendu PDF et l'assistance IA.

### 4.2 Frontend agents

Application React 18 en TypeScript strict, construite par Vite 5 et stylée avec Tailwind 3 ; bibliothèques : react-router-dom, axios, lucide-react, tiptap (éditeur de texte), pdfjs-dist (visionneuse). Elle est servie en fichiers statiques par nginx 1.27, qui relaie le chemin d'API vers le backend : le navigateur ne parle qu'à un seul domaine, ce qui évite toute question de CORS. Les mêmes interfaces servent tous les profils ; les fonctions visibles dépendent des rôles et des droits.

### 4.3 Espace élus (DMZ)

Frontend distinct exposé dans une zone réseau démilitarisée. Il ne contient ni base de données ni secret. Les élus y accèdent par un lien personnel envoyé avec la convocation ; ils consultent les documents, les annotent et partagent leurs notes. Un nginx à liste blanche ne laisse passer que les appels nécessaires vers le backend.

### 4.4 Traitements planifiés

Un ordonnanceur interne déclenche périodiquement les relances et échéances, le suivi des statuts de télétransmission, la purge des dossiers d'entraînement, la synchronisation GED et l'indexation de la recherche. Il est activable par la variable SCHEDULER_ENABLED.

## 5. SGBD et données

- **SGBD** : PostgreSQL 16.
- **Base et schéma** : base partagée de la Ville ; schéma applicatif dédié, défini par DB_SCHEMA (par défaut « ivrydelib »).
- **Accès** : pilote node-postgres (pg), pool de connexions (DB_POOL_MAX, 10 par défaut), requêtes paramétrées.
- **Migrations** : fichiers SQL numérotés (0001_…sql), appliquées automatiquement au démarrage (AUTO_MIGRATE) ; chaque migration s'exécute dans sa transaction et sa somme de contrôle SHA-256 est vérifiée : une migration appliquée ne doit jamais être modifiée.
- **Cloisonnement** : chaque enregistrement métier porte un identifiant d'organisme ; une couche d'accès unique filtre selon les organismes autorisés de l'utilisateur ; la sécurité au niveau ligne (RLS_ENABLED) est une défense supplémentaire.
- **Recherche** : index plein texte (GIN) en configuration française, insensible aux accents.
- **Tables principales** : organismes, user_org_roles, agent_ref, ref_items, actes, deliberations, tracked_texts, annexes, files, comments, titulaires, groupes_valideurs, commissions, seances, ordre du jour, tenue de séance, convocations, elus, circuits, render_templates, champs_personnalises, transactions de télétransmission, GED, recherche et journal d'audit.
- **Fichiers** : stockés hors base (volume), référencés en base avec leur empreinte SHA-256 et leurs métadonnées (taille, nombre de pages, type).

## 6. Stockage des fichiers

- **Stockage local (par défaut)** : système de fichiers du conteneur, monté sur un volume (STORAGE_DIR, volume ./backend/storage). Contient les annexes PDF, les logos et les fonds de page des gabarits. Il se sauvegarde avec la base.
- **GED Alfresco (option)** : archivage des documents de séance (convocation, dossiers, cahier, procès-verbal, extraits du registre, accusés de réception). Deux modes : « simulation » (aucun serveur) ou « Alfresco » (API REST v1, authentification Basic avec un compte technique). Un document modifié devient une nouvelle version du même nœud ; VibeDélib reste la source de vérité et décide de ce qu'il faut synchroniser.

## 7. Interfaces et intégrations (API)

- **APM (API centrale de la Ville)** : base APM_API_URL, authentification par en-tête X-API-KEY (APM_API_KEY). Endpoints utilisés : POST /api/v1/ad/authenticate (authentification AD), GET /api/v1/ad/user, GET /api/v1/ad/search, POST /api/v1/mail/send, POST /api/v1/sms/send, POST /api/v1/ai/query, GET /api/v1/ai/models. Permissions APM requises : ad_auth, ad_read, ad_search, mail_send, IA.
- **Hub DSI (données Ville)** : base HUBDSI_API_URL, en-tête X-API-Key avec une clé dsk_ (HUBDSI_API_KEY). Endpoints utilisés : GET /api/admin/rh/services-tree, GET /api/admin/rh/organisation-chart, GET /api/infra/rh-studio/agents/search, GET /api/infra/agents/presence, GET /api/ville/elus, GET /api/ville/config.
- **S2LOW (contrôle de légalité)** : HTTPS avec certificat client P12 et identifiant technique ; module ACTES. Tant que l'accès réel n'est pas obtenu, un simulateur reproduit les échanges.
- **Alfresco (GED)** : HTTPS, API REST v1 (/alfresco/api/-default-/public/alfresco/versions/1), authentification Basic avec un compte technique ; test de connexion via GET /alfresco/api/discovery.
- **Microsoft Teams** : OAuth2 (client credentials) sur login.microsoftonline.com, puis API Graph (graph.microsoft.com/v1.0) pour créer les réunions de commission.
- **Passerelle SMS** : POST JSON vers l'URL configurée, jeton en en-tête Authorization (Bearer), corps défini par un modèle.
- **Légifrance (option)** : vérification des textes en vigueur.

Toutes les communications sortantes passent par un client HTTP commun (délais, reprise, certificat de l'autorité via VILLE_CA_FILE). Aucune URL ni clé n'est écrite dans le code : tout provient de l'environnement ou du paramétrage chiffré.

## 8. Variables d'environnement

Les valeurs sensibles ne figurent pas ici ; elles sont fournies par l'environnement de chaque déploiement.

- **Application** : NODE_ENV, PORT (3021), PUBLIC_BASE_URL, CORS_ORIGINS, TRUST_PROXY, LOG_LEVEL, SCHEDULER_ENABLED.
- **Base de données** : POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, DB_POOL_MAX, DB_SCHEMA, AUTO_MIGRATE, RLS_ENABLED.
- **Session et sécurité** : JWT_SECRET, JWT_TTL, SESSION_MAX_HOURS, BOOTSTRAP_ADMINS, LOCAL_ADMIN_ENABLED, LOCAL_ADMIN_USERNAME, LOCAL_ADMIN_PASSWORD.
- **Services externes** : APM_API_URL, APM_API_KEY, HUBDSI_API_URL, HUBDSI_API_KEY, VILLE_CA_FILE, VILLE_ALLOW_SELF_SIGNED_CERTS.
- **Stockage et fichiers** : STORAGE_DIR, MAX_UPLOAD_MB, FONTS_DIR.
- **Mail et annuaire** : MAIL_REDIRECT_TO, EMAIL_DOMAIN, DIRECTORY_CACHE_TTL_MIN.
- **Réunions Teams** : GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, TEAMS_ORGANIZER_UPN.
- **Espace élus** : ANNOTATIONS_KEY.
- **Organisme** : DEFAULT_ORGANISME_NAME.
- **Interdit en production** : DEV_LOGIN_PASSWORD (connexion de développement sans annuaire) ; sa présence empêche volontairement le démarrage.

Le paramétrage fonctionnel (SIREN, télétransmission, GED, IA, espace élus, notifications) est stocké en base, par organisme, et modifiable depuis l'administration ; les identifiants de connexion aux tiers y sont chiffrés au repos.

## 9. Réseau, exposition et sécurité

- **Ports** : frontend 5160 (nginx 80 dans le conteneur), backend 3021, espace élus en DMZ 5161.
- **Exposition** : seul le frontend (et l'espace élus en DMZ) est exposé ; la base et le backend ne sont pas exposés directement.
- **Relais d'API** : nginx relaie le chemin d'API vers le backend, ce qui rend l'appel de même origine et supprime le CORS pour le navigateur. Le CORS du backend reste restreint aux origines connues (CORS_ORIGINS), jamais l'étoile.
- **Transport** : HTTPS assuré par le reverse-proxy de la collectivité ; certificat de l'autorité interne pris en compte pour les appels sortants.
- **Authentification** : agents par l'annuaire AD via l'APM, puis jeton de session JWT signé (HS256), à durée de vie bornée et session révocable ; élus par lien personnel et code à usage unique ; compte de secours local haché (bcrypt) pour les incidents.
- **Autorisation** : rôles par organisme ; fonctions de validation résolues par le circuit ; isolation stricte entre organismes ; le mode « afficher en tant que » est réservé et revérifié à chaque requête.
- **Protections** : en-têtes de sécurité (helmet), limitation de débit, validation systématique des entrées (zod), requêtes SQL paramétrées, aucune donnée sensible exposée au navigateur.
- **Audit** : toute action significative est journalisée (qui, quoi, quand).

## 10. Performance et disponibilité

- Le rendu PDF est mis en cache par empreinte du contenu et de la version du gabarit.
- La recherche s'appuie sur l'index plein texte de PostgreSQL.
- Les traitements longs (IA, génération du cahier, envoi des convocations) s'exécutent en arrière-plan et l'utilisateur est notifié.
- Les conteneurs redémarrent automatiquement ; le backend expose un contrôle de santé utilisé par Docker.
- Les pools de connexions et les délais d'appel aux services externes sont bornés.

## 11. Prérequis et dépendances

- Node.js 22 (backend et construction du frontend).
- PostgreSQL 16 accessible, avec un schéma dédié.
- nginx 1.27 pour le service statique et le relais d'API.
- Docker et Docker Compose pour le déploiement.
- Accès réseau aux services externes utilisés, et un certificat client pour S2LOW si la télétransmission réelle est activée.
- Un volume persistant pour le stockage et un accès en lecture aux polices sous licence.

## 12. Environnements et déploiement

Trois environnements peuvent coexister : développement, recette et production. La configuration est entièrement portée par des variables d'environnement, par environnement. Le déploiement s'appuie sur Docker Compose ; la procédure détaillée, les sauvegardes et les incidents courants sont décrits dans le Dossier d'Exploitation (DEX).

## 13. Traçabilité et audit

Chaque acte, chaque étape du circuit et chaque action d'administration laisse une trace horodatée et attribuée. Les modifications de texte sont suivies (auteur, date, couleur). Le journal de preuve des convocations enregistre envois, ouvertures et réponses ; les adresses IP ne sont conservées que sous forme d'empreinte.

## 14. Évolutions et points d'extension

L'architecture accueille sans refonte la signature électronique (port dédié), la publication et le recueil des actes, de nouveaux organismes, d'autres tiers de télétransmission, d'autres fournisseurs de GED et d'autres modèles d'IA. Les circuits, référentiels, champs et gabarits sont des données : ils se paramètrent sans modification de code.

## 15. Glossaire

- **Acte / dossier** : ensemble fiche, exposé, délibérations, annexes et discussion.
- **Circuit** : suite d'étapes de validation d'un acte.
- **ODJ** : ordre du jour d'une séance.
- **DMZ** : zone réseau exposée où tourne le frontend des élus.
- **GED** : gestion électronique des documents (ici Alfresco).
- **TDT** : télétransmission au contrôle de légalité.
- **RLS** : sécurité au niveau ligne de PostgreSQL.
- **SCC** : Service Conseil et Contentieux.`;
}

function dex(v) {
  return `# Dossier d'Exploitation (DEX)

Application VibeDélib. Édition du ${v.date}. Version applicative : ${v.version}. Environnement : ${v.env}.

## 1. Objet et public

Ce dossier décrit l'exploitation courante de VibeDélib : installation, configuration, sauvegardes, supervision, mises à jour et incidents. Il s'adresse à l'équipe d'exploitation (DSI) et à l'administrateur applicatif.

## 2. Inventaire des composants

- **Backend** : API Node.js 22, port interne 3021 ; redémarre toujours ; contrôle de santé sur /api/status.
- **Frontend** : nginx 1.27 et fichiers statiques React, port 5160 sur l'hôte.
- **PostgreSQL 16** : base partagée de la Ville ; un conteneur local facultatif existe pour le développement.
- **Espace élus (DMZ)** : conteneur distinct, port 5161, déployé séparément.
- **Volumes** : dossier de stockage (annexes, logos, fonds) et dossier des polices sous licence en lecture seule.

## 3. Prérequis

- Docker et Docker Compose.
- PostgreSQL 16 accessible et un schéma dédié.
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

La sauvegarde est intégrée à l'application (menu Paramétrages, onglet « Sauvegarde », réservé à l'administrateur de la plateforme) : chaque nuit à l'heure choisie, la base est exportée de façon cohérente puis copiée avec les fichiers du stockage local vers un dossier réseau. Aucun outil externe n'est nécessaire sur le serveur.

- **Destination** : chemin réseau Windows (UNC) avec identifiant et mot de passe saisis dans l'application (mot de passe chiffré, jamais sur une ligne de commande), lecteur monté ou dossier local. Un bouton teste l'accès.
- **Contenu** : une table par fichier compressé, un schéma, un manifeste avec les empreintes ; les fichiers locaux sont copiés de façon incrémentale. Les fichiers stockés dans la GED sont sauvegardés par la GED.
- **Rétention** : les sauvegardes plus anciennes que la durée choisie sont supprimées uniquement après une nouvelle sauvegarde réussie.
- **Suivi** : chaque sauvegarde est journalisée (durée, volume, statut, erreur) ; un échec est consigné dans le journal d'audit.
- **Restauration** : script « restaurer-sauvegarde » qui recrée le schéma, recharge les données et contrôle les nombres de lignes ; à essayer d'abord dans un schéma vide de test. Après restauration : pointer le schéma, recopier les fichiers, redémarrer, ré-indexer la recherche.

Conserver en plus la configuration (fichier d'environnement et polices). Vérifier régulièrement la sauvegarde par un test de restauration.

## 8. Supervision et alertes

Surveiller la disponibilité du backend et des conteneurs, les redémarrages répétés (signe d'erreur de configuration ou de base), l'espace disque du stockage et de la base, les files d'attente et les échecs (IA, notifications, télétransmission), et les journaux d'audit pour les actions sensibles.

## 9. Gestion des migrations

Les migrations s'appliquent automatiquement au démarrage. Règles : ne jamais modifier une migration déjà appliquée (ajouter une nouvelle migration numérotée), garder une numérotation continue, et, en cas de divergence de somme de contrôle, ne pas forcer : restaurer la version attendue ou faire valider une correction du journal des migrations par l'administrateur de la base. Les fichiers de migration doivent conserver des fins de ligne identiques sur tous les postes (voir .gitattributes).

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
- **Avant une intervention lourde** : lancer « Sauvegarder maintenant », vérifier son succès dans le journal, sauvegarder la configuration ; fenêtre de maintenance annoncée.`;
}

const BUILDERS = { dat, dex };

function build(kind, vars) {
  const f = BUILDERS[kind];
  if (!f) throw new Error(`Document technique inconnu : ${kind}`);
  return f(vars).trim();
}

module.exports = { build, kinds: Object.keys(BUILDERS) };
