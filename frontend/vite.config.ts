import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Le front tourne sur 5160 ; l'API (backend) sur 3021, atteinte via le proxy pour éviter tout souci de CORS en développement.
// Le moteur de documents, lui, n'est PAS relayé ici : ONLYOFFICE ne fonctionne pas correctement sous un sous-chemin
// (il construit des URL internes sans le préfixe et l'éditeur ouvre un mauvais contenu). Il est donc servi sur sa propre
// origine, déclarée par BUREAU_URL_NAVIGATEUR côté backend. Voir MANIFEST §35.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: { port: 5160, strictPort: true, watch: { ignored: ['**/dist/**', '**/dist-elus/**'] }, // les builds (dont celui de l'espace élus) ne doivent pas faire tomber le serveur de dev
      proxy: { '/api': { target: env.VITE_API_TARGET || 'http://localhost:3021', changeOrigin: true } } },
  };
});
