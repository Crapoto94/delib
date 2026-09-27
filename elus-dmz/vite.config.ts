import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

// Front autonome de l'espace des élus (DMZ) : ce dossier ne dépend de rien d'autre
// dans le dépôt (voir README.md). `docker compose build` utilise `context: .` ici.
//
// __APP_VERSION__ / __BUILD_TIME__ : ce front est construit par DEUX chemins de déploiement indépendants
// (pulldocker, sous /elus du frontal LAN ; pulldmz/pulldmz-lan, conteneur DMZ à part) qui ne partagent ni la
// même machine ni la même horloge de build. Une valeur figée au moment du `vite build` (pas à l'exécution)
// affichée sur la page de connexion permet de vérifier en un coup d'œil que les deux copies sont bien issues
// de la même source, sans dépendre de `.git` (absent du contexte de build des deux côtés).
export default defineConfig({
  plugins: [react()],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5161, strictPort: true, proxy: { '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:3021', changeOrigin: true } } },
});
