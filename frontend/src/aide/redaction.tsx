import { FileText } from 'lucide-react';
import { Article, BoutonUI, Cle, DefListe, Encadre, Etape, Flux, Intro, Li, Liste, P, Procedure, Schema, SousTitre, Tableau, Terme } from './ui';

export const redaction: Article = {
  code: 'redaction',
  titre: 'Rédiger un acte et suivre son circuit',
  resume: "De la création du brouillon à la transmission à la préfecture : comment écrire une délibération, la faire valider et comprendre chaque étape.",
  Icone: FileText,
  acces: 'tous',
  intro: (
    <Intro>
      Cette aide s'adresse à <Terme>toute personne qui rédige ou valide un acte</Terme> : rédacteur, chef de service, directeur, services financier et juridique, DGA, DGS.
      Aucune connaissance technique n'est nécessaire. Suivez les étapes, l'application vous guide. Vous pouvez rouvrir cette page à tout moment depuis le bouton <BoutonUI>Aide</BoutonUI> en haut à droite.
    </Intro>
  ),
  sections: [
    {
      id: 'r-vocabulaire',
      titre: 'Les mots à connaître',
      bloc: (
        <>
          <P>VibeDélib emploie quelques mots simples. Les voici, en langage courant :</P>
          <DefListe items={[
            [<>Acte / dossier</>, <>Tout ce que l'on prépare pour le conseil : la fiche, l'exposé, les délibérations, les annexes et la discussion. Dans l'application, on parle surtout de <Terme>dossier</Terme>.</>],
            [<>Exposé des motifs</>, <>Le « pourquoi ». Il explique en quelques phrases le contexte et l'intérêt de la décision pour l'assemblée.</>],
            [<>Vu et considérant</>, <>La justification juridique : les <Terme>visas</Terme> (« Vu le code… ») citent les textes, les <Terme>considérants</Terme> (« Considérant que… ») donnent les raisons.</>],
            [<>Délibéré</>, <>Le « quoi ». Ce que le conseil décide vraiment, rédigé en <Terme>articles</Terme> (« Article 1 : … »).</>],
            [<>Circuit</>, <>La suite des personnes qui relisent et valident votre acte avant le conseil.</>],
            [<>Commission</>, <>Un groupe d'élus qui donne un <Terme>avis</Terme> sur les projets avant le conseil. Un acte peut être « hors commission ».</>],
            [<>Séance / ordre du jour (ODJ)</>, <>Le conseil se réunit lors d'une <Terme>séance</Terme>. L'<Terme>ordre du jour</Terme> est la liste ordonnée des sujets qui y seront examinés.</>],
            [<>Mise à disposition</>, <>Le moment où un dossier devient consultable par les élus concernés (commission, puis conseil).</>],
          ]} />
        </>
      ),
    },
    {
      id: 'r-cycle',
      titre: 'Le cycle de vie d\'un acte, en un coup d\'œil',
      bloc: (
        <>
          <P>Tout acte suit le même chemin. Les noms exacts des étapes du circuit dépendent de votre collectivité, mais l'idée est toujours la même :</P>
          <Schema legende="De gauche à droite : plus l'acte avance, plus il se rapproche du conseil puis de la préfecture.">
            <Flux etapes={['Brouillon', 'Circuit de validation', 'Avis des commissions', 'Inscription à l’ordre du jour', 'Séance et vote', 'Contrôle de légalité']} />
          </Schema>
          <Encadre type="astuce" titre="Vous n’avez pas à tout faire">
            Vous vous occupez de la <Terme>rédaction</Terme> et de l'<Terme>envoi</Terme>. Le SCC (Service Conseil et Contentieux) se charge des séances, de la convocation des élus et de l'envoi à la préfecture.
          </Encadre>
        </>
      ),
    },
    {
      id: 'r-creer',
      titre: 'Créer un dossier (brouillon)',
      bloc: (
        <>
          <Procedure>
            <Etape n={1} titre="Ouvrez « Actes & Dossiers »">Menu « Actes & Dossiers », puis <BoutonUI>Nouveau dossier</BoutonUI> (aussi accessible depuis le tableau de bord).</Etape>
            <Etape n={2} titre="Choisissez le type d’acte">Délibération, décision ou arrêté. Le type détermine le circuit à venir et la fin du parcours (conseil ou signature du maire). La fenêtre de création explique chaque type ; une pastille le rappelle ensuite dans les listes.</Etape>
            <Etape n={3} titre="Donnez un titre clair">C'est le titre qui apparaîtra sur l'ordre du jour officiel. Écrivez-le comme vous voudriez le lire en séance.</Etape>
            <Etape n={4} titre="Surveillez les actes proches">Dès que vous tapez quelques lettres, l'application vous montre les actes similaires déjà rédigés : inspirez-vous-en plutôt que de repartir de zéro.</Etape>
            <Etape n={5} titre="Cliquez sur « Créer le brouillon »">Votre dossier est créé. Il reste <Terme>brouillon</Terme> : personne d'autre ne le traite tant que vous ne l'avez pas envoyé.</Etape>
          </Procedure>
          <Encadre type="info" titre="La direction porteuse est déduite de vous">
            Votre direction est automatiquement reprise de votre fiche RH. Si vous avez le droit de rédiger pour plusieurs directions, vous choisissez la <Terme>direction porteuse</Terme> à la création ; c'est elle qui détermine le circuit.
          </Encadre>
          <Encadre type="astuce" titre="Délibération, décision ou arrêté ?">
            Une <b>délibération</b> (et un <b>vœu</b>) est discutée et votée en conseil municipal : elle est inscrite à l'ordre du jour. Une <b>décision</b> est prise par le maire dans le cadre d'une délégation du conseil : elle ne passe pas en conseil et part en <b>signature du maire</b> à la fin du circuit — pensez à <b>lier la ou les délibérations qui l'autorisent</b> sur la fiche. Un <b>arrêté</b> (réglementaire ou individuel) est lui aussi signé par le maire. Le parapheur utilisé se paramètre dans « Paramétrages › Parapheur (signature) ».
          </Encadre>
        </>
      ),
    },
    {
      id: 'r-assiste',
      titre: 'Le guide pas à pas (« dossier assisté »)',
      bloc: (
        <>
          <P>Si vous créez votre dossier en mode <Terme>assisté</Terme> (case à la création, ou carte « Dossier assisté » sur un brouillon existant), un petit assistant — <Terme>Evelyne Del-IA</Terme> — vous suit pendant toute la rédaction : il indique à chaque instant l'étape où vous en êtes, donne des conseils et suit votre progression.</P>
          <Liste>
            <Li>Le bouton <BoutonUI>Montrer</BoutonUI> vous amène au bon endroit : il ouvre l'éditeur du texte concerné, place le curseur sur le champ à remplir, ou affiche l'aperçu du dossier complet.</Li>
            <Li>La fenêtre est <Terme>déplaçable</Terme> (glissez son en-tête ou la pastille repliée) ; vous pouvez la <Terme>réduire</Terme> à une pastille, ou la <Terme>fermer</Terme> avec la croix.</Li>
            <Li>À chaque étape franchie, Evelyne Del-IA vous <Terme>félicite</Terme> et sa zone passe au vert.</Li>
            <Li>Vous pouvez lui <Terme>poser une question</Terme> à tout moment (bouton « Poser une question ») : il répond en s'appuyant sur la documentation, votre profil et les délibérations de l'application, puis vous dites si la réponse vous a convenu (1 à 4 étoiles).</Li>
          </Liste>
          <Encadre type="astuce" titre="Rouvrir le guide">
            Vous l'avez fermé ? Rouvrez-le depuis le menu <BoutonUI>Aide</BoutonUI> en haut à droite : <Terme>Réafficher le guide du dossier</Terme> (visible quand un dossier assisté est ouvert).
          </Encadre>
          <Encadre type="info" titre="Couper complètement l'aide">
            Le bouton <BoutonUI>Ne plus m'aider</BoutonUI> — ou la carte « Dossier assisté » de la fiche — désactive l'accompagnement pour ce dossier ; vous pouvez le réactiver plus tard.
          </Encadre>
        </>
      ),
    },
    {
      id: 'r-fiche',
      titre: 'Remplir la fiche du dossier',
      bloc: (
        <>
          <P>La fiche rassemble les informations administratives du dossier. Les champs marqués d'une <Terme>étoile (*)</Terme> sont obligatoires.</P>
          <Tableau entetes={['Champ', 'À quoi ça sert']} lignes={[
            [<>Titre de l'acte *</>, <>Le nom qui figurera à l'ordre du jour.</>],
            [<>Domaine d'intervention (matière) *</>, <>Le classement officiel du sujet (nomenclature de la préfecture).</>],
            [<>Rubrique *</>, <>La thématique (Finances, Culture, Action sociale…). Elle sert aussi de classement interne.</>],
            [<>Nature *</>, <>Le type juridique de l'acte (Délibérations, Actes réglementaires…).</>],
            [<>Élu rapporteur *</>, <>L'élu qui présentera le sujet devant l'assemblée.</>],
            [<>Impact budgétaire *</>, <>Oui ou non ; si oui, indiquez le montant. Cela peut ajouter une validation du <Terme>Service financier</Terme> au circuit.</>],
            [<>Séance visée</>, <>La séance de conseil à laquelle vous destinez l'acte. Vous proposez, la hiérarchie peut modifier, le SCC affecte définitivement.</>],
            [<>Dossier urgent</>, <>Cochez pour un traitement renforcé et suivi de plus près.</>],
          ]} />
          <Encadre type="info" titre="Champs personnalisés">
            Votre collectivité peut ajouter ses propres champs (ex. « Convention associée ? »). S'ils sont obligatoires, ils bloquent l'envoi tant qu'ils ne sont pas remplis. Une aide sous chaque champ vous explique ce qu'on attend.
          </Encadre>
          <Encadre type="astuce" titre="L’indicateur de complétude">
            À droite de l'écran, la carte <BoutonUI>État de complétude</BoutonUI> vous dit ce qu'il reste à remplir pour pouvoir envoyer. Tant que tout n'est pas vert, le bouton d'envoi reste indisponible.
          </Encadre>
        </>
      ),
    },
    {
      id: 'r-rediger',
      titre: 'Rédiger les trois parties du texte',
      bloc: (
        <>
          <P>Une délibération se rédige en trois parties, toutes dans le même écran. Cliquez sur <BoutonUI>Ouvrir l'éditeur</BoutonUI> pour basculer en plein écran.</P>
          <Tableau entetes={['Partie', 'Question à laquelle elle répond', 'Conseil de rédaction']} lignes={[
            [<><Terme>Exposé des motifs</Terme></>, <>Pourquoi ?</>, <>Écrivez des phrases simples, comme si vous expliquiez le sujet à un habitant.</>],
            [<><Terme>Vu et considérant</Terme></>, <>Au nom de quoi ?</>, <>Utilisez les boutons <BoutonUI>Vu</BoutonUI> et <BoutonUI>Considérant</BoutonUI> : ils insèrent les formules au bon format.</>],
            [<><Terme>Délibéré</Terme></>, <>Que décide-t-on ?</>, <>Utilisez le bouton <BoutonUI>Article</BoutonUI>. Les articles sont renumérotés automatiquement.</>],
          ]} />
          <SousTitre>Ce que fait l'éditeur pour vous</SousTitre>
          <Liste>
            <Li>Mise en forme simple : gras, italique, listes, titres. Raccourcis <Cle>Ctrl</Cle>+<Cle>B</Cle> et <Cle>Ctrl</Cle>+<Cle>I</Cle>.</Li>
            <Li><Terme>Enregistrement automatique</Terme> : inutile de cliquer sur « Enregistrer », chaque frappe est sauvegardée. L'état s'affiche en bas (« ✓ Enregistré · version N »).</Li>
            <Li>Dans le <Terme>Délibéré</Terme> : <Cle>Entrée</Cle> crée un nouvel article, <Cle>Maj</Cle>+<Cle>Entrée</Cle> revient simplement à la ligne.</Li>
            <Li>Le bouton <BoutonUI>Aperçu mis en page</BoutonUI> montre le document tel qu'il sera imprimé (avec le logo et la mise en page de la collectivité).</Li>
          </Liste>
          <SousTitre>Le suivi des modifications</SousTitre>
          <P>Quand plusieurs personnes relisent, chacune écrit dans <Terme>sa couleur</Terme>. Vous voyez qui a proposé quoi, et vous <Terme>acceptez</Terme> ou <Terme>refusez</Terme> chaque changement. Rien n'est jamais perdu : toutes les versions restent consultables.</P>
          <Encadre type="attention" titre="Si plusieurs personnes éditent en même temps">
            En cas de conflit, un bandeau vous prévient : « Ce texte a été modifié par quelqu'un d'autre. » Cliquez sur <BoutonUI>Recharger sa version</BoutonUI> pour repartir de la version à jour.
          </Encadre>
        </>
      ),
    },
    {
      id: 'r-ia',
      titre: 'L’assistant IA : un relecteur, pas un auteur',
      bloc: (
        <>
          <P>Le panneau <BoutonUI>Assistant IA</BoutonUI> peut relire votre texte. Il <Terme>propose</Terme>, c'est vous qui <Terme>décidez</Terme> : aucune modification n'est appliquée sans votre accord.</P>
          <Tableau entetes={['Outil', 'Ce qu’il fait']} lignes={[
            [<>Vérifier l'orthographe</>, <>Orthographe, grammaire, accords, typographie française.</>],
            [<>Améliorer le style</>, <>Clarté, concision, registre administratif.</>],
            [<>Contrôler les visas et considérants</>, <>Ordre, formulation, références à vérifier, cohérence.</>],
            [<>Contrôle complet du dossier</>, <>Les trois passes, plus les montants, annexes et l'incidence financière.</>],
          ]} />
          <Liste>
            <Li>Chaque suggestion s'affiche avec son type (Orthographe, Style, Visas…) et sa gravité (Information / À revoir / Bloquant).</Li>
            <Li>Vous cliquez sur <BoutonUI>Accepter</BoutonUI>, <BoutonUI>Ignorer</BoutonUI> ou <BoutonUI>Pourquoi ?</BoutonUI>.</Li>
            <Li>Le traitement se fait en arrière-plan : vous pouvez continuer à travailler, une notification vous prévient quand c'est fini.</Li>
          </Liste>
          <Encadre type="attention" titre="Toujours relire">
            La responsabilité du texte reste celle de l'agent. L'IA peut se tromper, surtout sur le plan juridique : vérifiez toujours ses propositions.
          </Encadre>
        </>
      ),
    },
    {
      id: 'r-annexes',
      titre: 'Joindre des annexes',
      bloc: (
        <>
          <P>Un contrat, un plan, un tableau financier ? Ajoutez-les à la carte <BoutonUI>Pièces jointes au dossier</BoutonUI>.</P>
          <Procedure>
            <Etape n={1} titre="Glissez votre fichier">Ou cliquez dans la zone « Glissez votre fichier ici ou cliquez pour choisir ». Seuls les <Terme>PDF</Terme> sont acceptés.</Etape>
            <Etape n={2} titre="Le titre est repris du fichier">Vous pouvez le renommer ensuite. Une annexe communicable peut être montrée aux élus.</Etape>
            <Etape n={3} titre="Remplacez sans rien perdre">Remplacer une annexe crée une <Terme>nouvelle version</Terme> : l'ancienne reste consultable.</Etape>
          </Procedure>
        </>
      ),
    },
    {
      id: 'r-discussion',
      titre: 'Échanger dans le dossier',
      bloc: (
        <>
          <P>La section <BoutonUI>Discussion</BoutonUI> évite les échanges de mails. Elle rassemble tous les commentaires du dossier.</P>
          <Liste>
            <Li>Tapez <Cle>@</Cle> suivi de quelques lettres pour <Terme>mentionner</Terme> un collègue : il reçoit une notification.</Li>
            <Li>Les demandes de modification apparaissent ici en surbrillance, avec leur motif.</Li>
          </Liste>
        </>
      ),
    },
    {
      id: 'r-envoyer',
      titre: 'Envoyer au circuit',
      bloc: (
        <>
          <P>Quand votre dossier est complet, la carte <BoutonUI>Actions</BoutonUI> affiche <BoutonUI>Envoyer pour validation</BoutonUI>.</P>
          <Procedure>
            <Etape n={1} titre="Vérifiez la complétude">Tout doit être vert. Sinon, l'application vous liste ce qu'il manque et bloque l'envoi.</Etape>
            <Etape n={2} titre="Cliquez sur « Envoyer pour validation »">Le circuit démarre : la frise en haut de l'écran montre l'étape en cours et la personne attendue.</Etape>
          </Procedure>
          <Encadre type="attention" titre="Après l’envoi, seule la personne dont c’est le tour peut modifier">
            Tant que le dossier circule, vous ne pouvez plus le modifier librement. Si une modification est nécessaire, elle vous sera renvoyée (voir la section suivante).
          </Encadre>
        </>
      ),
    },
    {
      id: 'r-circuit',
      titre: 'Le circuit de validation',
      bloc: (
        <>
          <P>Le circuit est une suite d'étapes. Voici le circuit <Terme>par défaut</Terme> de la Ville (il peut être adapté par votre collectivité) :</P>
          <Schema legende="Le passage par le Service financier n'a lieu que si l'impact budgétaire est « Oui ». L'étape « Responsable intermédiaire » est facultative.">
            <Flux etapes={['Vous (rédacteur)', 'Responsable intermédiaire', 'Chef de service', 'Directeur', 'Service financier (si budget)', 'Service juridique', 'DGA', 'DGS', 'SCC / Assemblées']} />
          </Schema>
          <SousTitre>Valider</SousTitre>
          <P>Le bouton <BoutonUI>Valider</BoutonUI> fait passer l'acte à l'étape suivante et prévient le valideur suivant. En cas de délégation, le libellé précise « Valider (pour …) ».</P>
          <SousTitre>Demander une modification</SousTitre>
          <P>Un valideur peut refuser avec un <Terme>motif obligatoire</Terme>. Il choisit alors :</P>
          <Tableau entetes={['Option', 'Effet']} lignes={[
            [<>Renvoyer à : l'étape précédente</>, <>L'acte revient au valideur juste avant lui.</>],
            [<>Renvoyer à : une étape antérieure</>, <>Il peut viser n'importe quelle étape déjà traversée, y compris le rédacteur.</>],
            [<>Après correction : revient directement à mon étape</>, <>Le dossier saute les étapes intermédiaires et lui revient aussitôt.</>],
            [<>Après correction : repasse par tout le circuit</>, <>Le dossier repart de l'étape visée et refait le circuit concerné.</>],
          ]} />
          <SousTitre>S'absenter : la délégation</SousTitre>
          <P>Vous partez en congés ? Menu utilisateur → <BoutonUI>Mes délégations</BoutonUI> → indiquez à qui vous déléguez (et éventuellement jusqu'à quand). Vous <Terme>gardez</Terme> vos droits (co-détention). Toute validation faite à votre place est tracée « pour … ».</P>
          <SousTitre>Date limite dépassée</SousTitre>
          <P>Chaque séance a une date limite de rédaction. Après cette date, l'envoi est <Terme>bloqué</Terme>. Vous pouvez alors demander une <Terme>dérogation</Terme> (motif) ou <Terme>reporter</Terme> le dossier à la séance suivante. La dérogation est accordée par le SCC ou la DGS.</P>
          <Encadre type="astuce" titre="Étapes « ignorées »">
            Sur la frise, certaines étapes peuvent indiquer « Poste vacant — étape ignorée » ou « Aucun titulaire — étape ignorée ». C'est normal : l'acte ne s'y arrête pas. Si une étape obligatoire n'a personne, le dossier est bloqué et l'administrateur est alerté.
          </Encadre>
        </>
      ),
    },
    {
      id: 'r-apres',
      titre: 'Après la validation : séance et suites',
      bloc: (
        <>
          <Liste>
            <Li>Le SCC inscrit le dossier à l'<Terme>ordre du jour</Terme> d'une séance et lui attribue un <Terme>numéro définitif</Terme>.</Li>
            <Li>Les <Terme>commissions</Terme> concernées donnent leur avis.</Li>
            <Li>Les élus sont <Terme>convoqués</Terme> et consultent les documents.</Li>
            <Li>Le jour de la séance, les votes sont saisis ; l'acte devient <Terme>Adopté</Terme> ou <Terme>Rejeté</Terme>.</Li>
            <Li>Le SCC prépare ensuite l'envoi au <Terme>contrôle de légalité</Terme> (préfecture) ; une fois l'accusé de réception reçu, l'extrait du registre est tamponné.</Li>
          </Liste>
          <P>Vous n'avez plus rien à faire : suivez l'avancement sur la fiche du dossier ou depuis le tableau de bord.</P>
        </>
      ),
    },
    {
      id: 'r-retrouver',
      titre: 'Retrouver un acte : « Mes actes » et « Bibliothèque »',
      bloc: (
        <>
          <P>Deux rubriques distinctes, à ne pas confondre :</P>
          <Liste>
            <Li><Terme>Mes actes</Terme> : les dossiers où <b>vous</b> avez eu un rôle à un moment (rédacteur, valideur, remplaçant, commentaire), même terminés ou non adoptés. Ouvrez le <Terme>trajet</Terme> d'un dossier pour voir son circuit complet — qui a validé ou refusé, et quand —, les modifications, les commentaires, les amendements du conseil, le vote et la transmission.</Li>
            <Li><Terme>Bibliothèque</Terme> : les délibérations <b>adoptées</b> de la collectivité, une fois la séance close. Tous les agents peuvent les rechercher et les consulter (texte, exposé des motifs, extrait du registre). C'est de la consultation seule : elle n'ouvre pas le trajet des dossiers.</Li>
          </Liste>
          <P>Les actes confidentiels ou à huis clos n'apparaissent jamais dans la bibliothèque.</P>
        </>
      ),
    },
    {
      id: 'r-statuts',
      titre: 'Que signifient les statuts ?',
      bloc: (
        <Tableau entetes={['Statut', 'Signification']} lignes={[
          [<>Brouillon</>, <>Vous rédigez, personne d'autre ne traite le dossier.</>],
          [<>En circuit</>, <>Le dossier est entre les mains des valideurs.</>],
          [<>Modification demandée</>, <>On vous renvoie le dossier : lisez le motif dans la discussion.</>],
          [<>Validé DGS / En attente SCC</>, <>Le circuit est terminé, le SCC prend la main.</>],
          [<>Mis à disposition</>, <>Les élus concernés peuvent consulter le dossier.</>],
          [<>Avis rendu</>, <>La ou les commissions ont donné leur avis.</>],
          [<>Inscrit à l’ODJ</>, <>Le dossier est à l'ordre du jour d'une séance.</>],
          [<>Adopté / Rejeté</>, <>Résultat du vote en séance.</>],
          [<>Retiré / Ajourné / Abandonné</>, <>Le dossier ne suit plus son cours normal.</>],
          [<>Transmis / AR reçu / Publié / Exécutoire</>, <>Étapes du contrôle de légalité à la préfecture.</>],
        ]} />
      ),
    },
    {
      id: 'r-visibilite',
      titre: 'Qui peut voir un acte ?',
      bloc: (
        <>
          <P>Par défaut, un agent voit ses propres actes. Votre collectivité peut élargir ce périmètre, réglage par réglage :</P>
          <Tableau entetes={['Réglage', 'L’agent voit en plus…']} lignes={[
            [<>Rédacteur uniquement</>, <>Ses propres actes, et ceux dont il est co-rédacteur ou participant.</>],
            [<>Actes de son service</>, <>Tous les actes de son service.</>],
            [<>Actes de sa direction</>, <>Tous les actes de sa direction.</>],
          ]} />
          <P>La hiérarchie (chef de service, directeur, DGA), le SCC et les administrateurs gardent leur propre périmètre, plus large. Chaque utilisateur peut avoir un réglage personnel.</P>
        </>
      ),
    },
    {
      id: 'r-astuces',
      titre: 'Astuces et aide intégrée',
      bloc: (
        <Liste>
          <Li><Terme>Recherche rapide</Terme> : appuyez sur <Cle>/</Cle> n'importe où pour placer le curseur dans la recherche. Elle cherche dans les titres, les textes et les annexes, même sans accents. Essayez <Cle>"expression exacte"</Cle> ou <Cle>-mot</Cle> pour exclure.</Li>
          <Li><Terme>Notifications</Terme> : la cloche vous prévient des dossiers à traiter, des modifications demandées et des échéances. Vous choisissez ce qui arrive aussi par mail.</Li>
          <Li><Terme>Revoir la visite</Terme> : menu utilisateur → « Revoir la visite », pour une visite guidée pas à pas.</Li>
          <Li><Terme>Dossier d'entraînement</Terme> : la visite propose un brouillon d'exemple pour vous exercer sans risque. Il ne part jamais dans un vrai circuit et disparaît seul au bout de 14 jours.</Li>
        </Liste>
      ),
    },
  ],
};
