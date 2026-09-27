import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Enveloppe Android tablette : le même build web que l'espace élus ; l'instance/API est choisie au premier lancement.
 */
const config: CapacitorConfig = {
  appId: 'fr.ivry.vibedelib.elus',
  appName: 'VibeDélib Élus',
  webDir: '../dist',
  server: { androidScheme: 'https' }, // origine https://localhost : à autoriser dans CORS_ORIGINS du backend
  android: { allowMixedContent: false, backgroundColor: '#F8FAFC' },
};
export default config;
