import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Le front tourne sur 5160 ; l'API (backend) sur 3021, atteinte via le proxy pour éviter tout souci de CORS en développement.
export default defineConfig({
  plugins: [react()],
  server: { port: 5160, strictPort: true, proxy: { '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:3021', changeOrigin: true } } },
});
