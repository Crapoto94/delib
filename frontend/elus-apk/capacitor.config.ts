import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Enveloppe Android (APK) de l'espace des élus : le MÊME code que le web (`npm run build:elus` -> dist-elus).
 * Voir README.md pour la construction. L'URL de l'API se fixe à la compilation : VITE_ELUS_API=https://elus.exemple.fr/api/v1
 */
const config: CapacitorConfig = {
  appId: 'fr.ivry.vibedelib.elus',
  appName: 'VibeDélib Élus',
  webDir: '../dist-elus',
  server: { androidScheme: 'https' }, // origine https://localhost : à autoriser dans CORS_ORIGINS du backend
  android: { allowMixedContent: false, backgroundColor: '#F8FAFC' },
};
export default config;
