// Copie les ressources de Swagger UI (swagger-ui-dist) vers public/api-docs : servies localement par Vite et nginx,
// car la politique de sécurité de la DMZ (script-src 'self') interdit tout script venu d'un CDN.
// Les fichiers versionnés de ce dossier sont index.html et init.js ; le reste est copié à chaque build.
import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'node_modules', 'swagger-ui-dist');
const dest = resolve(root, 'public', 'api-docs');
const FICHIERS = ['swagger-ui-bundle.js', 'swagger-ui.css', 'favicon-32x32.png'];

if (!existsSync(src)) {
  console.warn('[swagger-assets] node_modules/swagger-ui-dist introuvable — copie ignorée');
  process.exit(0);
}
await mkdir(dest, { recursive: true });
for (const f of FICHIERS) await cp(resolve(src, f), resolve(dest, f));
console.log(`[swagger-assets] ${FICHIERS.join(', ')} copiés dans public/api-docs`);
