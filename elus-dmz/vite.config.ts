import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Front autonome de l'espace des élus (DMZ) : ce dossier ne dépend de rien d'autre
// dans le dépôt (voir README.md). `docker compose build` utilise `context: .` ici.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5161, strictPort: true, proxy: { '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:3021', changeOrigin: true } } },
});
