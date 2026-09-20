import { Article } from './ui';
import { redaction } from './redaction';
import { scc } from './scc';
import { parametrage } from './parametrage';

export const ARTICLES: Article[] = [redaction, scc, parametrage];

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
