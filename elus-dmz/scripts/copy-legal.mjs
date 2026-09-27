// Synchronise les documents de référence à la racine du dépôt (CGU.md,
// LICENCE.md, MANIFEST.md) vers elus-dmz/src/legal, d'où l'application les
// importe pour les afficher (routes /cgu et /licence). La racine reste la
// source unique : on modifie ces documents à la racine, jamais la copie.
//
// Hors contexte Docker (où seuls les fichiers de elus-dmz/ sont copiés), les
// sources de la racine sont absentes : le script le signale et laisse en place
// les copies versionnées dans elus-dmz/src/legal.
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projet = resolve(here, '..');
const racine = resolve(projet, '..');
const dest = resolve(projet, 'src', 'legal');

const FICHIERS = ['CGU.md', 'LICENCE.md', 'MANIFEST.md'];
await mkdir(dest, { recursive: true });

let copies = 0;
for (const f of FICHIERS) {
  const src = resolve(racine, f);
  if (!existsSync(src)) continue;
  await copyFile(src, resolve(dest, f));
  copies += 1;
}
if (copies > 0) console.log(`[legal] ${copies} document(s) synchronisé(s) depuis la racine du dépôt`);
else console.warn('[legal] sources à la racine introuvables — copies versionnées conservées');
