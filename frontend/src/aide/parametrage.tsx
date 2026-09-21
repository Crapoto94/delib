import { Settings } from 'lucide-react';
import { Article, BoutonUI, DefListe, Encadre, Etape, Intro, Li, Liste, P, Procedure, SousTitre, Tableau, Terme } from './ui';

export const parametrage: Article = {
  code: 'parametrage',
  titre: 'Paramétrages techniques (administrateur)',
  resume: "Réservé à l'administrateur d'organisme et à l'administrateur de plateforme : identité, comptes et rôles, gabarits, champs, référentiels, connexions externes, collectivités et exploitation.",
  Icone: Settings,
  acces: 'admin',
  intro: (
    <Intro>
      Cette aide est réservée aux <Terme>administrateurs</Terme>. Elle explique d'abord la frontière entre les <Terme>paramétrages fonctionnels</Terme> (confiés au SCC) et les <Terme>paramétrages techniques</Terme> (qui vous incombent), puis détaille chaque écran technique.
      <br />Accès : onglet <BoutonUI>Paramétrages</BoutonUI>.
    </Intro>
  ),
  sections: [
    {
      id: 'p-frontiere',
      titre: 'Fonctionnel (SCC) ou technique (administrateur) ?',
      bloc: (
        <>
          <P>La séparation est essentielle : elle évite que l'on touche à la technique pour un besoin métier, et inversement.</P>
          <Tableau entetes={['Domaine', 'Fonctionnel — SCC', 'Technique — administrateur']} lignes={[
            [<>Circuits de validation</>, <>Créer, organiser, publier (avec l'administrateur)</>, <>Superviser, importer/exporter</>],
            [<>Titulaires, organisation, autorisations de rédaction</>, <>Oui, dans leur périmètre</>, <>Tous périmètres, groupes, paramètres</>],
            [<>Séances, ordre du jour, commissions, dérogations</>, <>Oui</>, <>Instances, paramètres de délais</>],
            [<>Élus et espace élus</>, <>Comptes, invitations, preuve de lecture</>, <>Mise à disposition, purge des annotations</>],
            [<>Notifications & relances</>, <>Consultation</>, <>Édition des règles, jours fériés</>],
            [<>TDT et GED</>, <>Exploitation, envois, synchronisation</>, <>Connexions, tests, plan de classement</>],
            [<>Identité & logo, utilisateurs & rôles</>, <>Consultation selon droits</>, <>Oui</>],
            [<>Gabarits, champs personnalisés, référentiels, IA, recherche, export/import</>, <>Non</>, <>Oui</>],
            [<>Collectivités, référentiels communs, admins de plateforme</>, <>Non</>, <>Administrateur de plateforme</>],
          ]} />
          <Encadre type="attention" titre="Pourquoi certains écrans sont visibles mais non modifiables">
            Un onglet peut s'afficher sans que vous puissiez enregistrer : l'enregistrement est alors refusé par le serveur (message d'erreur). C'est le cas de plusieurs onglets pour le SCC. Reportez le réglage à l'administrateur compétent.
          </Encadre>
        </>
      ),
    },
    {
      id: 'p-roles',
      titre: 'Les rôles et qui fait quoi',
      bloc: (
        <>
          <P>Les rôles se gèrent dans <BoutonUI>Paramétrages › Utilisateurs & rôles</BoutonUI>.</P>
          <DefListe items={[
            [<>Administrateur de plateforme</>, <>Tous les organismes, tous les droits. À réserver à la DSI.</>],
            [<>Administrateur (d'organisme)</>, <>Paramètre l'organisme : circuits, référentiels, utilisateurs, titulaires, gabarits, connexions.</>],
            [<>SCC</>, <>Séances, ordre du jour, dérogations, avis de commission, circuit.</>],
            [<>Télétransmission</>, <>Prépare et confirme les envois au contrôle de légalité.</>],
            [<>Lecteur</>, <>Consultation seule de tous les actes.</>],
          ]} />
          <P>Deux rôles ne se donnent <Terme>pas</Terme> ici : les <Terme>fonctions de validation</Terme> (chef de service, directeur, DGA, DGS) se désignent dans <BoutonUI>Titulaires & droits</BoutonUI>, et le rôle de <Terme>rédacteur</Terme> se déduit de la direction de l'agent et des autorisations de rédaction.</P>
          <Encadre type="danger" titre="Garde-fous">
            Impossible de retirer le dernier administrateur d'un organisme, ni le dernier administrateur de plateforme. Toute modification est <Terme>auditée</Terme> (avant / après).
          </Encadre>
        </>
      ),
    },
    {
      id: 'p-identite',
      titre: 'Identité & logo',
      bloc: (
        <>
          <P>L'écran <BoutonUI>Identité & logo</BoutonUI> définit ce qui apparaît dans l'application, sur la page de connexion, dans l'onglet du navigateur et dans les PDF.</P>
          <Liste>
            <Li>Logo : PNG ou JPEG, 1,5 Mo maximum.</Li>
            <Li>Identité : nom de la collectivité, adresse, complément, code postal, ville, téléphone, e-mail, site web, SIREN.</Li>
            <Li>Signataire des convocations et sa qualité.</Li>
          </Liste>
          <P>Ces informations sont réutilisables dans les gabarits via des <Terme>variables</Terme> : <Terme>{'{organisme}'}</Terme>, <Terme>{'{adresse}'}</Terme>, <Terme>{'{ville}'}</Terme>, <Terme>{'{code_postal}'}</Terme>, <Terme>{'{telephone}'}</Terme>, <Terme>{'{email}'}</Terme>, <Terme>{'{site_web}'}</Terme>, <Terme>{'{signataire}'}</Terme>.</P>
        </>
      ),
    },
    {
      id: 'p-utilisateurs',
      titre: 'Utilisateurs & rôles',
      bloc: (
        <>
          <P>Cet écran attribue les rôles aux agents. La recherche interroge l'annuaire RH et les agents déjà connectés.</P>
          <Procedure>
            <Etape n={1} titre="Rechercher un agent">Par nom, identifiant ou e-mail. Le filtre « Seulement ceux qui ont un rôle » resserre la liste.</Etape>
            <Etape n={2} titre="Ouvrir sa fiche">Vous y voyez son identité RH, ses rôles, sa visibilité des actes, ses fonctions et groupes, et ses accès (et pourquoi : rôle, direction, organisme par défaut).</Etape>
            <Etape n={3} titre="Ajouter ou retirer un rôle">Administrateur, SCC, Télétransmission, Lecteur. La case « Administrateur de plateforme » n'apparaît que pour un administrateur de plateforme.</Etape>
          </Procedure>
          <Encadre type="info" titre="Départ d’un agent">
            Désactiver un agent lui retire ses accès et déclenche la réaffectation de ses étapes en cours. Aucune donnée n'est supprimée.
          </Encadre>
        </>
      ),
    },
    {
      id: 'p-gabarits',
      titre: 'Gabarits',
      bloc: (
        <>
          <P>Les <BoutonUI>Gabarits</BoutonUI> définissent l'apparence des documents produits : exposé, délibération, dossier complet, page de garde, intercalaire, sommaire, ordre du jour, convocation, extrait du registre.</P>
          <Tableau entetes={['Réglage', 'Détail']} lignes={[
            [<>Texte</>, <>Police, taille, interligne, justification.</>],
            [<>Marges</>, <>Marges du document.</>],
            [<>Entête & pied</>, <>Lignes d'en-tête, pied de page, pagination, filigrane.</>],
            [<>Fond de page</>, <>PDF de fond, éventuellement un pour la première page et un pour les suivantes ; option d'affichage du logo.</>],
            [<>Modèle Word (.docx)</>, <>Fichier Word à variables <code>{'{titre} {expose} {visas} {dispositif}…'}</code>, fusionné à la génération du document (puis converti en PDF) ; sans modèle, la mise en page ci-dessus est utilisée.</>],
          ]} />
          <P>Un bouton d'<BoutonUI>Aperçu d'étalonnage</BoutonUI> génère un PDF de contrôle pour vérifier le rendu avant de valider.</P>
        </>
      ),
    },
    {
      id: 'p-champs',
      titre: 'Champs personnalisés',
      bloc: (
        <>
          <P>Le bouton <BoutonUI>Nouveau champ</BoutonUI> ajoute une information propre à votre collectivité sur la fiche d'un dossier.</P>
          <Tableau entetes={['Réglage', 'Détail']} lignes={[
            [<>Libellé et code</>, <>Le code est définitif : minuscules, chiffres et « _ ».</>],
            [<>Type</>, <>Texte, Nombre, Date, Liste de valeurs, Oui/non, Élu, Agent.</>],
            [<>S'applique à</>, <>Tous les types d'actes, ou un seul.</>],
            [<>Obligatoire</>, <>Bloque l'envoi au circuit tant qu'il n'est pas renseigné.</>],
            [<>Afficher seulement si…</>, <>Condition d'affichage selon la valeur d'un autre champ.</>],
            [<>Qui peut le renseigner ?</>, <>Rédacteur, SCC, Administrateur.</>],
            [<>À quelles étapes ?</>, <>Clés d'étapes séparées par des virgules ; « brouillon » = avant l'envoi.</>],
          ]} />
          <Encadre type="info" titre="Rien n’est perdu">
            Désactiver un champ ne supprime jamais les valeurs déjà saisies. Le code, le type et le type d'acte ne se modifient plus après la création.
          </Encadre>
        </>
      ),
    },
    {
      id: 'p-referentiels',
      titre: 'Référentiels, surcharges et configuration',
      bloc: (
        <>
          <P>Les référentiels (types d'actes, natures, rubriques, matières, types d'annexes) existent en <Terme>jeu commun</Terme>. Chaque organisme peut <Terme>hériter</Terme>, <Terme>renommer</Terme>, <Terme>désactiver</Terme> ou <Terme>ajouter</Terme> des valeurs.</P>
          <SousTitre>Export / import de configuration</SousTitre>
          <P>L'onglet <BoutonUI>Export / import</BoutonUI> produit un fichier JSON ne contenant <Terme>ni mot de passe, ni personne, ni dossier</Terme> : paramètres, référentiels propres, surcharges, champs personnalisés, circuits et instances.</P>
          <Liste>
            <Li>Export : bouton <BoutonUI>Télécharger la configuration</BoutonUI>.</Li>
            <Li>Import : <BoutonUI>Aperçu de l'import</BoutonUI> d'abord (rien n'est modifié), puis <BoutonUI>Appliquer</BoutonUI>. Rien n'est supprimé et aucun circuit n'est écrasé : les circuits arrivent en <Terme>brouillon</Terme>.</Li>
          </Liste>
          <Encadre type="astuce" titre="Modèles fournis">
            Des modèles sont proposés (ex. « Commune neutre » avec un circuit court), pratiques pour démarrer ou comparer les configurations.
          </Encadre>
        </>
      ),
    },
    {
      id: 'p-notifications',
      titre: 'Notifications, relances et jours fériés',
      bloc: (
        <>
          <P>L'onglet <BoutonUI>Notifications & relances</BoutonUI> montre un tableau de bord (envoyés, échecs, actes sans titulaire, bloqués) et la liste des règles.</P>
          <Liste>
            <Li>Chaque règle est de type <Terme>Événement</Terme> ou <Terme>Relance</Terme>, dans une famille (validation, suivi, discussion, délégation, échéances, administration, synthèse).</Li>
            <Li>L'interrupteur <BoutonUI>Par e-mail</BoutonUI> choisit « mail + outil » ou « outil seulement ».</Li>
            <Li>Le bouton <BoutonUI>M'envoyer un test</BoutonUI> vérifie le rendu. Le corps de mail utilise des variables (titre, numéro, étape, lien, échéance…).</Li>
            <Li>Certaines familles sont <Terme>obligatoires</Terme> et ne peuvent pas être désactivées.</Li>
          </Liste>
          <SousTitre>Jours fériés</SousTitre>
          <P>L'onglet <BoutonUI>Jours fériés</BoutonUI> génère les jours fériés de l'année (et de la suivante). Ils sont exclus du calcul des délais ouvrés et des relances.</P>
        </>
      ),
    },
    {
      id: 'p-ia',
      titre: 'Assistant IA',
      bloc: (
        <>
          <P>L'onglet <BoutonUI>Assistant IA</BoutonUI> règle, par usage, la <Terme>consigne</Terme> envoyée à l'IA et le <Terme>modèle</Terme> utilisé.</P>
          <Tableau entetes={['Usage', 'Ce qu’on peut régler']} lignes={[
            [<>Orthographe et typographie</>, <>Activation, consigne, modèle.</>],
            [<>Style et clarté</>, <>Activation, consigne, modèle.</>],
            [<>Visas et considérants</>, <>Activation, consigne, modèle.</>],
            [<>Copie assistée</>, <>Adaptation d'un dossier copié à un nouveau contexte.</>],
            [<>Contrôle complet du dossier</>, <>Enchaîne les passes actives et les contrôles automatiques.</>],
          ]} />
          <Liste>
            <Li>Le <Terme>format de réponse imposé</Terme> n'est pas modifiable (garantit une réponse exploitable).</Li>
            <Li>Le bouton <BoutonUI>Rétablir les valeurs par défaut</BoutonUI> revient à la consigne d'origine.</Li>
            <Li>Une section <Terme>Limites</Terme> règle la file d'attente (requêtes simultanées, taille de file, délai, tentatives).</Li>
          </Liste>
          <Encadre type="attention" titre="L’IA propose, l’agent valide">
            Ne modifiez pas les consignes sans validation métier : elles encadrent la qualité et la conformité des suggestions faites aux agents.
          </Encadre>
        </>
      ),
    },
    {
      id: 'p-recherche',
      titre: 'Recherche',
      bloc: (
        <>
          <P>L'onglet <BoutonUI>Recherche</BoutonUI> administre l'index plein texte et les synonymes.</P>
          <Liste>
            <Li>État de l'index (actes, indexés, en retard, annexes lues…) et bouton <BoutonUI>Ré-indexer tout</BoutonUI>.</Li>
            <Li><Terme>Synonymes</Terme> : un groupe de termes par ligne (ex. « école, établissement scolaire, groupe scolaire »), pour améliorer les résultats.</Li>
            <Li>Requêtes fréquentes et requêtes sans résultat (anonymisées : ni nom ni identifiant).</Li>
          </Liste>
        </>
      ),
    },
    {
      id: 'p-connexions',
      titre: 'Connexions externes : TDT, GED, mail',
      bloc: (
        <>
          <SousTitre>Télétransmission (TDT)</SousTitre>
          <P>L'onglet <BoutonUI>Télétransmission (TDT)</BoutonUI> choisit le fournisseur (S²LOW par défaut) et règle sa connexion : mode (Simulation / Test / Production), adresse du serveur, identifiant technique, mot de passe. Le bouton <BoutonUI>Tester la connexion</BoutonUI> valide le paramétrage.</P>
          <Encadre type="info" titre="Où sont les paramètres d’envoi ?">
            SIREN, département, arrondissement, motif du numéro, mode A/B et double validation se règlent dans <BoutonUI>Contrôle de légalité › Paramètres</BoutonUI>, pas dans l'onglet TDT.
          </Encadre>
          <SousTitre>GED (Alfresco)</SousTitre>
          <P>L'onglet <BoutonUI>GED (Alfresco)</BoutonUI> règle le mode (Simulation / Alfresco), l'URL du serveur, le compte technique, le mot de passe (chiffré, jamais affiché), le dossier racine, l'<Terme>archivage actif</Terme> et l'<Terme>archivage automatique</Terme> à la clôture de séance. Le bouton <BoutonUI>Créer le plan de classement</BoutonUI> prépare l'arborescence.</P>
          <SousTitre>Mail, annuaires et IA</SousTitre>
          <P>L'envoi des mails, l'authentification des agents et les données Ville (RH, élus) s'appuient sur des services externes déjà en place (APM, Hub DSI). Leurs adresses et clés d'accès sont des <Terme>variables d'environnement</Terme> fournies à l'exploitation, jamais saisies dans l'interface.</P>
        </>
      ),
    },
    {
      id: 'p-collectivites',
      titre: 'Multi-organismes et Collectivités',
      bloc: (
        <>
          <P>Une seule installation peut servir plusieurs <Terme>organismes</Terme> (la Ville, le CCAS…). L'onglet <BoutonUI>Collectivités</BoutonUI> est réservé à l'<Terme>administrateur de plateforme</Terme>.</P>
          <Liste>
            <Li><BoutonUI>Ouvrir</BoutonUI> bascule sur un organisme ; l'en-tête propose ensuite un sélecteur d'organisme si vous en avez plusieurs.</Li>
            <Li><BoutonUI>Directions rattachées</BoutonUI> associe des directions de l'organigramme RH à l'organisme. Une direction ne peut être rattachée qu'à un seul organisme.</Li>
            <Li><BoutonUI>Administrateurs</BoutonUI> attribue les rôles dans cet organisme.</Li>
            <Li><BoutonUI>Nouvelle collectivité</BoutonUI> crée un organisme ; un circuit standard, les groupes de valideurs et une instance de séances sont initialisés automatiquement.</Li>
          </Liste>
          <Encadre type="info" titre="Isolation">
            Chaque enregistrement métier appartient à un organisme. Aucune visibilité inter-organismes n'existe sans rôle, rattachement ou statut d'administrateur de plateforme.
          </Encadre>
        </>
      ),
    },
    {
      id: 'p-exploitation',
      titre: 'Paramètres d’exploitation',
      bloc: (
        <>
          <P>Certains réglages ne sont pas modifiables dans l'interface : ils sont fournis par l'exploitation (fichier d'environnement). En voici les familles, pour information :</P>
          <Liste>
            <Li>Connexion à la base de données et au schéma dédié.</Li>
            <Li>Clés d'accès aux services externes (APM, Hub DSI), certificats et fuseau horaire.</Li>
            <Li>Secret de session, durée de validité, administrateurs initiaux.</Li>
            <Li>Chemins de stockage des fichiers, taille maximale des dépôts, dossier des polices.</Li>
            <Li>Adresse publique, réglages mail (redirection de test, domaine des e-mails) et planificateur de tâches.</Li>
          </Liste>
          <Encadre type="danger" titre="Aucun secret en dur">
            Aucun mot de passe, aucune URL de service ne doit être saisi dans le code ou dans un formulaire. Tout passe par des variables d'environnement, jamais exposées au navigateur.
          </Encadre>
        </>
      ),
    },
    {
      id: 'p-bonnes-pratiques',
      titre: 'Bonnes pratiques d’administration',
      bloc: (
        <Liste>
          <Li>Avant toute modification de circuit, utilisez le bouton <BoutonUI>Contrôler</BoutonUI> : il vérifie la cohérence et propose de publier vers les nouveaux dossiers ou de migrer les dossiers en cours.</Li>
          <Li>Exportez la configuration avant un changement important : vous pourrez comparer et revenir en arrière.</Li>
          <Li>Testez toujours les connexions externes (<BoutonUI>Tester la connexion</BoutonUI>) après une modification.</Li>
          <Li>Confiez l'opérationnel du conseil au SCC et gardez les comptes, gabarits et connexions pour l'administration.</Li>
        </Liste>
      ),
    },
  ],
};
