# MCD AIRS Delib — analyse de la base Oracle d'origine

> Document de capitalisation de l'analyse du schéma de la base **Oracle AIRS Delib** (ancien logiciel
> de gestion des actes, éditeur **Digitech**, à remplacer par VibeDélib).
> Il sert de base au module d'import **`airs_*`** (sas / concordances / publication), section 25 bis et
> décision **D111** du `MANIFEST.md`, et répond aux questions **Q-AIRS2** (liste des tables + MCD),
> **Q-AIRS3** (identifiants stables) et **Q-AIRS6** (référentiels).
>
> Analyse réalisée **en lecture seule** (`SELECT` uniquement) sur la base de production.
> **Aucune écriture, aucun DDL, aucun commit** n'a été effectué sur Oracle.

## 0. Accès à la base

| Paramètre | Valeur |
|---|---|
| Hôte / port / service | `oracle02:1524/PAIRS` (prod) — test : `oracle01:1524/TAIRS` |
| Schémas | `AIRSUSER` (socle + GED), `DELIBUSER` (métier délibérations), `FLOWUSER` (workflow) |
| Version applicative | AIRS Delib **6.1.1** (`PARAM_DELIB` : `DELIB_VERBDD=6.1.1`) |
| Identifiants | stockés dans `C:\dev\delib\.env.airs` (fichier **ignoré par git**, `AIRS_ORACLE_*`) |

> ⚠️ **Lecture seule.** Toutes les requêtes d'exploration passent par des vues dictionnaire
> (`ALL_TABLES`, `ALL_TAB_COLUMNS`, `ALL_CONSTRAINTS`, `ALL_CONS_COLUMNS`, `ALL_COL_COMMENTS`) ou par
> des `SELECT`. Le module d'import doit se connecter avec un compte **SELECT seulement** (idéalement un
> utilisateur dédié, pas `SYSTEM`).

---

## 1. Vue d'ensemble des schémas

| Schéma | Nb tables | Rôle | Utilité pour la reprise |
|---|---|---|---|
| **DELIBUSER** | 97 | Cœur métier « délibérations » : séances, rapports, délibérations, votes, commissions, élus, types d'assemblée, référentiels. | **Indispensable** (relations et clés). |
| **AIRSUSER** | 159 | Socle applicatif **AIRS** : GED documentaire (`DOCUMENT`, `DOCVERSION`, `FIC_PRIMAIRE`), personnes (`PERSON`, `USERS`), organisation (`ORGANIZATION`), droits/profils, lexiques. Contient aussi les **extensions documentaires métier** `DOC_DEL_*` (métadonnées des séances/rapports/délibérations/annexes) et l'**historique** `DOC_DEL_ARCHIVE`. | **Indispensable** (métadonnées `DOC_DEL_*`, fichiers, organisation, agents). |
| **FLOWUSER** | 54 | Moteur de workflow (`FM_*`). | Non nécessaire pour la reprise d'historique (état des circuits). |

**Convention structurante du MCD** : dans AIRS, tout objet métier (séance, rapport, délibération,
annexe) est aussi un **document GED**. La table `AIRSUSER.DOCUMENT` porte l'identité (`DOC_ID`) et le
type (`CTY_ID`), et une table d'extension `AIRSUSER.DOC_DEL_<type>` porte les attributs métier, **clé
= `DOC_ID`**. Les tables relationnelles de `DELIBUSER` réutilisent **le même identifiant** :

```
DELIBUSER.SEANCE.SEA_ID   = AIRSUSER.DOC_DEL_SEANCE.DOC_ID
DELIBUSER.PROJET_RAPPORT.RAP_ID = AIRSUSER.DOC_DEL_RAPPORT.DOC_ID
DELIBUSER.PROJET_DELIB.DEL_ID   = AIRSUSER.DOC_DEL_DELIB.DOC_ID
DELIBUSER.ANNEXE.ANN_ID         = AIRSUSER.DOC_DEL_ANNEXE.DOC_ID
```

Vérifié en base : `SEANCE` 13/13, `PROJET_RAPPORT` 560/560, `PROJET_DELIB` 668/669, `ANNEXE` 865/865
appariés par `DOC_ID`.

`AIRSUSER.CONTENT_TYPE` donne le type de document (`DOC_DEL_SEANCE`, `DEL_RAPPORT`, `DEL_DELIB`,
`DEL_ANNEXE`, `DEL_ARCHIVE`, `DEL_COMMENT`…). `DOCUMENT.DOC_ISDELETED=1` marque les documents
supprimés (à exclure).

---

## 2. MCD — entités et relations

### 2.1 Représentation simplifiée

```
                         ┌───────────────────┐
                         │ TYPE_ASSEMBLE     │  instance (CM, décision, arrêté)
                         │ TAS_ID, TAS_LABEL │
                         └─────────┬─────────┘
                                   │ TAS_ID
        ┌──────────────┐           │
        │ ELU_DESTIN.  │           │
        │ ELD_ID       │──┐        │
        └──────┬───────┘  │  ┌─────┴──────────┐        ┌────────────────┐
               │ELD_ID    │  │ SEANCE         │◄───────┤ DOC_DEL_SEANCE │
               │          │  │ SEA_ID         │ 1:1    │ DOC_ID=SEA_ID  │
               │          │  │ ELD_ID(presid) │        └────────────────┘
               │          │  │ TAS_ID, FIR_ID │
               │          │  └───────┬────────┘
               │          │          │ SEA_ID
               │          │  ┌───────▼────────┐   N   ┌───────────────┐
               │          │  │ ODJ_SEANCE     │◄──────┤ PROJET_RAPPORT│◄── DOC_DEL_RAPPORT
               │          │  │ SEA_ID,RAP_ID  │       │ RAP_ID        │     (DOC_ID=RAP_ID)
               │          │  └────────────────┘       │ SEA_ID,ORG_ID │
               │          │                           │ ELD_ID,USR_ID │
               │          │                           │ COM_ID,ACT_ID │
               │          │                           │ TIN_ID,ORJ_ID │
               │          │                           └───┬───────┬───┘
               │          │                               │RAP_ID │RAP_ID
               │          │                     ┌─────────┘       └──────────┐
               │          │              ┌──────▼───────┐            ┌───────▼────────┐
               │          │              │ ANNEXE       │            │ FAST_RAPPORT_  │
               │          │              │ ANN_ID       │            │ CLASSIF RAP_ID │
               │          │              └──────┬───────┘            │ CODENATURE     │
               │          │                     │                    │ CODEMATIERE    │
               │          │                     │ANN_ID              └────────────────┘
               │          │              ┌──────▼────────┐
               │          │              │ ANNEXE_DELIB  │
               │          │              │ ANN_ID,DEL_ID │
               │          │              └───────────────┘
               │          │                     ▲
               │          │  ┌──────────────────┴──┐        ┌────────────────┐
               │          └─►│ PROJET_DELIB        │◄───────┤ DOC_DEL_DELIB  │
               │             │ DEL_ID              │ 1:1    │ DOC_ID=DEL_ID  │
               │             │ RAP_ID, ELD_ID_PRES │        └────────────────┘
               │             └──────────┬──────────┘
               │                        │ DEL_ID
               │             ┌──────────▼──────────┐        ┌────────────────┐
               │             │ VOTE                │        │ FEUILLE_VOTE   │
               │             │ VOT_ID              │───────►│ FVO_ID         │
               │             │ ELD_ID, DEL_ID      │        │ SEA_ID, COM_ID │
               │             │ VOT_RESULTAT/PRESENT│        └────────────────┘
               │             └─────────────────────┘
               │
       ┌───────┴───────────────┐        ┌────────────────────┐
       │ ELU_FONCTION          │        │ ELU_TYPE_ASSEMBLE  │
       └───────────────────────┘        └────────────────────┘

   ┌────────────────────────────────────────────────────────────────────────────┐
   │ Référentiels transverses : COMMISSION (COM_ID), ORGANIZATION (ORG_ID),     │
   │ USERS (USR_ID, agent), PERSON, TYPE_ARCHIVE (ACTE/RAPPORT/SEANCE),         │
   │ TYPE_ANNEXE, PARAM_DELIB (config + modèles de numérotation).              │
   └────────────────────────────────────────────────────────────────────────────┘

   Reprise de l'historique : AIRSUSER.DOC_DEL_ARCHIVE (DOC_ID) = vue aplatie
   (union RAP_* + SEA_* + DDE_*) d'un acte archivé, avec ARC_TYPE ∈ {Delib, Rapport, Seance}.
```

### 2.2 Entités et cardinalités

| Entité | Table(s) | Identifiant | Rôle |
|---|---|---|---|
| **Instance / type d'assemblée** | `TYPE_ASSEMBLE` (`TAS_ID`), `TYPE_ARCHIVE` | `TAS_LABEL` (`conseil municipal`, `decision municipale`, `arrete municipal`) | Instance de séance (axe `instance`). |
| **Séance** | `SEANCE` (`SEA_ID`) + `DOC_DEL_SEANCE` | `SEA_ID = DOC_ID` | Date, heure, lieu, intitulé, type (Ordinaire/Extra-ordinaire), président, état. |
| **Rapport / affaire** | `PROJET_RAPPORT` (`RAP_ID`) + `DOC_DEL_RAPPORT` | `RAP_ID = DOC_ID` | Dossier soumis : titre, direction, service, rapporteur élu, rédacteur agent, rubrique, résultat. |
| **Délibération / acte** | `PROJET_DELIB` (`DEL_ID`) + `DOC_DEL_DELIB` | `DEL_ID = DOC_ID` | Acte adopté : titre, résultat, compteurs de voix, date de vote, numéro. **N rapports → N actes** (sous-articles A/B/C). |
| **Annexe** | `ANNEXE` (`ANN_ID`) + `DOC_DEL_ANNEXE` ; lien acte `ANNEXE_DELIB` | `ANN_ID = DOC_ID` | Pièces jointes (fichiers). |
| **Vote nominatif** | `VOTE` (`VOT_ID`) ; `FEUILLE_VOTE` (`FVO_ID`) | `VOT_ID` | 1 ligne = 1 élu pour 1 délibération (présent/procuration/suppléant + résultat). |
| **Commission** | `COMMISSION` (`COM_ID`), `AVIS_COMMISSION`, `COMMISSION_ELU_DESTINATAIRE` | `COM_ID` | Axe `commission`, avis. |
| **Élu / destinataire** | `ELU_DESTINATAIRE` (`ELD_ID`) | `ELD_ID` | Élus (nom, prénom, titre, courriel). Axe `elu`. |
| **Agent (rédacteur/instructeur)** | `USERS` (`USR_ID`) → `PERSON` (`PER_ID`) | `USR_LOGIN` | Axe `agent`. |
| **Direction / service** | `ORGANIZATION` (`ORG_ID`, `TOR_ID`, `ORG_FATHER_ID`) | `ORG_CODE` | Hiérarchie DGA (TOR=1) / directions (TOR=2) / services (TOR=5). Axes `direction`, `service`. |
| **Rubrique** | `DOC_DEL_RAPPORT.RAP_RUB` (texte libre) | — | 31 valeurs rencontrées (cf. `RUBRIQUES`). Axe `rubrique`. |
| **Nature / Matière** | `FAST_RAPPORT_CLASSIF` (`RAP_ID`, `CODENATURE`, `CODEMATIERE`) | codes | Classification par rapport. Axes `nature`, `matiere`. |
| **Ordre du jour** | `ODJ_SEANCE` (`SEA_ID`, `RAP_ID`, `RAP_ORDER`, `ODJ_TYPE`) | — | Position d'un rapport dans une séance. |

---

## 3. Schéma `DELIBUSER` — tables à importer

À lire par zones. PK/FK issues du dictionnaire Oracle ; volumétrie = compte exact au moment de l'analyse.

### 3.1 Séances, rapports, actes, votes

| Table | PK | FK principales | Lignes | Commentaire |
|---|---|---|---|---|
| `SEANCE` | `SEA_ID` | `TAS_ID`→`TYPE_ASSEMBLE`, `ELD_ID`→`ELU_DESTINATAIRE`, `FIR_ID`→`FIELD_REPORT` | 13 | Séances courantes (2025‑2026). |
| `PROJET_RAPPORT` | `RAP_ID` | `SEA_ID`, `ORG_ID`→`ORGANIZATION`, `ELD_ID`, `USR_ID`→`USERS`, `COM_ID`, `ACT_ID`, `TIN_ID`, `ORJ_ID` | 560 | Rapports/dossiers. |
| `PROJET_DELIB` | `DEL_ID` | `RAP_ID`→`PROJET_RAPPORT`, `ELD_ID_PRESIDENT` | 669 | Actes (plusieurs par rapport possibles). |
| `ODJ_SEANCE` | *(pas de PK)* | `SEA_ID`, `RAP_ID` | 5052 | Ordre du jour / ordre de passage (47 séances, 2017‑2026). |
| `ANNEXE` | `ANN_ID` | `RAP_ID`→`PROJET_RAPPORT` | 865 | Annexes rattachées au rapport. |
| `ANNEXE_DELIB` | `ANN_ID`+`DEL_ID` | `ANN_ID`, `DEL_ID` | 0 | Lien annexe↔acte (vide ici). |
| `VOTE` | `VOT_ID` | `DEL_ID`, `ELD_ID`, `ELD_ID_PROCURATION`, `ELD_ID_SUPPLEANT`, `FVO_ID` | 25 395 | Votes nominatifs (2025‑2026, 520 actes). |
| `FEUILLE_VOTE` | `FVO_ID` | `SEA_ID`, `COM_ID`, `ELD_ID` | 1 | Synthèse « feuille de vote ». |
| `FAST_RAPPORT_CLASSIF` | `RAP_ID` | *(clé = `RAP_ID` du rapport)* | 560 | **Classification nature/matière** d'un rapport. |
| `DOSSIER_EXT` | `DEX_ID` | `TDX_ID`, `IEX_ID` | 1087 | Dossiers externes (hors périmètre actes). |

### 3.2 Instances, commissions, élus, agents

| Table | PK | FK | Lignes | Commentaire |
|---|---|---|---|---|
| `TYPE_ASSEMBLE` | `TAS_ID` | `FIR_ID`, `TAR_*` | 3 | `conseil municipal`, `decision municipale`, `arrete municipal`. |
| `TYPE_ARCHIVE` | `TAR_ID` | — | 6 | Types d'archives (`ACTE`/`RAPPORT`/`SEANCE`). |
| `COMMISSION` | `COM_ID` | `ORG_ID`→`ORGANIZATION` | 11 | `COM_LABEL`, `COM_NUM_ROMAIN`. |
| `AVIS_COMMISSION` | `AVC_ID` | `COM_ID`, `RAP_ID`, `ACT_ID` | 21 | Avis de commission. |
| `AVIS_COMMISSION_TYPE` | `ACT_ID` | — | 3 | Avis favorable / défavorable / saisie libre. |
| `COMMISSION_ELU_DESTINATAIRE` | `COM_ID`+`ELD_ID`+`CER_ID` | `COM_ID`, `ELD_ID`, `CER_ID` | 76 | Composition des commissions. |
| `ELU_DESTINATAIRE` | `ELD_ID` | — | 120 | Élus : `ELD_NOM`, `ELD_PRENOM`, `ELD_TITRE`, `ELD_EMAIL`, `ELD_ACTIF`. |
| `ELU_FONCTION` | `ELF_ID` | `MOD_SEANCE`, `MOD_COM` | 13 | Fonctions d'élu. |
| `ELU_TYPE_ASSEMBLE` | `ELD_ID`+`TAS_ID` | `ELD_ID`, `TAS_ID` | 87 | Élus par instance. |
| `UTILISATEUR` | `UTI_ID` | `USR_ID`→`USERS`, `ELD_ID` | 3 | Table peu utilisée (3 lignes) : les agents sont dans `AIRSUSER.USERS`. |
| `DESTINATAIRE_FONCTION` | *(pas de PK)* | `ELF_ID`, `ELD_ID`, `TAS_ID` | 51 | Fonctions des destinataires. |

### 3.3 Référentiels et configuration

`TYPE_INCIDENCE` (2) — incidences financières (`Voirie`, `Budget`), `TIN_ID` jamais renseigné sur les
rapports ; `TYPE_ANNEXE` (2) ; `TYPE_DOSSIER_EXT` (6) ; `TYPE_HISTO` (2) ; `ROLEDELIB`/`DROIT` (droits,
hors périmètre) ; `MODELE*` (modèles de documents) ; `PARAM_DELIB` (250 paramètres, dont les **modèles
de numérotation** `CONSEIL_MUNICIPAL_NUM_DELIB = "DEL%MM%%YYYY%_%3NUMCHRONO%"`, `ARRETE_MUNICIPAL_NUM_DELIB`,
etc.) ; `VARIABLE`/`MODVAR` ; `ENUM_TYPE` ; `FIELD_REPORT` (14, champs dynamiques par instance).

### 3.4 Liste complète `DELIBUSER` (97 tables, PK et volumétrie)

<details>
<summary>Déplier l'inventaire complet</summary>

```
ANNEXE (ANN_ID) [865]
ANNEXE_DELIB (ANN_ID+DEL_ID) [0]
ANNEXE_DOSSIER_EXT (DEX_ID+ANN_ID) [0]
ANNEXE_SECRET (ANN_ID) [0]
ASSEMBLEE_CORPS_DOCUMENT (CDO_ID+TAS_ID) [6]
ASSEMBLEE_MODELE (TAS_ID+CDO_ID+TYPE_RAP+MOD_ID) [14]
AVIS_COMMISSION (AVC_ID) [21]
AVIS_COMMISSION_TYPE (ACT_ID) [3]
CALENDRIER_COMMISSION (SEA_ID+COM_ID) [65]
COL_INCIDENCE (CIN_ID) [0]
COMMISSION (COM_ID) [11]
COMMISSION_ELU_DESTINATAIRE (COM_ID+ELD_ID+CER_ID) [76]
COMMISSION_ELU_ROLE (CER_ID) [3]
COMMISSION_PROJET_RAPPORT (COM_ID+RAP_ID) [0]
COMMISSION_SEANCE (COM_ID+SEA_ID) [0]
COMMISSION_TYPE_ASSEMBLE (COM_ID+TAS_ID) [5]
CONNECTEUR_INTERFACE_EXT (CRI_ID) [2]
CUSTOM_ACTIONS (CAC_ID) [0]
DESTINATAIRE_FONCTION (-) [51]
DOCUMENT_BODY_SOURCE (TAS_ID) [3]
DOCUMENT_GROUP (DOG_ID) [0]
DOSSIER_EXT (DEX_ID) [1087]
DROIT (DRO_ID) [28]
DROIT_ROLEDELIB (DRO_ID+ROL_ID) [55]
DROIT_UTILISATEUR (DRO_ID+UTI_ID) [0]
EDELIB_DELIB_ANNEXES (DEL_ID+ANN_ID) [0]
EDELIB_ENV_TRAITEES (ENV_ID) [0]
EDELIB_HISTORY (-) [0]
ELU_CHAMP_SUP (ELC_ID) [0]
ELU_CHAMP_SUP_VAL (ELD_ID+ELC_ID+ELC_VALUE) [0]
ELU_DELIB (-) [0]
ELU_DESTINATAIRE (ELD_ID) [120]
ELU_FONCTION (ELF_ID) [13]
ELU_SUPPLEANT (-) [0]
ELU_TYPE_ASSEMBLE (ELD_ID+TAS_ID) [87]
ENUM_TYPE (ENUM_TYPE+ENUM_CODE) [4]
ETATS_STAT (ETAT_ID) [1]
FASTDATA (DEL_ID) [0]
FASTPARAM (PARAM_NAME) [1]
FAST_RAPPORT_CLASSIF (RAP_ID) [560]
FEUILLE_VOTE (FVO_ID) [1]
FIELD_REPORT (FIR_ID) [14]
FIELD_REPORT_MODEL (-) [0]
FIELD_TYPE_ASSEMBLE (FIR_ID+TAS_ID) [16]
GROUP_ANNEXE (GAN_ID) [1]
GROUP_ANNEXE_TYPE_ASSEMBLE (-) [0]
GROUP_TYPE_MODELE (DOG_ID+MOD_TYPE) [0]
HISTO_DOSSIER_EXT (HDX_ID) [0]
INFOS_COMMISSION (INF_ID) [0]
INTERFACE_EXT (IEX_ID) [3]
MODELE (MOD_ID) [25]
MODELE_ELU (-) [0]
MODELE_FONCTION (ELF_ID+TAS_ID+MOF_TYPE) [12]
MODELE_MODELE (MMO_ID) [0]
MODELE_PROFIL (MOD_ID+PRO_ID) [20]
MODELE_ROLEWF (ROL_ID+MOD_ID) [2]
MODELE_SEANCE (-) [104]
MODELE_UTILISATEUR (-) [0]
MODVAR (MOD_ID+VAR_ID) [2]
ODJ_SEANCE (-) [5052]
ORDRE_JOUR (ORJ_ID) [0]
ORGANISATION (ORG_ID) [0]
ORGANISATION_UTILISATEUR (ORG_ID+UTI_ID) [0]
OWNER_INTERFACE (OWN_ID) [7]
OWNER_INTERFACE_EXT (IEX_ID+OWN_ID) [1]
PARAM_DELIB (PAR_ID) [250]
PARAM_INTERFACE (PIE_ID) [66]
PARAM_OWNER_TYPE (PIE_ID+OWN_ID+TIE_ID) [0]
PROJET_DELIB (DEL_ID) [669]
PROJET_RAPPORT (RAP_ID) [560]
RECAP_INCIDENCE (RIN_ID) [0]
ROLEDELIB (ROL_ID) [10]
SEANCE (SEA_ID) [13]
TIERS (TIE_ID) [0]
TIERS_RAPPORT (TIR_ID) [0]
TYPE_ANNEXE (TAN_ID) [2]
TYPE_ANNEXE_LABEL_TYPE_ASS (TAN_ID) [0]
TYPE_ANNEXE_TYPE_ASSEMBLE (TAS_ID+TAN_ID) [6]
TYPE_ANNEXE_TYPE_ASS_SEANCE (TAN_ID+TAS_ID) [0]
TYPE_ANN_TYPE_ASS_PRINT (-) [1]
TYPE_ARCHIVE (TAR_ID) [6]
TYPE_ASSEMBLE (TAS_ID) [3]
TYPE_COL_INCIDENCE (TCI_ID) [5]
TYPE_CORPS_DOCUMENT (CDO_ID) [2]
TYPE_DOSSIER_EXT (TDX_ID) [6]
TYPE_HISTO (THI_ID) [2]
TYPE_INCIDENCE (TIN_ID) [2]
TYPE_INCIDENCE_PROJET_RAPPORT (TIN_ID+RAP_ID) [0]
TYPE_INCIDENCE_TYPE_ANNEXE (TANN_ID) [0]
TYPE_INCIDENCE_TYPE_ASS (TIN_ID+TAS_ID) [6]
TYPE_INTERFACE_EXT (TIE_ID) [5]
TYPE_ORGANISATION (TOR_ID) [2]
UTILISATEUR (UTI_ID) [3]
UTILISATEUR_ROLEDELIB (UTI_ID+ROL_ID) [0]
VAL_INCIDENCE (VIN_ID) [0]
VARIABLE (VAR_ID) [10]
VOTE (VOT_ID) [25395]
```
</details>

> `DELIBUSER.ORGANISATION` est **vide** : la hiérarchie réelle est dans `AIRSUSER.ORGANIZATION`.

---

## 4. Schéma `AIRSUSER` — tables utiles

### 4.1 Extensions documentaires métier (`DOC_DEL_*`)

Ces tables portent les **libellés métier** (les tables `DELIBUSER` ne contiennent souvent que des clés).

| Table | PK | Lignes | Colonnes clés |
|---|---|---|---|
| `DOC_DEL_SEANCE` | `DOC_ID` | 13 | `SEA_DT_DEBUT`, `SEA_DT_FIN`, `SEA_HEURE_DEBUT/FIN`, `SEA_ASSEMBLEE`, `SEA_TYPE`, `SEA_PRESIDENT`, `SEA_LIEU`, `SEA_INTITULE`, `SEA_NUMERO`, `SEA_CLOTUREE`, `SEA_WORKFLOW`, `SEA_EDELIB_NATURE/MATIERE`. |
| `DOC_DEL_RAPPORT` | `DOC_ID` | 562 | `RAP_TITRE`, `RAP_DIRECTION`, `RAP_SERVICE`, `RAP_RAPPORTEUR`, `RAP_INSTRUCTEUR`, `RAP_RUB`, `RAP_TYPE`, `RAP_RESULTAT`, `RAP_INCIDENCE`, `RAP_NUM_SUIVI`, `RAP_NUM_CHRONO`, `RAP_DATE_DEC`, `RAP_DATE_ACTE`, `RAP_MONTANT`. |
| `DOC_DEL_DELIB` | `DOC_ID` | 926 | `DDE_TITRE`, `DDE_RESULTAT`, `DDE_NB_OUI/NON/ABSTENTI/NONPARTI`, `DDE_VOTE_SECRET`, `DDE_NUMERO`, `DDE_RACINE_NUMERO`, `DDE_SOUS_NUMERO`, `DDE_NUM_SUIVI_DEFINITIF`, `DDE_DT_VOTE`, `DDE_HEURE_VOTE`, `DDE_ENVOI_LEGA`, `DDE_RETOUR_LEGA`, `DDE_ID_ACTE_EDELIB`. |
| `DOC_DEL_ANNEXE` | `DOC_ID` | 2967 | `ANN_LIBELLE`, `ANN_TYPE`, `ANN_AUTEUR`, `ANN_FICHIER`, `ANN_NB_PAGE`, `ANN_ORDRE`, `ANN_GROUP`, `ANN_TYPE_PJ_NATURE`. |
| `DOC_DEL_ARCHIVE` | `DOC_ID` | 1888 | **Vue aplatie** `ARC_TYPE` + `ARC_SUBTYPE` + `DDE_*` + `RAP_*` + `SEA_*`. |
| `DOC_DEL_COMMENT` | `DOC_ID` | 6138 | Commentaires de circuit (`CMT_TITLE`, `CMT_UTILISATEUR`, `CMT_DT_COMMENT`). |
| `DOC_DEL_*_SECRET` | — | 0 | Contenu **confidentiel** (vide : rien à reprendre). |

- `ARC_TYPE` ∈ `{Delib (1758), Rapport (90), Seance (40)}` : la table `DOC_DEL_ARCHIVE` est la **source
  principale de l'historique 2018‑2024**, sans recouvrement avec les tables courantes (`DOC_ID` disjoints).
- Chaque ligne archive est un **acte** (Delib/Rapport) ou une **séance**, avec direction, service,
  rapporteur, rubrique et résultat déjà aplatis.
- Les colonnes `*_X` (ex. `RAP_RUB_X`, `ANN_LIBELLE_X`) sont des **doublons sans accent / majuscules**
  pour la recherche : à ignorer à l'import (garder la version accentuée).

### 4.2 GED / fichiers (reprise des PDF et annexes — IMP-20)

Chaîne d'accès aux fichiers :

```
DOCUMENT (DOC_ID, CTY_ID)                     ── identité + type
   └─ DOCVERSION (DVER_ID, DOC_ID, USR_ID, DVER_DATE, DVER_LABEL, DVER_XML)
         └─ DOC_PRIMAIRE (FIC_ID, DVER_ID, DOP_INDEX, DOP_VERSION)
               └─ FIC_PRIMAIRE (FIC_ID, FSYS_ID, TFP_ID, FIC_NOM, FIC_CHEMIN, FIC_LIBELLE)
                     └─ TYPE_FIC_PRIMAIRE (TFP_ID, TFP_CODE)   ── ORIGINAL, Rapport, Délibération,
                     └─ FILESYSTEM (FSYS_ID, FSYS_RELPATH)        FINAL_DOCUMENT, corps1..5, …
DOC_SUB (DOC_ID, SUB_DOC_ID, AUI_LINK_ID)     ── documents composés
```

- **17 437 fichiers** référencés, chemins sur 2 supports :
  `D:\BMCM\Ivry\Airs3Serveur\filesystem1/...` (10 933), `f:\airsdelib\airs\...` (4 264),
  `d:\bmcm\ivry\airs\...` (2 240). `FILESYSTEM` donne la racine par `FSYS_ID`.
- `TFP_CODE` utiles : `ORIGINAL`, `Rapport`, `Délibération`, `FINAL_DOCUMENT`, `SIGNATURE_DOCUMENT`,
  `corps1..5`, `Annexes*`, `Préfecture`.
- **Corps de texte** (exposé, considérants, dispositif) : **non stocké en base** de façon structurée —
  seul `DOCVERSION.DVER_XML` (CLOB) contient la **fiche** (métadonnées au format XML `<CHAMP><CODE>…`),
  pas le texte de l'acte. Le texte est dans les **fichiers Word/PDF** (`FIC_PRIMAIRE`). La reprise doit
  donc conserver les PDF/annexes (IMP-20) et laisser `expose`/`dispositif` vides sauf extraction
  documentaire ultérieure.

### 4.3 Organisation, agents, élus

| Table | PK | Lignes | Colonnes clés |
|---|---|---|---|
| `ORGANIZATION` | `ORG_ID` | 106 | `ORG_FATHER_ID`, `ORG_CODE`, `ORG_LABEL`, `ORG_MAIL`, `ORG_ACTIVE`, `TOR_ID` (1=DGA, 2=DIRECTION, 5=SERVICE) |
| `TYPE_ORGA` | `TOR_ID` | 3 | `DGA`, `DIRECTION`, `SERVICE` |
| `USERS` | `USR_ID` | 341 | `USR_LOGIN`, `USR_NAME`, `USR_FIRSTNAME`, `USR_MAIL`, `PER_ID`, `USR_ACTIVE` |
| `PERSON` | `PER_ID` | 353 | `PER_NAME`, `PER_FIRSTNAME`, `PER_TYPE`, `PER_ISINTERNAL` |
| `USER_ORGA` | `USR_ID`+`ORG_ID`+`FON_ID` | 417 | Affectation agent→service |
| `LEXICON`/`LANGLABEL` | `LEX_ID` / `LLA_ID` | 134 / 500 | Libellés traduits (utile pour `CONTENT_TYPE`). |

---

## 5. Correspondance AIRS → champs canoniques du sas VibeDélib

Champs canoniques attendus par `airs.service.js` (`CANON`) et axes de concordance (`CHAMP_AXE`) :

| Champ canonique | Axe | Source AIRS recommandée | Remarque |
|---|---|---|---|
| `titre` / `objet` | — | `DOC_DEL_RAPPORT.RAP_TITRE` (rapport) ou `DOC_DEL_DELIB.DDE_TITRE` / `DOC_DEL_ARCHIVE.DDE_TITRE`,`RAP_TITRE` (acte) | Nettoyer `&#13;`/retours ligne. |
| `numero` | — | `DDE_NUMERO` (souvent `"0"`), `RAP_NUM_SUIVI`, `DDE_RACINE_NUMERO`+`DDE_SOUS_NUMERO`, `RAP_NUM_CHRONO` | **Le n° de délibération n'est pas stocké** : il est calculé par modèle (`PARAM_DELIB`). Voir §8. |
| `type` | `type_acte` | `DOC_DEL_ARCHIVE.ARC_TYPE` (`Delib`/`Rapport`) ou `TYPE_ASSEMBLE.TAS_LABEL` | VibeDélib : `deliberation` par défaut. |
| `nature` | `nature` | `FAST_RAPPORT_CLASSIF.CODENATURE` | Référentiel à établir (codes `1,4,5,6`). Voir §8. |
| `matiere` | `matiere` | `FAST_RAPPORT_CLASSIF.CODEMATIERE` | Codes = nomenclature `matieres.txt` (1.1, 7.5, 8.9…). |
| `rubrique` | `rubrique` | `DOC_DEL_RAPPORT.RAP_RUB` / `DOC_DEL_ARCHIVE.RAP_RUB` | 31 valeurs libres ; rapprocher des 40 `RUBRIQUES`. |
| `direction` | `direction` | `PROJET_RAPPORT.ORG_ID`→`ORGANIZATION` (`TOR_ID=2`/`1`, `ORG_CODE`,`ORG_LABEL`) ; repli `DOC_DEL_RAPPORT.RAP_DIRECTION` (texte) | Bloquant. |
| `service` | `service` | idem `TOR_ID=5` ; repli `RAP_SERVICE` | Bloquant. |
| `redacteur` | `agent` | `PROJET_RAPPORT.USR_ID`→`USERS.USR_LOGIN` ; repli `RAP_INSTRUCTEUR` (texte) | Ne jamais créer de compte (IMP-12). |
| `rapporteur` | `elu` | `PROJET_RAPPORT.ELD_ID`→`ELU_DESTINATAIRE` (`ELD_NOM`,`ELD_PRENOM`) | |
| `rapporteur_compl` | `elu` | *(non disponible : `ELU_SUPPLEANT`/`ELU_DELIB` vides)* | À ignorer. |
| `resultat` | — | `DDE_RESULTAT` (`Adopté à la majorité`/`à l'unanimité`), `FEUILLE_VOTE.FVO_RESULTAT`, `DDE_NB_OUI/NON/ABSTENTI` | |
| `date` | — | séance `SEA_DT_DEBUT` ; acte `DDE_DT_VOTE` (repli `RAP_DATE_DEC`,`RAP_DATE_ACTE`) | Oracle renvoie des `DATE` (minuit local). |
| `seance` | — | `PROJET_DELIB.RAP_ID`→`PROJET_RAPPORT.SEA_ID` (= `DOC_ID` de la séance) | Clé de rattachement du sas. |
| `instance` | `instance` | `TYPE_ASSEMBLE.TAS_LABEL` / `DOC_DEL_SEANCE.SEA_ASSEMBLEE` | |
| `lieu` | — | `DOC_DEL_SEANCE.SEA_LIEU` | |
| `commission` | `commission` | `PROJET_RAPPORT.COM_ID`→`COMMISSION.COM_LABEL` | |
| `incidence_financiere` | — | `DOC_DEL_RAPPORT.RAP_INCIDENCE` (texte) | |
| `montant` | — | `DOC_DEL_RAPPORT.RAP_MONTANT` (texte) | |
| `expose`,`considere`,`visas`,`dispositif` | — | **Absents de la base** → fichiers (`FIC_PRIMAIRE`) | Voir §4.2. |

**Identifiants stables (Q-AIRS3)** — clé de rapprochement entre lots : `table + id_source` où
`id_source` = `DOC_ID` (= `SEA_ID`/`RAP_ID`/`DEL_ID`/`ANN_ID`). C'est la clé déjà utilisée par le sas
(`airs_import_items.source_key`, `airs_links.source_key`).

**Codes de résultat de vote (`VOTE.VOT_RESULTAT`)** — valeurs observées `0..4` (et `VOT_PRESENT` `0..2`).
Sémantique à confirmer avec Digitech ; proposition de lecture :
`1` = pour, `2` = contre, `3` = abstention, `4` = ne prend pas part au vote, `0` = non exprimé/absence ;
`VOT_PRESENT` : `1` = présent, `0` = absent/procuration, `2` = … *(à valider)*.
La table `FEUILLE_VOTE`/`DDE_RESULTAT` fournit de toute façon le résultat textuel exploitable.

---

## 6. Volumétrie et périmètre de reprise

| Périmètre | Source | Volume | Période |
|---|---|---|---|
| Séances courantes | `DELIBUSER.SEANCE` + `AIRSUSER.DOC_DEL_SEANCE` | 13 | 2025‑02 → 2026‑12 |
| Séances historiques | `AIRSUSER.DOC_DEL_ARCHIVE` `ARC_TYPE='Seance'` | 40 | 2018‑04 → 2024‑12 |
| Rapports (courants) | `PROJET_RAPPORT` + `DOC_DEL_RAPPORT` | 560 / 562 | — |
| Actes (courants) | `PROJET_DELIB` + `DOC_DEL_DELIB` | 669 / 926 | 2025‑02 → 2026‑07 |
| Actes historiques | `DOC_DEL_ARCHIVE` `ARC_TYPE='Delib'` | 1758 | 2018‑04 → 2024‑12 |
| Rapports archivés | `DOC_DEL_ARCHIVE` `ARC_TYPE='Rapport'` | 90 | |
| Votes | `DELIBUSER.VOTE` | 25 395 (520 actes) | 2025‑2026 uniquement |
| Annexes | `ANNEXE` + `DOC_DEL_ANNEXE` | 865 / 2967 | |
| Ordre du jour | `ODJ_SEANCE` | 5052 | 2017‑11 → 2026‑06 |
| Fichiers | `FIC_PRIMAIRE` | 17 437 | |

> Total « actes » à reprendre ≈ **926 (courants) + 1 848 archive (1758 Delib + 90 Rapport)** ≈ **2 774**,
> pour **53 séances** (13 + 40). Les 258 lignes de `DOC_DEL_DELIB` hors `PROJET_DELIB` sont des actes
> isolés (sans rapport lié) et doivent être incluses.

---

## 7. Requêtes d'extraction prêtes à l'emploi (SELECT)

### 7.1 Séances (courantes + historiques)

```sql
-- Séances courantes
SELECT s.SEA_ID AS id, d.SEA_DT_DEBUT AS date_seance, d.SEA_HEURE_DEBUT AS heure,
       d.SEA_LIEU AS lieu, d.SEA_INTITULE AS titre, d.SEA_TYPE AS type,
       t.TAS_LABEL AS instance, e.ELD_NOM, e.ELD_PRENOM
FROM   DELIBUSER.SEANCE s
JOIN   AIRSUSER.DOC_DEL_SEANCE d ON d.DOC_ID = s.SEA_ID
JOIN   DELIBUSER.TYPE_ASSEMBLE t ON t.TAS_ID = s.TAS_ID
LEFT JOIN DELIBUSER.ELU_DESTINATAIRE e ON e.ELD_ID = s.ELD_ID;

-- Séances historiques (archive)
SELECT DOC_ID AS id, SEA_DT_DEBUT AS date_seance, SEA_LIEU AS lieu,
       SEA_INTITULE AS titre, SEA_ASSEMBLEE AS instance
FROM   AIRSUSER.DOC_DEL_ARCHIVE
WHERE  ARC_TYPE = 'Seance';
```

### 7.2 Actes (rapport + délibération + classification + rattachement séance)

```sql
-- Actes courants
SELECT p.RAP_ID, dl.DEL_ID,
       r.RAP_TITRE  AS titre_rapport, d.DDE_TITRE AS titre_acte,
       d.DDE_RESULTAT AS resultat, d.DDE_DT_VOTE AS date_vote,
       d.DDE_NB_OUI, d.DDE_NB_NON, d.DDE_NB_ABSTENTI,
       r.RAP_DIRECTION AS direction, r.RAP_SERVICE AS service,
       r.RAP_RUB AS rubrique, r.RAP_INSTRUCTEUR AS instructeur_texte,
       e.ELD_NOM AS rapporteur_nom, e.ELD_PRENOM AS rapporteur_prenom,
       u.USR_LOGIN AS redacteur, u.USR_MAIL AS redacteur_mail,
       p.SEA_ID AS seance_id,
       c.COM_LABEL AS commission, t.TAS_LABEL AS instance,
       f.CODENATURE, f.CODEMATIERE
FROM   DELIBUSER.PROJET_DELIB dl
JOIN   DELIBUSER.PROJET_RAPPORT p ON p.RAP_ID = dl.RAP_ID
LEFT JOIN AIRSUSER.DOC_DEL_DELIB d ON d.DOC_ID = dl.DEL_ID
LEFT JOIN AIRSUSER.DOC_DEL_RAPPORT r ON r.DOC_ID = p.RAP_ID
LEFT JOIN AIRSUSER.DOC_DEL_SEANCE s ON s.DOC_ID = p.SEA_ID
LEFT JOIN DELIBUSER.ELU_DESTINATAIRE e ON e.ELD_ID = p.ELD_ID
LEFT JOIN AIRSUSER.USERS u          ON u.USR_ID = p.USR_ID
LEFT JOIN DELIBUSER.COMMISSION c    ON c.COM_ID = p.COM_ID
LEFT JOIN DELIBUSER.TYPE_ASSEMBLE t ON t.TAS_ID = s.TAS_ID
LEFT JOIN DELIBUSER.FAST_RAPPORT_CLASSIF f ON f.RAP_ID = p.RAP_ID;

-- Actes historiques (archive) : tout est déjà aplati
SELECT DOC_ID AS id, ARC_TYPE, DDE_TITRE AS titre, RAP_TITRE AS titre_rapport,
       DDE_RESULTAT AS resultat, DDE_DT_VOTE, RAP_DIRECTION AS direction,
       RAP_SERVICE AS service, RAP_RAPPORTEUR AS rapporteur, RAP_RUB AS rubrique,
       SEA_DT_DEBUT AS date_seance, SEA_INTITULE AS seance
FROM   AIRSUSER.DOC_DEL_ARCHIVE
WHERE  ARC_TYPE IN ('Delib','Rapport');
```

### 7.3 Votes et annexes

```sql
SELECT v.DEL_ID, v.ELD_ID, e.ELD_NOM, e.ELD_PRENOM,
       v.VOT_RESULTAT, v.VOT_PRESENT, v.ELD_ID_PROCURATION, v.ELD_ID_SUPPLEANT
FROM   DELIBUSER.VOTE v
LEFT JOIN DELIBUSER.ELU_DESTINATAIRE e ON e.ELD_ID = v.ELD_ID;

SELECT a.ANN_ID, a.RAP_ID, d.ANN_LIBELLE, d.ANN_TYPE, d.ANN_FICHIER, d.ANN_NB_PAGE, d.ANN_ORDRE
FROM   DELIBUSER.ANNEXE a
LEFT JOIN AIRSUSER.DOC_DEL_ANNEXE d ON d.DOC_ID = a.ANN_ID;
```

### 7.4 Fichiers (PDF / Word) d'un acte

```sql
SELECT doc.DOC_ID, doc.CTY_ID, f.FIC_ID, f.FIC_NOM, f.FIC_CHEMIN, f.FIC_LIBELLE,
       t.TFP_CODE, fs.FSYS_RELPATH
FROM   AIRSUSER.DOCUMENT doc
JOIN   AIRSUSER.DOCVERSION dv   ON dv.DOC_ID = doc.DOC_ID
JOIN   AIRSUSER.DOC_PRIMAIRE dp ON dp.DVER_ID = dv.DVER_ID
JOIN   AIRSUSER.FIC_PRIMAIRE f  ON f.FIC_ID = dp.FIC_ID
LEFT JOIN AIRSUSER.TYPE_FIC_PRIMAIRE t ON t.TFP_ID = f.TFP_ID
LEFT JOIN AIRSUSER.FILESYSTEM fs ON fs.FSYS_ID = f.FSYS_ID
WHERE  doc.DOC_ID = :del_id      -- ou :rap_id, :sea_id
ORDER BY t.TFP_CODE, dp.DOP_INDEX;
```

> **Ne pas exposer les tables `_SECRET`** (contenu confidentiel, vides ici) ni les tables de droits
> (`DROIT`, `ROLEDELIB`, `PROFIL*`, `RIGHTS`). Elles ne servent pas à la reprise.

---

## 8. Points ouverts à cadrer (Q-AIRS)

| # | Point | Constat | Recommandation |
|---|---|---|---|
| 1 | **Numéro de délibération** | `DDE_NUMERO` vaut `"0"` ; `DDE_RACINE_NUMERO`/`DDE_SOUS_NUMERO`/`DDE_NUM_SUIVI_DEFINITIF` nuls ; le n° est calculé par modèle (`PARAM_DELIB.CONSEIL_MUNICIPAL_NUM_DELIB = "DEL%MM%%YYYY%_%3NUMCHRONO%"`) à partir de `RAP_NUM_CHRONO`. | Reprendre `RAP_NUM_CHRONO` + `DDE_DT_VOTE` et reconstituer via le modèle, ou exposer `RAP_NUM_SUIVI` comme n° d'origine. À valider avec le service. |
| 2 | **Référentiel `nature`** | `FAST_RAPPORT_CLASSIF.CODENATURE` ∈ `{1,4,5,6}`, sans table de libellés. `DOC_DEL_RAPPORT.RAP_NATURE` toujours nul. | Demander la correspondance à Digitech, ou mapper sur les 6 `NATURES` VibeDélib (`seeds.js`). |
| 3 | **Matière** | `CODEMATIERE` correspond à la nomenclature fournie (`matieres.txt`, 1→9.4). | Vérifier l'alignement avec `referentiels/matieres.js` de VibeDélib. |
| 4 | **Codes de vote** | `VOT_RESULTAT` 0..4, `VOT_PRESENT` 0..2 sans libellé. | Confirmer la sémantique (§5). |
| 5 | **Corps de texte** | `expose`/`considere`/`dispositif` absents de la base (fichiers Word/PDF). | Reprendre les PDF (IMP-20) ; option OCR/extraction ultérieure. |
| 6 | **Rapporteur complémentaire** | Tables `ELU_DELIB`/`ELU_SUPPLEANT` vides. | Non repris. |
| 7 | **Documents confidentiels** | Tables `*_SECRET` vides. | Hors périmètre. |
| 8 | **Fichiers multi-serveurs** | Chemins sur `D:\BMCM`, `D:\bmcm`, `f:\airsdelib`. | Le HUB DSI doit vérifier l'accès aux 3 racines (`FILESYSTEM`). |
| 9 | **Actes isolés** | 258 `DOC_DEL_DELIB` sans `PROJET_DELIB` (hors archive). | Les inclure comme actes supplémentaires. |
| 10 | **Périmètre des votes** | Votes présents uniquement 2025‑2026. | Pour l'historique, s'appuyer sur `DDE_RESULTAT`/`FEUILLE_VOTE`. |

---

## 9. Synthèse des tables à importer

**Cœur métier (`DELIBUSER`)** : `SEANCE`, `PROJET_RAPPORT`, `PROJET_DELIB`, `ODJ_SEANCE`, `ANNEXE`,
`ANNEXE_DELIB`, `VOTE`, `FEUILLE_VOTE`, `FAST_RAPPORT_CLASSIF`, `COMMISSION`, `AVIS_COMMISSION`,
`AVIS_COMMISSION_TYPE`, `COMMISSION_ELU_DESTINATAIRE`, `ELU_DESTINATAIRE`, `ELU_FONCTION`,
`ELU_TYPE_ASSEMBLE`, `DESTINATAIRE_FONCTION`, `UTILISATEUR`, `TYPE_ASSEMBLE`, `TYPE_ARCHIVE`,
`TYPE_INCIDENCE`, `TYPE_ANNEXE`, `DOSSIER_EXT`.

**Métadonnées et historique (`AIRSUSER`)** : `DOC_DEL_SEANCE`, `DOC_DEL_RAPPORT`, `DOC_DEL_DELIB`,
`DOC_DEL_ANNEXE`, `DOC_DEL_ARCHIVE`, `DOC_DEL_COMMENT`, `ORGANIZATION`, `TYPE_ORGA`, `USERS`, `PERSON`,
`USER_ORGA`.

**Fichiers (`AIRSUSER`)** : `DOCUMENT`, `DOCVERSION`, `DOC_PRIMAIRE`, `DOC_SUB`, `FIC_PRIMAIRE`,
`TYPE_FIC_PRIMAIRE`, `FILESYSTEM`, `CONTENT_TYPE`.

**Non requis** : tout `FLOWUSER` (workflow), les tables de droits/profils (`DROIT*`, `ROLEDELIB`,
`PROFIL*`, `RIGHTS`, `ROLE_*`), les événements (`EVT_*`), et les tables `*_SECRET`.

---

## 10. Mise en œuvre du module d'import (implémenté)

Le backend VibeDélib peut désormais lire **directement** la base Oracle AIRS (lecture seule) et alimenter le
sas `airs_*`, sans passer par PostgreSQL intermédiaire :

- **Adaptateur** `backend/src/adapters/airs-oracle.js` : connexion `oracledb` *thin*, `SELECT` uniquement,
  SQL figé (séances et actes). Expose `configuree()`, `cible()`, `ping()`, `extraire({ annee })`.
- **Configuration** : variables `AIRS_ORACLE_HOST/PORT/SERVICE/USER/PASSWORD` (fichier `.env.airs`, ignoré
  par git ; chargé en complément du `.env`).
- **Service** `airs.chargerOracle(ctx, org, lotId, { annee })` : extrait séances + actes et les dépose bruts
  dans `airs_raw_rows` (mêmes garanties que l'import JSON : rien n'entre dans le métier).
- **Routes** : `GET /api/v1/organismes/:orgId/import-airs/source` (état de la connexion) et
  `POST .../import-airs/lots/:id/charger-oracle` (chargement). Réservées à `org_admin` / `scc`.
- **Mapping par défaut** : tables logiques `seances` (→ séance) et `actes` (→ acte), colonnes déjà alignées
  sur les champs canoniques.
- **Frontend** : bouton « Charger depuis Oracle AIRS » dans l'écran *Paramétrages › Import AIRS DELIB*.

L'extraction produit une ligne par séance (`id = sea:<SEA_ID>`) et une ligne par délibération
(`id = act:<DEL_ID>`), avec rattachement `seance = sea:<SEA_ID>`. Les séances et actes archivés
(`DOC_DEL_ARCHIVE`, 2018‑2024) sont inclus ; les actes isolés (`DOC_DEL_DELIB` hors `PROJET_DELIB`) aussi.
Les lignes `DOC_DEL_ARCHIVE` de type `Rapport` (90, sans délibération) ne sont pas reprises comme actes.
Un filtre optionnel `annee` restreint l'extraction à un exercice. Comptage réel constaté : **53 séances** et
**2 685 actes** (dont 1 758 archivés).

---

*Analyse produite en lecture seule sur `oracle02:1524/PAIRS`. Pour toute interrogation ultérieure,
le présent document et `.env.airs` suffisent à reconstituer l'accès.*
