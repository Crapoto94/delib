import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Le front tourne sur 5160 ; l'API (backend) sur 3021, atteinte via le proxy pour éviter tout souci de CORS en développement.
//
// Le moteur de documents n'est PAS relayé pour ONLYOFFICE : il ne fonctionne pas sous un sous-chemin (il construit des URL
// internes sans le préfixe et l'éditeur ouvre un mauvais contenu). Il est donc servi sur sa propre origine, déclarée par
// BUREAU_URL_NAVIGATEUR côté backend. Voir MANIFEST §35.
//
// Collabora, lui, DOIT être sous /collabora-delib (option `net.service_root`) : on ne peut donc pas lui donner une origine
// à lui sans que le navigateur aille chercher le moteur sur le réseau. Le relais de développement ci-dessous évite ce
// détour : l'iframe est en relative, donc même origine que l'application — comme en production, où c'est le frontal nginx
// qui relaie. Le chemin est transmis TEL QUEL, sans réécriture : Collabora refuse toute requête hors de son préfixe, et
// announces /collabora-delib/browser/… pour ses ressources. Pour cette même raison le moteur doit accepter l'hôte
// `localhost` (BUREAU_HOTE_PUBLIQUE_DEV dans le .env du serveur).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: { port: 5160, strictPort: true, watch: { ignored: ['**/dist/**'] },
      proxy: {
        '/api': { target: env.VITE_API_TARGET || 'http://localhost:3021', changeOrigin: true },
        // Moteur(s) de documents joignables depuis le poste de développement, via le serveur qui les héberge.
        // Collabora pointe sur le moteur de DÉVELOPPEMENT (9982) : c'est le seul dont le nom d'hôte annoncé est
        // `localhost:5160`, donc le seul dont le WebSocket accepte l'origine du navigateur
        // (le moteur de production, 9981, n'accepte que https://vibedelib.ivry.local).
        '/collabora-delib': { target: env.VITE_COLLABORA_TARGET || 'http://10.103.130.106:9982', changeOrigin: false, ws: true },
        '/office-delib': { target: env.VITE_ONLYOFFICE_TARGET || 'http://10.103.130.106:9980', changeOrigin: false, ws: true },
      } },
  };
});
