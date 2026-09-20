import { Landmark } from 'lucide-react';
import { Article, BoutonUI, DefListe, Encadre, Etape, Flux, Intro, Li, Liste, P, Procedure, Schema, SousTitre, Tableau, Terme } from './ui';

export const scc: Article = {
  code: 'scc',
  titre: 'Séances, commissions et documents (SCC)',
  resume: "Le quotidien du Service Conseil et Contentieux : gérer les commissions, organiser les séances, construire l'ordre du jour, convoquer les élus, suivre les votes et la télétransmission.",
  Icone: Landmark,
  acces: 'scc',
  intro: (
    <Intro>
      Cette aide est destinée au <Terme>Service Conseil et Contentieux (SCC)</Terme>. Elle couvre les <Terme>opérations métier</Terme> de votre quotidien.
      Les <Terme>paramétrages fonctionnels</Terme> que vous pouvez régler vous-même sont regroupés dans la section « Paramétrages fonctionnels du SCC » ;
      tout ce qui est <Terme>technique</Terme> (identité, comptes, gabarits, connexions) relève de l'administrateur et est décrit dans l'aide « Paramétrages techniques ».
    </Intro>
  ),
  sections: [
    {
      id: 's-role',
      titre: 'Le rôle du SCC',
      bloc: (
        <>
          <P>Le SCC est le <Terme>dernier maillon du circuit</Terme> et le chef d'orchestre du conseil. Une fois qu'un acte est validé par le circuit, c'est vous qui :</P>
          <Liste>
            <Li>affectez définitivement les dossiers à une séance et à l'ordre du jour ;</Li>
            <Li>attribuez les numéros définitifs ;</Li>
            <Li>organisez les commissions et recueillez leurs avis ;</Li>
            <Li>convoquez les élus et mettez les documents à disposition ;</Li>
            <Li>suivez la séance (présences, votes, amendements) et produisez le procès-verbal ;</Li>
            <Li>préparez l'envoi au contrôle de légalité (préfecture).</Li>
          </Liste>
          <Schema legende="Le SCC intervient à partir de la fin du circuit, puis sur toute la chaîne des séances.">
            <Flux etapes={['Circuit validé', 'Affectation à une séance', 'Avis des commissions', 'Convocation des élus', 'Séance et votes', 'Contrôle de légalité']} />
          </Schema>
        </>
      ),
    },
    {
      id: 's-fonctionnel',
      titre: 'Paramétrages fonctionnels du SCC',
      bloc: (
        <>
          <P>Une partie du paramétrage est <Terme>fonctionnelle</Terme> : elle organise la vie du conseil, sans toucher à la technique. Vous y accédez par l'onglet <BoutonUI>Paramétrages</BoutonUI>.</P>
          <Tableau entetes={['Réglage fonctionnel', 'Où ?', 'À quoi ça sert']} lignes={[
            [<>Circuits de validation</>, <>Paramétrages › Circuits</>, <>Créer et organiser les étapes de validation, leurs conditions et leur publication.</>],
            [<>Titulaires & droits</>, <>Paramétrages › Titulaires & droits</>, <>Désigner qui valide (chef de service, directeur, DGA, DGS), activer l'étape « Responsable intermédiaire », gérer les groupes et les autorisations de rédaction.</>],
            [<>Notifications & relances</>, <>Paramétrages › Notifications & relances</>, <>Voir et ajuster les règles d'envoi et les relances. (L'édition fine est réservée à l'administrateur.)</>],
            [<>Élus</>, <>Paramétrages › Élus</>, <>Ajouter ou synchroniser les élus, gérer les groupes politiques.</>],
            [<>Espace élus</>, <>Paramétrages › Espace élus</>, <>Inviter les élus, gérer leurs accès, choisir quand une séance leur devient visible, consulter la preuve de lecture.</>],
            [<>Télétransmission (TDT)</>, <>Paramétrages › Télétransmission</>, <>Régler et tester la connexion au tiers, préparer et suivre les envois.</>],
            [<>GED (Alfresco)</>, <>Paramétrages › GED</>, <>Explorer, synchroniser et archiver les documents de séance.</>],
            [<>Jours fériés</>, <>Paramétrages › Jours fériés</>, <>Générer les jours fériés, exclus du calcul des délais et des relances.</>],
          ]} />
          <Encadre type="info" titre="Ce qui n’est pas de votre ressort (technique)">
            <Liste>
              <Li>Identité & logo, Utilisateurs & rôles, Gabarits PDF, Assistant IA, Champs personnalisés, Recherche, Export/import de configuration, Collectivités.</Li>
              <Li>La connexion aux services externes (Alfresco, S²LOW), les modèles et consignes IA, les réglages de plateforme.</Li>
            </Liste>
            Ces écrans peuvent vous être visibles mais leurs enregistrements sont réservés à l'administrateur. Reportez-vous à l'aide « Paramétrages techniques ».
          </Encadre>
        </>
      ),
    },
    {
      id: 's-commissions',
      titre: 'Gérer les commissions',
      bloc: (
        <>
          <P>Une commission est un groupe d'élus qui rend des <Terme>avis</Terme> sur les projets d'actes. On distingue deux types :</P>
          <DefListe items={[
            [<>Associée à la rédaction des actes</>, <>Elle rend des avis sur les projets. C'est le cas le plus fréquent.</>],
            [<>Autre</>, <>Sans lien avec les actes : elle a ses propres dossiers (nom, description, pièces jointes).</>],
          ]} />
          <Procedure>
            <Etape n={1} titre="Créer une commission">Onglet <BoutonUI>Commissions</BoutonUI> → <BoutonUI>Nouvelle commission</BoutonUI>. Donnez un nom et choisissez le type.</Etape>
            <Etape n={2} titre="Vérifier les membres et secrétaires">Ouvrez la commission : vous y voyez les sièges, les membres (avec leur fonction : président, secrétaire…) et les secrétaires (agents).</Etape>
            <Etape n={3} titre="Planifier une réunion">Section <BoutonUI>Réunions</BoutonUI> → <BoutonUI>Planifier une réunion</BoutonUI>. Indiquez date, durée, lieu. Pour la visioconférence, créez un lien Teams automatiquement ou collez un lien existant.</Etape>
            <Etape n={4} titre="Suivre et préparer">Chaque réunion affiche son statut (à venir / passée / annulée), le nombre de projets présentés, et des accès directs à la <BoutonUI>Convocation</BoutonUI> et à l'<BoutonUI>Ordre du jour →</BoutonUI>.</Etape>
          </Procedure>
          <SousTitre>Saisir un avis de commission</SousTitre>
          <P>Sur la fiche d'un dossier, la carte <BoutonUI>Commissions (pour avis)</BoutonUI> liste les commissions rattachées. Selon le réglage, la mise à disposition se fait à la validation DGS ou au déclenchement choisi. Une fois la commission saisie, le bouton <BoutonUI>Saisir l'avis</BoutonUI> permet de choisir <Terme>Favorable</Terme>, <Terme>Défavorable</Terme>, <Terme>Réservé</Terme> ou <Terme>Sans avis</Terme>. L'avis remonte ensuite aux élus.</P>
          <Encadre type="astuce" titre="Suivre les avis en attente">
            L'ordre du jour affiche un bloc <BoutonUI>Commissions — avis à obtenir</BoutonUI> : par commission, la date de la prochaine réunion et la progression (x/y actes avec avis rendu).
          </Encadre>
        </>
      ),
    },
    {
      id: 's-seances',
      titre: 'Créer et gérer les séances',
      bloc: (
        <>
          <Procedure>
            <Etape n={1} titre="Ouvrir « Séances & Ordre du jour »">Vous y trouvez les onglets <BoutonUI>À venir</BoutonUI>, <BoutonUI>Séances passées</BoutonUI> et <BoutonUI>Hors délai & dérogations</BoutonUI>.</Etape>
            <Etape n={2} titre="Créer une séance">Cliquez sur <BoutonUI>Nouvelle séance</BoutonUI> : choisissez l'instance (par ex. « Conseil municipal »), la date, le lieu. L'application propose des <Terme>dates clés</Terme> (limite de rédaction, validation DGS, mise à disposition des commissions, envoi de la convocation).</Etape>
            <Etape n={3} titre="Ajuster la séance">Le bouton <BoutonUI>Modifier la séance</BoutonUI> permet de changer la date, la durée, le lieu, le type (Ordinaire, Extraordinaire, Budgétaire, Autre) et les dates clés.</Etape>
            <Etape n={4} titre="En cas de report ou d’annulation">Le bouton <BoutonUI>Supprimer la séance</BoutonUI> propose de <Terme>reporter</Terme> les dossiers sur la prochaine séance ou de les laisser sans affectation. Si des convocations sont parties, une confirmation est demandée.</Etape>
          </Procedure>
          <Encadre type="info" titre="Dates clés et rappels">
            Modifier une date limite <Terme>recalcule automatiquement</Terme> les rappels des dossiers qui visent la séance. Les jours fériés sont exclus des délais.
          </Encadre>
        </>
      ),
    },
    {
      id: 's-odj',
      titre: 'Construire l\'ordre du jour',
      bloc: (
        <>
          <P>Ouvrez une séance pour accéder à son ordre du jour. C'est l'écran central du SCC.</P>
          <SousTitre>Affecter les dossiers</SousTitre>
          <Liste>
            <Li>La colonne <BoutonUI>En attente d'affectation</BoutonUI> regroupe les dossiers dont le circuit est terminé.</Li>
            <Li>La section <BoutonUI>Dossiers proposés à cette séance</BoutonUI> montre tous ceux qui visent la séance, où qu'ils en soient dans le circuit.</Li>
            <Li>Cochez les dossiers puis cliquez sur <BoutonUI>Ajouter N dossier(s) à l'ordre du jour</BoutonUI>, ou utilisez <BoutonUI>Ajouter à l'ordre du jour</BoutonUI> ligne par ligne.</Li>
          </Liste>
          <SousTitre>Mettre en ordre</SousTitre>
          <Liste>
            <Li>Faites <Terme>glisser-déposer</Terme> les lignes par leur poignée, ou utilisez <BoutonUI>Monter</BoutonUI> / <BoutonUI>Descendre</BoutonUI> au clavier.</Li>
            <Li>Le sélecteur <BoutonUI>Trier par…</BoutonUI> propose un classement par rubrique, rapporteur, n° de suivi ou ordre alphabétique. C'est une simple proposition, que vous pouvez annuler.</Li>
            <Li>Le bouton <BoutonUI>Annuler</BoutonUI> revient sur le dernier déplacement.</Li>
          </Liste>
          <SousTitre>Chapitres, points libres et dossiers simples</SousTitre>
          <P>Le bouton <BoutonUI>Dossier simple / point libre / chapitre</BoutonUI> ajoute :</P>
          <DefListe items={[
            [<>Un chapitre</>, <>Un simple titre de regroupement, sans numéro, pour organiser l'ordre du jour.</>],
            [<>Un point libre / dossier simple</>, <>Un sujet avec nom, description et pièces jointes (PDF, images, Word/Excel/PowerPoint, 20 Mo max par fichier).</>],
          ]} />
          <SousTitre>Numérotation</SousTitre>
          <P>Avant l'arrêt, les numéros sont <Terme>provisoires</Terme> (affichés en italique). Le bouton <BoutonUI>Numérotation…</BoutonUI> règle le format de la séance (variables <Terme>{'{ANNEE}'}</Terme>, <Terme>{'{N_SEANCE}'}</Terme>, <Terme>{'{ORDRE}'}</Terme>, <Terme>{'{RUBRIQUE}'}</Terme>). Les numéros déjà attribués ne changent jamais.</P>
          <SousTitre>Arrêter l'ordre du jour</SousTitre>
          <P>Le bouton <BoutonUI>Arrêter l'ordre du jour</BoutonUI> fige la liste. S'il reste des anomalies, une fenêtre les liste : vous pouvez corriger ou <BoutonUI>Arrêter malgré tout</BoutonUI>. Après l'arrêt, toute modification demande un <Terme>motif</Terme>.</P>
          <Encadre type="attention" titre="Hors délai et dérogations">
            L'onglet <BoutonUI>Hors délai & dérogations</BoutonUI> liste les demandes en attente (boutons <BoutonUI>Accorder</BoutonUI> / <BoutonUI>Refuser</BoutonUI>) et les actes bloqués par la date limite (bouton <BoutonUI>Reporter</BoutonUI>).
          </Encadre>
        </>
      ),
    },
    {
      id: 's-documents',
      titre: 'Ajouter des documents',
      bloc: (
        <>
          <P>Selon l'endroit, trois sortes de documents coexistent :</P>
          <Tableau entetes={['Document', 'Où l’ajouter ?', 'Formats']} lignes={[
            [<>Annexes d'un acte</>, <>Fiche du dossier → « Pièces jointes au dossier »</>, <>PDF uniquement</>],
            [<>Pièces jointes d'un point libre</>, <>Ordre du jour → point libre → « Gérer »</>, <>PDF, images, Word, Excel, PowerPoint, OpenDocument (20 Mo)</>],
            [<>Documents de séance</>, <>Générés : cahier de séance, procès-verbal, liste des délibérations, extraits du registre</>, <>Produits par l'application</>],
          ]} />
          <SousTitre>Le cahier de séance</SousTitre>
          <Procedure>
            <Etape n={1} titre="Ouvrir « Cahier de séance »">Depuis l'ordre du jour (séances de conseil).</Etape>
            <Etape n={2} titre="Choisir le profil">Secrétariat (complet), Présidence, Élus, Public — les annexes ne sont jointes que si elles sont communicables.</Etape>
            <Etape n={3} titre="Gérer les anomalies">En cas de dossier incomplet, choisissez d'avertir et générer quand même, d'exclure les dossiers en anomalie, ou de refuser.</Etape>
            <Etape n={4} titre="Générer, puis marquer imprimé">La génération se fait en arrière-plan. Le filigrane « PROJET » disparaît quand l'ordre du jour est arrêté. Le bouton <BoutonUI>Marquer imprimé</BoutonUI> sert à suivre ce qui a déjà été imprimé.</Etape>
          </Procedure>
        </>
      ),
    },
    {
      id: 's-convocation',
      titre: 'Convoquer les élus',
      bloc: (
        <>
          <P>Depuis une séance, le bouton <BoutonUI>Convocation</BoutonUI> ouvre l'écran d'envoi.</P>
          <Procedure>
            <Etape n={1} titre="Arrêter l’ordre du jour">La convocation ne peut pas partir tant que l'ordre du jour n'est pas arrêté.</Etape>
            <Etape n={2} titre="Sélectionner les destinataires">Cochez les élus (boutons <BoutonUI>Tous</BoutonUI> / <BoutonUI>Aucun</BoutonUI>) et, si besoin, les agents de la Ville (DGS, directeurs, rapporteurs, secrétaires). Chacun reçoit un lien personnel.</Etape>
            <Etape n={3} titre="Respecter le délai">L'application indique s'il reste assez de jours francs. Hors délai, seule une convocation en urgence avec motif est possible.</Etape>
            <Etape n={4} titre="Envoyer">Le bouton <BoutonUI>Convoquer</BoutonUI> (ou <BoutonUI>Envoyer un modificatif</BoutonUI> s'il existe déjà une version) lance les mails en arrière-plan.</Etape>
          </Procedure>
          <SousTitre>Suivre la convocation</SousTitre>
          <Liste>
            <Li>L'onglet <BoutonUI>Suivi et statistiques</BoutonUI> montre les envois, les ouvertures de lien, les consultations, les accusés et les réponses de présence.</Li>
            <Li>Le bouton <BoutonUI>Relancer les non-lecteurs</BoutonUI> et la <BoutonUI>Preuve (CSV)</BoutonUI> sont à portée de main.</Li>
            <Li>L'onglet <BoutonUI>Journal</BoutonUI> conserve chaque événement horodaté (envoi, ouverture, accusé, réponse…). Les adresses IP ne sont conservées que sous forme d'empreinte.</Li>
          </Liste>
          <P>Les élus répondent depuis leur espace personnel (page sécurisée par un lien unique) : présent, absent excusé, ou prise de connaissance.</P>
          <Encadre type="info" titre="Espace élus">
            Le réglage « Les élus voient une séance dès… » (envoi de la convocation ou arrêt de l'ordre du jour) se trouve dans <BoutonUI>Paramétrages › Espace élus</BoutonUI>.
          </Encadre>
        </>
      ),
    },
    {
      id: 's-deroule',
      titre: 'Le jour de la séance',
      bloc: (
        <>
          <P>Le bouton <BoutonUI>Suivi de séance</BoutonUI> ouvre l'écran de conduite de la séance.</P>
          <Procedure>
            <Etape n={1} titre="Ouvrir la séance">Le badge de quorum indique combien d'élus sont en salle. Puis <BoutonUI>Ouvrir la séance</BoutonUI>.</Etape>
            <Etape n={2} titre="Saisir les présences">Par groupe (<BoutonUI>Tous en salle</BoutonUI> / <BoutonUI>Tous absents</BoutonUI>) ou individu (En salle, Sorti, Absent, Excusé). Les <Terme>pouvoirs</Terme> se donnent d'un élu à un autre.</Etape>
            <Etape n={3} titre="Appeler les points">Le <Terme>point en cours</Terme> est visible de tous. Votez : Pour, Contre, Abstention, NPPV. Un vote de groupe peut être saisi d'un coup, puis ajusté.</Etape>
            <Etape n={4} titre="Traiter les amendements">Le bouton <BoutonUI>Déposer un amendement</BoutonUI> (délibération, point non clos) précise l'auteur, la partie visée (exposé, visas, dispositif) et le nouveau texte. Le vote du texte reste bloqué tant qu'un amendement est en attente.</Etape>
            <Etape n={5} titre="Clôturer chaque point">Choisissez <BoutonUI>Clôturer le vote</BoutonUI>, <BoutonUI>Sans vote</BoutonUI>, <BoutonUI>Retiré</BoutonUI> ou <BoutonUI>Ajourné</BoutonUI>. Le résultat s'affiche : Adoptée à l'unanimité, Adoptée à la majorité, Rejetée…</Etape>
            <Etape n={6} titre="Clore la séance">Le bouton <BoutonUI>Clore la séance</BoutonUI> termine la séance. En cas d'erreur, un <BoutonUI>Déverrouiller</BoutonUI> avec motif reste possible.</Etape>
          </Procedure>
          <Encadre type="astuce" titre="Pièces de séance">
            Le menu <BoutonUI>Pièces de séance</BoutonUI> produit le procès-verbal (projet tant que la séance n'est pas close), la version sans observations du secrétariat, la liste des délibérations et l'extrait du registre de chaque délibération.
          </Encadre>
        </>
      ),
    },
    {
      id: 's-legalite',
      titre: 'Contrôle de légalité et télétransmission',
      bloc: (
        <>
          <P>Une fois les actes adoptés, ils doivent partir à la préfecture. L'onglet <BoutonUI>Contrôle de légalité</BoutonUI> sert à cela, via le tiers S²LOW.</P>
          <Procedure>
            <Etape n={1} titre="Choisir la séance">Dans l'onglet <BoutonUI>À transmettre</BoutonUI>, sélectionnez la séance, puis cochez les délibérations. Le bouton <BoutonUI>Préparer N transmission(s)</BoutonUI> contrôle chaque acte.</Etape>
            <Etape n={2} titre="Corriger les contrôles bloquants">Un symbole ⛔ signale un point à corriger ; un ⚠ un avertissement ; « ✓ Prête » un acte prêt.</Etape>
            <Etape n={3} titre="Envoyer puis confirmer">Dans l'onglet <BoutonUI>Suivi</BoutonUI>, les boutons <BoutonUI>Envoyer</BoutonUI> puis <BoutonUI>Confirmer</BoutonUI> suivent le mode de transmission (B — préparation puis confirmation, recommandé).</Etape>
            <Etape n={4} titre="Suivre l’accusé de réception">À réception, la date d'AR préfecture est enregistrée. Les boutons <BoutonUI>Bordereau</BoutonUI> et <BoutonUI>Acte tamponné</BoutonUI> récupèrent les documents de la préfecture.</Etape>
          </Procedure>
          <SousTitre>Documents de la préfecture</SousTitre>
          <P>L'onglet <BoutonUI>Documents de la préfecture</BoutonUI> regroupe les courriers (demande de pièces, lettre d'observations, déféré…). Vous pouvez <BoutonUI>Répondre à la préfecture</BoutonUI> ou <BoutonUI>Marquer comme traité</BoutonUI>.</P>
          <Encadre type="attention" titre="Mode simulation">
            Tant que l'accès réel à S²LOW n'est pas activé, un bandeau « Mode simulation » vous rappelle qu'aucun document ne part vers une préfecture. Les scénarios de simulation permettent de tester le parcours (onglet <BoutonUI>Simulation</BoutonUI>).
          </Encadre>
        </>
      ),
    },
    {
      id: 's-ged',
      titre: 'Archiver en GED (Alfresco)',
      bloc: (
        <>
          <P>Tous les documents de séance peuvent être archivés dans une GED Alfresco, classés par année et par séance. Un document modifié devient une <Terme>nouvelle version</Terme> du même nœud, jamais un doublon.</P>
          <Liste>
            <Li>Le bouton <BoutonUI>Tout synchroniser</BoutonUI> envoie ce qui manque. <BoutonUI>Vérifier la GED</BoutonUI> compare l'état réel et liste les écarts.</Li>
            <Li>Le bouton <BoutonUI>Archiver la séance</BoutonUI> dépose convocation, dossiers, cahier, procès-verbal, extraits du registre et accusés.</Li>
            <Li>L'explorateur permet de parcourir le plan de classement (Séances par année, Registre des délibérations).</Li>
          </Liste>
          <Encadre type="info" titre="VibeDélib reste la source">
            La GED est une copie d'archive : l'application demeure la référence. C'est elle qui décide ce qu'il faut (re)synchroniser.
          </Encadre>
        </>
      ),
    },
    {
      id: 's-rappels',
      titre: 'Trois rappels utiles',
      bloc: (
        <Liste>
          <Li><Terme>Rien n’est jamais supprimé</Terme> : une suppression masque ou retire, mais l'historique et les versions restent disponibles.</Li>
          <Li><Terme>Chaque action est tracée</Terme> : qui a fait quoi et quand. C'est la garantie de preuve pour la séance.</Li>
          <Li><Terme>Le vocabulaire s’adapte</Terme> : selon l'organisme, on lit « Conseil municipal » ou « Conseil d'administration », « Maire » ou « Président·e ». C'est normal.</Li>
        </Liste>
      ),
    },
  ],
};
