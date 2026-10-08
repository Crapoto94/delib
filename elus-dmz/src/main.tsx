import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { appliquerTheme, themeChoisi } from './theme';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import Deliberations from './pages/Deliberations';
import DeliberationsCode from './pages/DeliberationsCode';

// Pages publiques des délibérations (liste des derniers mois, moteur de recherche), faites pour être incrustées (iframe) : aucun cadre, aucune
// connexion, pas de coque hors ligne. Les pages « -code » montrent le code d'intégration correspondant.
const TITRE_PUBLIC = 'Délibérations Ivry';
const TITRE_ARRETES = 'Arrêtés Ivry';
const chemin = location.pathname.replace(/\/+$/, '');
const PUBLIQUES: Record<string, { page: JSX.Element; nue: boolean }> = {
  '/deliberations': { page: <Deliberations />, nue: true },
  '/deliberations-recherche': { page: <Deliberations mode="recherche" />, nue: true },
  '/deliberations-code': { page: <DeliberationsCode />, nue: false },
  '/deliberations-recherche-code': { page: <DeliberationsCode mode="recherche" />, nue: false },
  '/arretes': { page: <Deliberations type="arretes" />, nue: true },
  '/arretes-recherche': { page: <Deliberations type="arretes" mode="recherche" />, nue: true },
  '/arretes-code': { page: <DeliberationsCode type="arretes" />, nue: false },
  '/arretes-recherche-code': { page: <DeliberationsCode type="arretes" mode="recherche" />, nue: false },
};
const publique = Object.entries(PUBLIQUES).find(([k]) => chemin === k || chemin.endsWith(k))?.[1];
const racine = ReactDOM.createRoot(document.getElementById('root')!);
if (publique) {
  document.title = /\/arretes/.test(chemin) ? TITRE_ARRETES : TITRE_PUBLIC;
  if (publique.nue) { document.documentElement.style.background = 'transparent'; document.body.style.background = 'transparent'; } else appliquerTheme(themeChoisi());
  racine.render(<React.StrictMode><ErrorBoundary>{publique.page}</ErrorBoundary></React.StrictMode>);
} else {
  appliquerTheme(themeChoisi());
  racine.render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
}

// coque de l'application hors ligne (l'API n'est jamais interceptée : les documents vivent dans le stockage propre à l'élu)
if (!publique && 'serviceWorker' in navigator && location.protocol.startsWith('http') && !import.meta.env.DEV) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
