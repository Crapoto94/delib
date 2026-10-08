import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { appliquerTheme, themeChoisi } from './theme';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import Deliberations from './pages/Deliberations';

// Page publique des délibérations, faite pour être incrustée (iframe) : aucun cadre, aucune connexion, pas de coque hors ligne.
const integre = /\/deliberations\/?$/.test(location.pathname);
if (integre) {
  document.documentElement.style.background = 'transparent'; document.body.style.background = 'transparent';
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><Deliberations /></ErrorBoundary></React.StrictMode>);
} else {
  appliquerTheme(themeChoisi());
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
}

// coque de l'application hors ligne (l'API n'est jamais interceptée : les documents vivent dans le stockage propre à l'élu)
if (!integre && 'serviceWorker' in navigator && location.protocol.startsWith('http') && !import.meta.env.DEV) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
