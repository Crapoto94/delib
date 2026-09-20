import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Construction de l'espace des élus SEUL (dossier dist-elus) : ce que l'on sert en DMZ et ce qu'embarque l'APK.
// Le point d'entrée n'importe rien de l'application des agents.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist-elus', emptyOutDir: true, rollupOptions: { input: resolve(__dirname, 'elus.html') } },
  server: { port: 5161, strictPort: true, proxy: { '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:3021', changeOrigin: true } } },
});
