import React from 'react';
import ReactDOM from 'react-dom/client';
import '../index.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

// coque de l'application hors ligne (l'API n'est jamais interceptée : les documents vivent dans le stockage propre à l'élu)
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !import.meta.env.DEV) {
  navigator.serviceWorker.register('./elus-sw.js').catch(() => undefined);
}
