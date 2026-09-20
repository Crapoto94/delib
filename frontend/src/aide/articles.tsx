import { FileCode2 } from 'lucide-react';
import { Article, Intro } from './ui';
import { redaction } from './redaction';
import { scc } from './scc';
import { parametrage } from './parametrage';

export const documents: Article = {
  code: 'documents',
  titre: 'DAT & DEX (architecture et exploitation)',
  resume: "Le document d'architecture technique et le dossier d'exploitation de l'application, tenus à jour et exportables en PDF.",
  Icone: FileCode2,
  acces: 'admin',
  document: true,
  intro: (
    <Intro>
      Deux documents techniques destinés à la DSI et à l'exploitation : le <b>DAT</b> (document d'architecture technique) décrit les composants, les flux, les données et la sécurité ; le <b>DEX</b> (dossier d'exploitation) décrit l'installation, les sauvegardes, la supervision et les incidents. Ils sont générés par l'application et téléchargeables en PDF.
    </Intro>
  ),
  sections: [],
};

export const ARTICLES: Article[] = [redaction, scc, parametrage, documents];

export function peutVoir(article: Article, isScc: boolean, isAdmin: boolean): boolean {
  if (article.acces === 'admin') return isAdmin;
  if (article.acces === 'scc') return isScc;
  return true;
}

export const ACCES_LABEL: Record<Article['acces'], string> = {
  tous: 'Tous les profils',
  scc: 'SCC et administrateurs',
  admin: 'Administrateurs',
};
