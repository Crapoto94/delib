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
// Horodatage figé une seule fois : il sert à la fois de marqueur de version dans le bundle (__BUILD_TIME__) et
// d'identifiant publié dans dist/version.json, que scripts/publier-apk.mjs reprend pour annoncer la mise à jour.
const buildTime = new Date().toISOString();

export default defineConfig({
  plugins: [
    react(),
    // Dev : /api-docs/ sert la page Swagger statique (public/api-docs) au lieu du repli SPA ; nginx fait de même en production.
    {
      name: 'vd-api-docs',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => { if (req.url === '/api-docs' || req.url === '/api-docs/') req.url = '/api-docs/index.html'; next(); });
      },
    },
    // dist/version.json : identifiant du build, lu par le script de publication de l'APK.
    {
      name: 'vd-version',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: pkg.version, buildTime } satisfies Record<string, string>, null, 2) });
      },
    },
  ],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_TIME__: JSON.stringify(buildTime) },
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5161, strictPort: true, proxy: {
    // Même liste blanche que nginx.conf.template : un préfixe '/api' attraperait aussi /api-docs (Swagger complet du backend).
    '^/api/v1/(elus|elus-auth|externe)/|^/api/v1/elus-auth/etat$|^/api/v1/public/(deliberations|arretes|branding$|organismes/[0-9]+/logo$)': { target: process.env.VITE_API_TARGET || 'http://localhost:3121', changeOrigin: true },
  } },
});
