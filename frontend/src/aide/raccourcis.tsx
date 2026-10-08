import { Keyboard } from 'lucide-react';
import { Article, Cle, Encadre, Intro, P, Tableau } from './ui';

export const raccourcis: Article = {
  code: 'raccourcis',
  titre: 'Raccourcis clavier',
  resume: "Les touches qui vont plus vite que la souris : la recherche, les fenêtres, la visionneuse de documents, les listes.",
  Icone: Keyboard,
  acces: 'tous',
  intro: (
    <Intro>
      Quelques touches suffisent pour aller plus vite. Le raccourci le plus utile est la touche <Cle>/</Cle> : où que vous soyez, elle place le curseur dans la <b>recherche d'un acte</b> en haut de l'écran.
    </Intro>
  ),
  sections: [
    {
      id: 'k-global',
      titre: 'Partout dans l\'application',
      bloc: (
        <>
          <Tableau entetes={['Touche', 'Effet']} lignes={[
            [<Cle key="a">/</Cle>, <>Place le curseur dans la recherche d'un acte, sans cliquer. Sans effet si vous êtes déjà en train d'écrire dans un champ, une liste ou un éditeur : la barre oblique s'écrit alors normalement.</>],
            [<Cle key="b">Échap</Cle>, <>Ferme la fenêtre ouverte (formulaire, aperçu, visionneuse de documents) ou quitte la visite guidée.</>],
          ]} />
        </>
      ),
    },
    {
      id: 'k-documents',
      titre: 'Visionneuse de documents et visite guidée',
      bloc: (
        <Tableau entetes={['Touche', 'Effet']} lignes={[
          [<><Cle key="a">←</Cle> / <Cle key="b">→</Cle></>, <>Document précédent / suivant, quand plusieurs documents sont ouverts ensemble (dossier et annexes). Dans la visite guidée : étape précédente / suivante.</>],
        ]} />
      ),
    },
    {
      id: 'k-listes',
      titre: 'Listes déroulantes et choix d\'un agent',
      bloc: (
        <Tableau entetes={['Touche', 'Effet']} lignes={[
          [<><Cle key="a">↑</Cle> / <Cle key="b">↓</Cle></>, <>Se déplacer dans la liste des propositions.</>],
          [<Cle key="c">Entrée</Cle>, <>Choisir la proposition en surbrillance (agent à mentionner, valeur d'une liste).</>],
          [<Cle key="d">Tab</Cle>, <>Quitte la liste déroulante sans changer la valeur ; dans la saisie d'une mention, choisit la proposition.</>],
        ]} />
      ),
    },
    {
      id: 'k-assistant',
      titre: 'Questions à l\'assistant',
      bloc: (
        <>
          <Tableau entetes={['Touche', 'Effet']} lignes={[
            [<Cle key="a">Entrée</Cle>, <>Envoie votre question à l'assistant.</>],
            [<><Cle key="b">Maj</Cle> + <Cle key="c">Entrée</Cle></>, <>Passe à la ligne sans envoyer.</>],
          ]} />
          <P>Dans les <b>mentions</b> d'un commentaire, tapez <Cle>@</Cle> puis les premières lettres d'un nom pour choisir la personne à prévenir.</P>
          <Encadre type="astuce" titre="Sur une tablette ou un téléphone">Les raccourcis clavier demandent un clavier physique. Les mêmes actions restent disponibles par les boutons de l'écran.</Encadre>
        </>
      ),
    },
  ],
};
